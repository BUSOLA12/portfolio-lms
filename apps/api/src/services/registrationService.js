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
import {
  EMAIL_VERIFICATION,
  GUARDIAN_INVITATION,
  invitationTtlDays,
  issueEmailVerification,
  verificationTtlDays,
} from './invitationService.js';
import { sendEmail } from './emailService.js';
import { guardianInvitation } from '../emails/templates/guardianInvitation.js';
import { emailVerification } from '../emails/templates/emailVerification.js';

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

// Deep links into the web app. The pages are step 1.11's; the paths are fixed
// here because the email has to name one now.
function claimUrl(token) {
  return `${requireWebOrigin()}/claim?token=${encodeURIComponent(token)}`;
}

function verifyUrl(token) {
  return `${requireWebOrigin()}/verify?token=${encodeURIComponent(token)}`;
}

function requireWebOrigin() {
  const origin = process.env.WEB_ORIGIN;
  if (!origin) {
    throw new Error('WEB_ORIGIN is not set. Emails cannot deep-link without it.');
  }
  return origin.replace(/\/+$/, '');
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
export async function registerLearner(input, { emailProvider } = {}) {
  const passwordHash = await hashPassword(input.password);

  let outcome;

  try {
    // One transaction. A learner whose guardianship row failed to write would
    // be a half registration that nothing downstream could detect — rule 6's
    // permission check would simply find no row and deny access, silently.
    outcome = await prisma.$transaction(async (tx) => {
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

      // Every registration verifies its address, self or guardian-linked.
      const verification = await issueEmailVerification(learner.id, tx);

      if (input.relationship !== 'guardian') {
        return { user: learner, verification, guardian: null, invitation: null };
      }

      const { guardian, invitation } = await linkGuardianToLearner(
        tx,
        learner,
        input.guardian,
      );

      // The raw tokens leave the transaction once, to be posted below. They are
      // deliberately not part of the endpoint's response body: whoever fills in
      // the registration form is not necessarily the guardian.
      return { user: learner, verification, guardian, invitation };
    });
  } catch (error) {
    if (error.code === UNIQUE_VIOLATION && error.meta?.target?.includes('email')) {
      throw new RegistrationConflictError({
        email: 'An account with that email address already exists',
      });
    }
    throw error;
  }

  // Strictly after the commit. Sending inside the transaction would hold a
  // database lock open for as long as the provider takes, and an email sent
  // inside a transaction that then rolled back cannot be recalled.
  await deliverRegistrationEmails(outcome, emailProvider);

  return { user: outcome.user };
}

/**
 * Posts the two registration emails.
 *
 * Failures are logged, not thrown: the account exists and the response is
 * already earned, and turning a provider outage into a 500 would send the
 * learner back to a form that now rejects their address as taken. Because
 * `email_log` records only sends that succeeded, a missing row is exactly the
 * signal a resend would look for.
 */
async function deliverRegistrationEmails(outcome, provider) {
  const { user, verification, guardian, invitation } = outcome;

  await post(() =>
    sendEmail({
      user,
      type: EMAIL_VERIFICATION,
      template: emailVerification({
        learnerName: user.fullName,
        verifyUrl: verifyUrl(verification.token),
        expiresInDays: verificationTtlDays(),
      }),
      provider,
    }),
  );

  // No invitation means the named guardian already had an account, so there is
  // nothing to claim — see step 1.4.
  if (invitation === null) return;

  await post(() =>
    sendEmail({
      user: guardian,
      type: GUARDIAN_INVITATION,
      // Scoped to the learner, not left null: one guardian may be invited for
      // two children, and a null entity would let the guard suppress the
      // second invitation as a duplicate of the first.
      entityRef: user.id,
      template: guardianInvitation({
        learnerName: user.fullName,
        claimUrl: claimUrl(invitation.token),
        expiresInDays: invitationTtlDays(),
      }),
      provider,
    }),
  );
}

async function post(send) {
  try {
    await send();
  } catch (error) {
    console.error('Registration email failed to send', error);
  }
}
