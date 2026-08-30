// Single-use expiring tokens.
//
// Per D8 one table serves all three flows — guardian invitation, email
// verification, password reset — so this service is written against `purpose`
// rather than against invitations specifically. Steps 1.6 and 1.8 reuse it
// without a second mechanism.
//
// The shape mirrors `authSessionService`: 256 bits of entropy, a keyed hash at
// rest, and redemption that stamps a column rather than deleting a row.

import { createHmac, randomBytes } from 'node:crypto';

import { prisma } from '../db/client.js';

import {
  consumeOneTimeToken,
  createOneTimeToken,
  findOneTimeTokenByHash,
} from '../repositories/oneTimeTokenRepository.js';
import { hashPassword } from './passwordService.js';

const TOKEN_BYTES = 32;

export const GUARDIAN_INVITATION = 'guardian_invitation';
export const EMAIL_VERIFICATION = 'email_verification';
export const PASSWORD_RESET = 'password_reset';

// Seven days, confirmed as the project's policy — long enough to survive a
// weekend and an unchecked inbox, short enough that a forwarded email stops
// working. No document specified one, so it was implemented as a marked
// default at 1.4 and confirmed after. Overridable for testing.
const DEFAULT_INVITATION_TTL_DAYS = 7;

function requireSecret() {
  const secret = process.env.ONE_TIME_TOKEN_SECRET;
  if (!secret) {
    throw new Error(
      'ONE_TIME_TOKEN_SECRET is not set. One-time tokens cannot be issued or redeemed without it.',
    );
  }
  return secret;
}

/**
 * Keyed, and scoped to the purpose. Including the purpose in the hashed message
 * means a token issued for one flow cannot be presented to another even if its
 * raw value leaked — the hashes simply do not match. The unique constraint is
 * on the hash alone, so this also keeps the three flows from colliding.
 */
export function hashOneTimeToken(purpose, token) {
  return createHmac('sha256', requireSecret())
    .update(`${purpose}:${token}`)
    .digest('hex');
}

// Verification carries the same seven days. The copy in the email states the
// number, so both are read from here and handed to the template rather than
// written twice.
const DEFAULT_VERIFICATION_TTL_DAYS = 7;

export function invitationTtlDays() {
  return Number(process.env.GUARDIAN_INVITATION_TTL_DAYS) || DEFAULT_INVITATION_TTL_DAYS;
}

export function verificationTtlDays() {
  return Number(process.env.EMAIL_VERIFICATION_TTL_DAYS) || DEFAULT_VERIFICATION_TTL_DAYS;
}

// Hours, not days. A reset link changes the credentials of an account that
// already works, where an invitation only opens one that never has — so the
// window is deliberately much shorter. Implemented as a marked default; no
// document sets one.
const DEFAULT_PASSWORD_RESET_TTL_HOURS = 1;

export function passwordResetTtlHours() {
  return Number(process.env.PASSWORD_RESET_TTL_HOURS) || DEFAULT_PASSWORD_RESET_TTL_HOURS;
}

function hoursToMilliseconds(hours) {
  return hours * 60 * 60 * 1000;
}

function daysToMilliseconds(days) {
  return hoursToMilliseconds(days * 24);
}

/**
 * Issues a token and returns its raw value alongside the stored row. The raw
 * value is returned once and is not retrievable afterwards — step 1.6 puts it
 * in an email and nothing else ever sees it.
 */
export async function issueGuardianInvitation(userId, client, { now = new Date() } = {}) {
  return issueOneTimeToken(
    GUARDIAN_INVITATION,
    userId,
    daysToMilliseconds(invitationTtlDays()),
    client,
    now,
  );
}

/**
 * Issues the learner's email-verification token. D8's second purpose, on the
 * same table and the same mechanism — which is the whole point of there being
 * one table rather than three.
 */
export async function issueEmailVerification(userId, client, { now = new Date() } = {}) {
  return issueOneTimeToken(
    EMAIL_VERIFICATION,
    userId,
    daysToMilliseconds(verificationTtlDays()),
    client,
    now,
  );
}

/**
 * D8's third purpose, on the same table and the same mechanism. Nothing about
 * reset is special enough to deserve its own — which is the argument D8 makes.
 */
export async function issuePasswordReset(userId, client, { now = new Date() } = {}) {
  return issueOneTimeToken(
    PASSWORD_RESET,
    userId,
    hoursToMilliseconds(passwordResetTtlHours()),
    client,
    now,
  );
}

async function issueOneTimeToken(purpose, userId, ttlMilliseconds, client, now) {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  const expiresAt = new Date(now.getTime() + ttlMilliseconds);

  const oneTimeToken = await createOneTimeToken(
    { userId, purpose, tokenHash: hashOneTimeToken(purpose, token), expiresAt },
    client,
  );

  return { token, oneTimeToken, expiresAt };
}

/**
 * Resolves a raw token without redeeming it, or null.
 *
 * Null covers unknown, already consumed, and expired alike: the caller has no
 * use for the difference, and a specific message would tell a stranger which
 * of those a token is.
 */
export async function resolveOneTimeToken(
  purpose,
  token,
  { now = new Date(), client = undefined } = {},
) {
  if (typeof token !== 'string' || token.length === 0) return null;

  const row = await findOneTimeTokenByHash(hashOneTimeToken(purpose, token), client);
  if (!row) return null;

  if (row.purpose !== purpose) return null;
  if (row.consumedAt !== null) return null;
  if (row.expiresAt <= now) return null;

  return row;
}

/**
 * Redeems a token, returning the row it redeemed or null if it was not
 * redeemable. Single-use is enforced by the repository's conditional update,
 * not by the check above it, so two simultaneous redemptions cannot both win.
 */
export async function redeemOneTimeToken(
  purpose,
  token,
  { now = new Date(), client = undefined } = {},
) {
  const row = await resolveOneTimeToken(purpose, token, { now, client });
  if (!row) return null;

  const consumed = await consumeOneTimeToken(row.id, now, client);
  if (!consumed) return null;

  return row;
}

/**
 * Claims a guardian invitation: sets the password, activates the account, and
 * burns the token — one transaction, so a claim that fails halfway leaves the
 * token unspent rather than the guardian locked out of an account they now own.
 *
 * Returns the activated user, or null if the token was not claimable. Null
 * covers unknown, expired, already consumed, and an account no longer eligible,
 * because the caller has no use for the difference.
 */
export async function claimGuardianInvitation(
  { token, password },
  { now = new Date() } = {},
) {
  // Derived before the transaction opens. scrypt is deliberately slow, and
  // holding a database transaction open across it would hold its locks for the
  // whole derivation.
  const passwordHash = await hashPassword(password);

  return prisma.$transaction(async (tx) => {
    const row = await resolveOneTimeToken(GUARDIAN_INVITATION, token, {
      now,
      client: tx,
    });
    if (!row) return null;

    // Only an unclaimed stub can be claimed — per D5, that is `pending`.
    //
    // This is not belt and braces. A guardian named for two learners before
    // claiming holds two live tokens (1.4 issues one per learner). After the
    // first claim the second is still unconsumed and unexpired, and without
    // this check presenting it would set a new password on an active account
    // from a link, with no old password required. That is a password reset
    // wearing an invitation's clothes, and 1.8 owns password resets.
    if (row.user.status !== 'pending') return null;

    const consumed = await consumeOneTimeToken(row.id, now, tx);
    if (!consumed) return null;

    // Per D18, `emailVerifiedAt` is stamped here with the same timestamp that
    // burned the token. Redeeming a single-use link sent to that address is
    // proof of control over it, which is what verification asserts — and there
    // is no guardian verification email to assert it a second time.
    //
    // This does not blur D5: verification is still a timestamp, not a status,
    // and `status` moves pending to enabled on its own account.
    return tx.user.update({
      where: { id: row.userId },
      data: { passwordHash, status: 'enabled', emailVerifiedAt: now },
      select: {
        id: true,
        email: true,
        fullName: true,
        status: true,
        emailVerifiedAt: true,
      },
    });
  });
}
