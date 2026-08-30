// Data access for `auth_sessions`. Prisma calls only.
//
// No policy lives here. Whether a row that exists is still *valid* — not
// revoked, not expired, belonging to an enabled user — is the service's
// question, and keeping it there is what lets the service be tested against
// the same row in both states.

import { prisma } from '../db/client.js';

export function createAuthSession({ userId, tokenHash, expiresAt, userAgent = null }) {
  return prisma.authSession.create({
    data: { userId, tokenHash, expiresAt, userAgent },
  });
}

/**
 * The presented token's hash is unique, so this resolves to at most one row.
 * The user is included because every caller needs the account's status in the
 * same breath — CLAUDE.md rule 5 exists so that a suspension is felt on the
 * next request, which means one round trip, not two.
 */
export function findAuthSessionByTokenHash(tokenHash) {
  return prisma.authSession.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
}

/**
 * `updateMany` rather than `update`: revoking an already-revoked or absent row
 * is a no-op instead of a throw, and the `revokedAt: null` guard means the
 * first revocation's timestamp is the one that stands. Returns the count.
 */
export async function revokeAuthSessionById(id, revokedAt = new Date()) {
  const { count } = await prisma.authSession.updateMany({
    where: { id, revokedAt: null },
    data: { revokedAt },
  });
  return count;
}

/**
 * Every live auth session for one user. This is what suspension and
 * "log out everywhere" reach for.
 */
export async function revokeAuthSessionsForUser(
  userId,
  revokedAt = new Date(),
  client = prisma,
) {
  const { count } = await client.authSession.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt },
  });
  return count;
}
