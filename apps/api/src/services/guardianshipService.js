// Guardian stub accounts and the guardianship link.
//
// CLAUDE.md rule 6: a guardian is not an observer globally — they are an
// observer of one specific learner. The row this service writes is the entire
// basis of that check, so it is created in the same transaction as the learner
// it refers to. A learner without their guardianship row would be a half
// registration that no later step could detect.

import {
  createGuardianship,
  findGuardianship,
} from '../repositories/guardianshipRepository.js';
import { issueGuardianInvitation } from './invitationService.js';

/// Per D15. Applied here, at the service that writes the column, rather than as
/// a database default — so the stored value is always something the user or
/// this line chose deliberately. The column stays NOT NULL.
export const DEFAULT_RELATIONSHIP = 'guardian';

/**
 * Links a named guardian to a freshly registered learner.
 *
 * Returns the guardian account, the guardianship row, and the raw invitation
 * token when one was issued. Step 1.6 emails that token; nothing else sees it.
 *
 * `client` is the transaction the caller is already inside. This service does
 * not open its own: the stub, the link and the token belong to the same commit
 * as the learner, or to none of it.
 */
export async function linkGuardianToLearner(client, learner, details) {
  const guardian = await findOrCreateGuardianAccount(client, details);

  const guardianship = await createGuardianship(
    {
      guardianId: guardian.id,
      learnerId: learner.id,
      relationship: details.relationship ?? DEFAULT_RELATIONSHIP,
    },
    client,
  );

  // An invitation is a claim link, and there is nothing to claim on an account
  // that already has a password. Per D5 only a `pending` account is unclaimed,
  // so only that case gets a token — a parent registering a second child is
  // linked without being asked to set a password they already have.
  const invitation =
    guardian.status === 'pending'
      ? await issueGuardianInvitation(guardian.id, client)
      : null;

  return { guardian, guardianship, invitation };
}

/**
 * The stub, per D5: `pending`, and deliberately without a password. It is an
 * account created on someone's behalf, and it stays unclaimed until they set
 * one at step 1.7.
 *
 * An existing account is reused rather than duplicated. The brief allows one
 * person to be a learner on one course and a guardian for their child, and a
 * parent enrolling a second child must not collide with the unique constraint
 * on `users.email`.
 */
async function findOrCreateGuardianAccount(client, details) {
  const existing = await client.user.findUnique({ where: { email: details.email } });
  if (existing) return existing;

  return client.user.create({
    data: {
      email: details.email,
      fullName: details.fullName,
      phone: details.phone,
      status: 'pending',
    },
  });
}

/**
 * Whether this guardian may read this learner's data. Every guardian read
 * calls it — rule 6 exists because skipping it lets one guardian read another
 * learner's grades.
 */
export async function isGuardianOf(guardianId, learnerId, client) {
  const guardianship = await findGuardianship(guardianId, learnerId, client);
  return guardianship !== null;
}
