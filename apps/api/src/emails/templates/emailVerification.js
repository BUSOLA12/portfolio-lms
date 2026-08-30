// The learner email-verification email.
//
// Sent on every registration, self or guardian-linked. The link carries a
// single-use `email_verification` token (D8's second purpose); redeeming it
// stamps `users.email_verified_at`, which per D5 is where verification lives —
// it is a timestamp, not a status.
//
// Per the contract in README.md: values, not records, and both halves of the
// message. Copy approved rather than invented.

import { escapeHtml, layout } from './shell.js';

export function emailVerification({ learnerName, verifyUrl, expiresInDays }) {
  const subject = 'Confirm your email address';

  // Passed in rather than written here, so the words cannot drift from the
  // token's actual lifetime.
  const expiry = `This link can be used once and expires in ${expiresInDays} days.`;

  const text = [
    `Hello ${learnerName},`,
    '',
    'Confirm this address to finish setting up your account.',
    '',
    'Confirm:',
    verifyUrl,
    '',
    expiry,
    '',
    'If you did not create an account, you can ignore this email.',
  ].join('\n');

  const html = layout(`
    <p>Hello ${escapeHtml(learnerName)},</p>
    <p>Confirm this address to finish setting up your account.</p>
    <p><a class="action" href="${escapeHtml(verifyUrl)}">Confirm your email</a></p>
    <p class="fallback">
      If the link does not work, copy this into your browser:<br />
      <span class="url">${escapeHtml(verifyUrl)}</span>
    </p>
    <p class="note">${escapeHtml(expiry)}</p>
    <p class="note">If you did not create an account, you can ignore this email.</p>
  `);

  return { subject, text, html };
}
