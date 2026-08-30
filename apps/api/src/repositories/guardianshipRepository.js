// Data access for `guardianships`. Prisma calls only.
//
// CLAUDE.md rule 6: guardian permissions are relationship-scoped. This table is
// what makes that checkable, so every read here is by the pair or by one side
// of it — never a global "is a guardian" lookup, which is the shape the rule
// exists to prevent.

import { prisma } from '../db/client.js';

export function createGuardianship(
  { guardianId, learnerId, relationship },
  client = prisma,
) {
  return client.guardianship.create({
    data: { guardianId, learnerId, relationship },
  });
}

/**
 * The relationship-scoped check itself: does a row link this guardian to this
 * learner? The unique constraint on the pair makes it a single-row lookup.
 */
export function findGuardianship(guardianId, learnerId, client = prisma) {
  return client.guardianship.findUnique({
    where: { guardianId_learnerId: { guardianId, learnerId } },
  });
}
