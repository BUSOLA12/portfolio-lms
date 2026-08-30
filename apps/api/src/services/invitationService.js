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

import {
  consumeOneTimeToken,
  createOneTimeToken,
  findOneTimeTokenByHash,
} from '../repositories/oneTimeTokenRepository.js';

const TOKEN_BYTES = 32;

export const GUARDIAN_INVITATION = 'guardian_invitation';

// No document sets an invitation lifetime. Seven days is an engineering
// default — long enough to survive a weekend and an unchecked inbox, short
// enough that a forwarded email stops working. Overridable, and worth
// confirming before 1.6 sends real ones.
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

function invitationTtlMilliseconds() {
  const days =
    Number(process.env.GUARDIAN_INVITATION_TTL_DAYS) || DEFAULT_INVITATION_TTL_DAYS;
  return days * 24 * 60 * 60 * 1000;
}

/**
 * Issues a token and returns its raw value alongside the stored row. The raw
 * value is returned once and is not retrievable afterwards — step 1.6 puts it
 * in an email and nothing else ever sees it.
 */
export async function issueGuardianInvitation(userId, client, { now = new Date() } = {}) {
  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  const expiresAt = new Date(now.getTime() + invitationTtlMilliseconds());

  const oneTimeToken = await createOneTimeToken(
    {
      userId,
      purpose: GUARDIAN_INVITATION,
      tokenHash: hashOneTimeToken(GUARDIAN_INVITATION, token),
      expiresAt,
    },
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
export async function resolveOneTimeToken(purpose, token, { now = new Date() } = {}) {
  if (typeof token !== 'string' || token.length === 0) return null;

  const row = await findOneTimeTokenByHash(hashOneTimeToken(purpose, token));
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
export async function redeemOneTimeToken(purpose, token, { now = new Date() } = {}) {
  const row = await resolveOneTimeToken(purpose, token, { now });
  if (!row) return null;

  const consumed = await consumeOneTimeToken(row.id, now);
  if (!consumed) return null;

  return row;
}
