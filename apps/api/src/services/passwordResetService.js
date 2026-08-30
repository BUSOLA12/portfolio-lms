// Password reset: asking for a link, and using one.
//
// The request half deliberately tells the caller nothing. The completion half
// mirrors the guardian claim at 1.7 — resolve, check eligibility, burn, write —
// in one transaction, with one addition: every existing auth session is revoked.

import { prisma } from '../db/client.js';
import { passwordReset } from '../emails/templates/passwordReset.js';
import { revokeAllAuthSessionsForUser } from './authSessionService.js';
import { sendEmail } from './emailService.js';
import {
  PASSWORD_RESET,
  issuePasswordReset,
  passwordResetTtlHours,
  resolveOneTimeToken,
} from './invitationService.js';
import { consumeOneTimeToken } from '../repositories/oneTimeTokenRepository.js';
import { hashPassword } from './passwordService.js';

function requireWebOrigin() {
  const origin = process.env.WEB_ORIGIN;
  if (!origin) {
    throw new Error('WEB_ORIGIN is not set. Emails cannot deep-link without it.');
  }
  return origin.replace(/\/+$/, '');
}

function resetUrl(token) {
  return `${requireWebOrigin()}/reset?token=${encodeURIComponent(token)}`;
}

/**
 * Issues a reset link, if there is an account to issue one for.
 *
 * Returns nothing either way, and the caller answers identically either way.
 * A request form that distinguished "sent" from "no such account" would be a
 * way to test whether any given address is registered here.
 *
 * Only an `enabled` account gets a link. A `pending` stub has an invitation to
 * claim instead, and a `suspended` account should not be handed a way back in.
 */
export async function requestPasswordReset(email, { emailProvider } = {}) {
  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || user.status !== 'enabled') return;

  const { token, oneTimeToken } = await issuePasswordReset(user.id);

  try {
    await sendEmail({
      user,
      type: PASSWORD_RESET,
      // Scoped to this token, not left null. A learner who loses the first
      // email must be able to ask again, and a null entity would let 1.5's
      // duplicate-send guard suppress every request after the first, forever.
      entityRef: oneTimeToken.id,
      template: passwordReset({
        name: user.fullName,
        resetUrl: resetUrl(token),
        expiresInHours: passwordResetTtlHours(),
      }),
      provider: emailProvider,
    });
  } catch (error) {
    // As at 1.6: a provider outage must not become a 500 the caller could use
    // to distinguish a real address from an unknown one. The unsent state is
    // recoverable — no `email_log` row means a later request sends again.
    console.error('Password reset email failed to send', error);
  }
}

/**
 * Completes a reset: sets the password, burns the token, and revokes every
 * live auth session. Returns the user, or null if the token was not usable.
 */
export async function completePasswordReset(
  { token, password },
  { now = new Date() } = {},
) {
  // Outside the transaction: scrypt is slow and its locks would be held for
  // the whole derivation.
  const passwordHash = await hashPassword(password);

  return prisma.$transaction(async (tx) => {
    const row = await resolveOneTimeToken(PASSWORD_RESET, token, { now, client: tx });
    if (!row) return null;

    // Same eligibility rule as the request half, re-checked at redemption:
    // an account suspended in the hour since the link was sent must not be
    // able to use it.
    if (row.user.status !== 'enabled') return null;

    const consumed = await consumeOneTimeToken(row.id, now, tx);
    if (!consumed) return null;

    const user = await tx.user.update({
      where: { id: row.userId },
      data: { passwordHash },
      select: { id: true, email: true, fullName: true, status: true },
    });

    // A reset is what someone does when they believe their password is known
    // to somebody else. Leaving existing sessions alive would leave that
    // somebody logged in — CLAUDE.md rule 5 exists so this is possible at all.
    await revokeAllAuthSessionsForUser(user.id, tx);

    return user;
  });
}
