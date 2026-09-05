// Email verification.
//
// The other end of the link step 1.6 has been sending since it was built. Per
// D21 nothing redeemed it until now: the token was minted, emailed, and had
// nowhere to go, so `users.email_verified_at` was reachable only through the
// guardian claim's D18 stamp and a learner could not verify at all.
//
// Follows the shape 1.7 and 1.8 already set — resolve, check eligibility, burn
// and write inside one transaction — because this is D8's third purpose on the
// same table and nothing about it is special enough to deserve its own.

import { prisma } from '../db/client.js';
import { consumeOneTimeToken } from '../repositories/oneTimeTokenRepository.js';
import { EMAIL_VERIFICATION, resolveOneTimeToken } from './invitationService.js';

/**
 * Redeems a verification token. Returns the user, or null if the token was not
 * usable — unknown, expired, already consumed, or belonging to an account that
 * is not `enabled`. One null for all of them, as everywhere else: the person
 * holding the link has no use for the difference.
 */
export async function verifyEmailAddress({ token }, { now = new Date() } = {}) {
  return prisma.$transaction(async (tx) => {
    const row = await resolveOneTimeToken(EMAIL_VERIFICATION, token, {
      now,
      client: tx,
    });
    if (!row) return null;

    // A suspended account should not be able to complete anything, and a
    // `pending` stub has an invitation to claim rather than an address to
    // confirm — D18 stamps verification as part of that claim instead.
    if (row.user.status !== 'enabled') return null;

    const consumed = await consumeOneTimeToken(row.id, now, tx);
    if (!consumed) return null;

    // Stamped only if it is not already set. Per D5 this column is a timestamp
    // rather than a status, and like `paid` it records a moment: the first time
    // control of the address was proven. Re-stamping would move a fact that has
    // already happened. The token is still burned either way, so a link cannot
    // be kept alive by an account that is already verified.
    if (row.user.emailVerifiedAt !== null) {
      return publicUser(row.user);
    }

    return tx.user.update({
      where: { id: row.userId },
      data: { emailVerifiedAt: now },
      select: PUBLIC_FIELDS,
    });
  });
}

const PUBLIC_FIELDS = {
  id: true,
  email: true,
  fullName: true,
  status: true,
  emailVerifiedAt: true,
};

function publicUser(user) {
  const safe = {};
  for (const field of Object.keys(PUBLIC_FIELDS)) {
    safe[field] = user[field];
  }
  return safe;
}
