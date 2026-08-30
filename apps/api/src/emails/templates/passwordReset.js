// The password reset email.
//
// Carries a single-use link on D8's third purpose. Copy approved rather than
// invented, in the register the other two emails use.
//
// Per the contract in README.md: values, not records, and both halves of the
// message.

import { escapeHtml, layout } from './shell.js';

export function passwordReset({ name, resetUrl, expiresInHours }) {
  const subject = 'Reset your password';

  // Read from the token's real lifetime, as at 1.6, so the words cannot drift.
  const hours = expiresInHours === 1 ? '1 hour' : `${expiresInHours} hours`;
  const expiry = `This link can be used once and expires in ${hours}.`;

  const text = [
    `Hello ${name},`,
    '',
    'A password reset was requested for this account.',
    '',
    'Set a new password:',
    resetUrl,
    '',
    expiry,
    '',
    'If you did not request this, you can ignore this email and your password',
    'will not change.',
  ].join('\n');

  const html = layout(`
    <p>Hello ${escapeHtml(name)},</p>
    <p>A password reset was requested for this account.</p>
    <p><a class="action" href="${escapeHtml(resetUrl)}">Set a new password</a></p>
    <p class="fallback">
      If the link does not work, copy this into your browser:<br />
      <span class="url">${escapeHtml(resetUrl)}</span>
    </p>
    <p class="note">${escapeHtml(expiry)}</p>
    <p class="note">
      If you did not request this, you can ignore this email and your password
      will not change.
    </p>
  `);

  return { subject, text, html };
}
