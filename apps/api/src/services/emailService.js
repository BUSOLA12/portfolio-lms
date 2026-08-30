// The one send interface, and the duplicate-send guard every later job depends
// on.
//
// CLAUDE.md rule 9: every scheduled email checks `email_log` first. Cron runs
// daily, so without this check a learner receives the same seven-day expiry
// warning every day for a week. The guard lives here rather than in each job,
// because a rule reimplemented in eight cron sweeps is a rule that will be
// forgotten in the ninth.
//
// A template is a plain function returning `{ subject, html, text }`. It knows
// nothing about the provider, the log, or the recipient's account — see
// `src/emails/templates/README.md`. The templates themselves arrive at 1.6.

import { findEmailSent, recordEmailSent } from '../repositories/emailLogRepository.js';
import { getEmailProvider } from './providers/emailProvider.js';

/// Returned instead of throwing when the guard refuses. A repeat is the
/// expected outcome on most days of a dunning window, not an error, and a cron
/// sweep should not have to catch an exception per learner it correctly skips.
export const SEND_SENT = 'sent';
export const SEND_ALREADY_SENT = 'already_sent';

function requireFrom() {
  const from = process.env.EMAIL_FROM;
  if (!from) {
    throw new Error('EMAIL_FROM is not set. Email cannot be sent without a sender.');
  }
  return from;
}

/**
 * Sends one email and records it, unless one of the same type for the same
 * entity has already gone to this user.
 *
 * `type` names the kind of mail (`guardian_invitation`, `expiry_warning_7d`).
 * `entityRef` narrows it to the thing the mail is about — an instalment id, an
 * enrollment id — so a reminder about instalment 2 is not suppressed by one
 * already sent about instalment 1. Null means the mail is about the account
 * itself, and one is all anybody gets.
 *
 * `provider` is injectable so tests can prove the guard refuses a repeat
 * before the transport is reached, which is the distinction the step's
 * done-when draws.
 */
export async function sendEmail({
  user,
  type,
  entityRef = null,
  template,
  provider = undefined,
}) {
  const existing = await findEmailSent({ userId: user.id, type, entityRef });

  if (existing) {
    return { status: SEND_ALREADY_SENT, emailLog: existing, sent: false };
  }

  const { subject, html, text } = template;

  // Send first, record second. The reverse order would mark a reminder as sent
  // when the transport had refused it, and the guard would then suppress every
  // retry — a learner silently never warned about an instalment. A crash
  // between the two costs one duplicate, which is the cheaper failure.
  await (provider ?? getEmailProvider()).send({
    from: requireFrom(),
    to: user.email,
    subject,
    html,
    text,
  });

  const emailLog = await recordEmailSent({ userId: user.id, type, entityRef });

  return { status: SEND_SENT, emailLog, sent: true };
}
