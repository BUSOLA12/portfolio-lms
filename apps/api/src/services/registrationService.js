// Registration.
//
// Takes input that has already been validated by the shared schema and writes
// the learner's user row.
//
// The guardian branch stops short here, deliberately. Step 1.4 owns the stub
// account, the `guardianships` row, and the invitation token; this step's
// done-when says a registration creates *one* user, against 1.4's "produces a
// pending stub user, a guardianship row, and a token". The validated guardian
// details are therefore accepted and left at the seam below rather than half
// acted on.

import { prisma } from '../db/client.js';
import { hashPassword } from './passwordService.js';

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
    const learner = await prisma.user.create({
      data: {
        email: input.email,
        fullName: input.fullName,
        phone: input.phone ?? null,
        passwordHash,
        status: 'enabled',
      },
      select: {
        id: true,
        email: true,
        fullName: true,
        phone: true,
        status: true,
        emailVerifiedAt: true,
        createdAt: true,
      },
    });

    // Seam for step 1.4. When `input.relationship === 'guardian'`,
    // `input.guardian` holds the validated name, email and phone, and 1.4
    // creates the stub account, the guardianship row and the invitation token
    // from them — inside a transaction with the row created above.

    return learner;
  } catch (error) {
    if (error.code === UNIQUE_VIOLATION && error.meta?.target?.includes('email')) {
      throw new RegistrationConflictError({
        email: 'An account with that email address already exists',
      });
    }
    throw error;
  }
}
