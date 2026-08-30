// Registration.
//
// Takes input that has already been validated by the shared schema and writes
// the learner's user row.
//
// A `guardian` registration also creates the stub account, the guardianship
// row and the invitation token, all in one transaction — step 1.4. The stub is
// `pending` per D5 and holds no password until it is claimed at 1.7.

import { prisma } from '../db/client.js';
import { hashPassword } from './passwordService.js';
import { linkGuardianToLearner } from './guardianshipService.js';

/// Thrown when the input is well-formed but conflicts with what is already
/// stored. Carries field-level messages so the caller can answer the form in
/// the same shape a validation failure does.
export class RegistrationConflictError extends Error {
  constructor(fields) {
    super('Registration conflicts with an existing account');
    this.name = 'RegistrationConflictError';
    this.status = 409;
    this.fields = fields;
  }
}

// Never selected: the password hash has no business leaving this service.
const LEARNER_FIELDS = {
  id: true,
  email: true,
  fullName: true,
  phone: true,
  status: true,
  emailVerifiedAt: true,
  createdAt: true,
};

// Prisma's unique-constraint violation.
const UNIQUE_VIOLATION = 'P2002';

/**
 * Creates the learner's account and returns it without its password hash.
 *
 * Per D5 the row is `enabled`, not the column's `pending` default: the learner
 * has just set a password, and `pending` means an unclaimed stub with none.
 * Email verification is not a status — `email_verified_at` stays null and step
 * 1.6 fills it in.
 */
export async function registerLearner(input) {
  const passwordHash = await hashPassword(input.password);

  try {
    // One transaction. A learner whose guardianship row failed to write would
    // be a half registration that nothing downstream could detect — rule 6's
    // permission check would simply find no row and deny access, silently.
    return await prisma.$transaction(async (tx) => {
      const learner = await tx.user.create({
        data: {
          email: input.email,
          fullName: input.fullName,
          phone: input.phone ?? null,
          passwordHash,
          status: 'enabled',
        },
        select: LEARNER_FIELDS,
      });

      if (input.relationship !== 'guardian') {
        return { user: learner, guardian: null, invitationToken: null };
      }

      const { guardian, invitation } = await linkGuardianToLearner(
        tx,
        learner,
        input.guardian,
      );

      // The raw token leaves here once, for step 1.6 to put in an email. It is
      // deliberately not part of the endpoint's response body: whoever fills in
      // the registration form is not necessarily the guardian.
      return {
        user: learner,
        guardian: { id: guardian.id, email: guardian.email, status: guardian.status },
        invitationToken: invitation === null ? null : invitation.token,
      };
    });
  } catch (error) {
    if (error.code === UNIQUE_VIOLATION && error.meta?.target?.includes('email')) {
      throw new RegistrationConflictError({
        email: 'An account with that email address already exists',
      });
    }
    throw error;
  }
}
