// The guardian invitation email.
//
// Sent when a learner registers and names a guardian who has no account yet.
// It carries the single-use claim link from step 1.4's token; the guardian sets
// a password at step 1.7 and the stub stops being `pending`.
//
// Per the contract in README.md: this takes values, not records — the claim URL
// rather than the token row — and returns both halves of the message.
//
// The draft copy was approved rather than invented. It deliberately does not
// name a course: registration happens before any enrolment exists, so at the
// moment this sends there is no cohort to refer to.

import { escapeHtml, layout } from './shell.js';

export function guardianInvitation({ learnerName, claimUrl, expiresInDays }) {
  const subject = `You have been named as a guardian for ${learnerName}`;

  // The stated expiry is passed in rather than written here, so the words
  // cannot drift from the token's actual lifetime.
  const expiry = `This link can be used once and expires in ${expiresInDays} days.`;

  const text = [
    `${learnerName} has registered and named you as their guardian.`,
    '',
    'Setting up your account lets you follow their progress, see their',
    'attendance and grades, and view the payment schedule. You can also pay on',
    'their behalf.',
    '',
    'Set your password:',
    claimUrl,
    '',
    expiry,
    '',
    'If you were not expecting this, you can ignore this email and no account',
    'will be created.',
  ].join('\n');

  const html = layout(`
    <p>${escapeHtml(learnerName)} has registered and named you as their guardian.</p>
    <p>
      Setting up your account lets you follow their progress, see their
      attendance and grades, and view the payment schedule. You can also pay on
      their behalf.
    </p>
    <p><a class="action" href="${escapeHtml(claimUrl)}">Set your password</a></p>
    <p class="fallback">
      If the link does not work, copy this into your browser:<br />
      <span class="url">${escapeHtml(claimUrl)}</span>
    </p>
    <p class="note">${escapeHtml(expiry)}</p>
    <p class="note">
      If you were not expecting this, you can ignore this email and no account
      will be created.
    </p>
  `);

  return { subject, text, html };
}
