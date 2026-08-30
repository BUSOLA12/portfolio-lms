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
import { prisma } from '../db/client.js';
import { guardianInvitation } from '../emails/templates/guardianInvitation.js';
import { sendEmail } from './emailService.js';
import { invitationTtlDays, issueGuardianInvitation } from './invitationService.js';

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

/// Per D19. A resend is a distinct event from the invitation registration sent
/// automatically, so it carries its own `email_log` type. Keeping them apart
/// means the log says which messages the system sent and which a person asked
/// for, and it keeps 1.5's guard scoped per request rather than per learner —
/// a resend must never be suppressed as a duplicate of the original.
export const GUARDIAN_INVITATION_RESEND = 'guardian_invitation_resend';

function requireWebOrigin() {
  const origin = process.env.WEB_ORIGIN;
  if (!origin) {
    throw new Error('WEB_ORIGIN is not set. Emails cannot deep-link without it.');
  }
  return origin.replace(/\/+$/, '');
}

/**
 * Issues a fresh invitation for a guardian stub whose original link has lapsed.
 *
 * Per D19 this exists because that account otherwise has no route in at all:
 * claiming needs a live token, and the password reset at 1.8 serves only
 * `enabled` accounts. A guardian who leaves the email a week is locked out
 * permanently, which is what real parents will do.
 *
 * Returns nothing, and the caller answers identically either way. A response
 * that distinguished "sent" from "no such account" would be a way to test which
 * addresses are registered, and — worse here than at 1.8 — which of them belong
 * to unclaimed accounts.
 *
 * **Rate limiting is step 1.9's, and this endpoint needs it.** Unthrottled, it
 * will post mail to any address a caller names, as fast as they can ask.
 */
export async function resendGuardianInvitation(email, { emailProvider } = {}) {
  const guardian = await prisma.user.findUnique({ where: { email } });

  // Only an unclaimed stub, per D5. An enabled account has a password and a
  // reset; a suspended one should not be handed a way back in.
  if (!guardian || guardian.status !== 'pending') return;

  // The email names the learner, so there must be one. A pending account with
  // no guardianship is not a guardian stub and gets nothing.
  const guardianship = await prisma.guardianship.findFirst({
    where: { guardianId: guardian.id },
    include: { learner: true },
    orderBy: { createdAt: 'desc' },
  });
  if (!guardianship) return;

  // One link is enough however many learners they are named for: claiming
  // activates the account, and every guardianship they hold then works. The
  // most recent is used because it is the one they are most likely to be
  // expecting mail about.
  const { token, oneTimeToken } = await issueGuardianInvitation(guardian.id);

  try {
    await sendEmail({
      user: guardian,
      type: GUARDIAN_INVITATION_RESEND,
      // Scoped to the token, so each request sends. The original invitation
      // scopes to the learner instead, because there its job is to stop a
      // second automatic send for the same child.
      entityRef: oneTimeToken.id,
      template: guardianInvitation({
        learnerName: guardianship.learner.fullName,
        claimUrl: `${requireWebOrigin()}/claim?token=${encodeURIComponent(token)}`,
        expiresInDays: invitationTtlDays(),
      }),
      provider: emailProvider,
    });
  } catch (error) {
    // As at 1.6 and 1.8: a provider outage must not become a distinguishable
    // failure, and no `email_log` row means a later request sends again.
    console.error('Guardian invitation resend failed to send', error);
  }
}
