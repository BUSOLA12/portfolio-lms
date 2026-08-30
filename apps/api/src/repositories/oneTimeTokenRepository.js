// Data access for `one_time_tokens`. Prisma calls only.
//
// Every function takes an optional `client` so it can run inside a transaction
// — issuing an invitation happens in the same transaction as the registration
// that caused it. Defaulting to the shared client keeps the ordinary call site
// unchanged.
//
// As in `authSessionRepository`, no policy lives here: whether a token found by
// hash is still redeemable is the service's question.

import { prisma } from '../db/client.js';

export function createOneTimeToken(
  { userId, purpose, tokenHash, expiresAt },
  client = prisma,
) {
  return client.oneTimeToken.create({
    data: { userId, purpose, tokenHash, expiresAt },
  });
}

export function findOneTimeTokenByHash(tokenHash, client = prisma) {
  return client.oneTimeToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
}

/**
 * Stamps `consumed_at`, and reports whether this call is the one that did it.
 *
 * The `consumedAt: null` guard is what makes a token single-use under
 * concurrency: two simultaneous redemptions both read an unconsumed row, but
 * only one `updateMany` matches, so exactly one gets a count of 1. Checking
 * the column in JavaScript and then writing would let both through.
 */
export async function consumeOneTimeToken(id, consumedAt = new Date(), client = prisma) {
  const { count } = await client.oneTimeToken.updateMany({
    where: { id, consumedAt: null },
    data: { consumedAt },
  });
  return count === 1;
}
