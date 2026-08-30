// Password reset input, in two halves: asking for a link, and using one.
//
// The request carries only an address. The completion carries the token from
// the emailed link plus the new password, which does go through D16's rules —
// unlike login, this is a password being set rather than checked.

import { z } from 'zod';

import { password } from './password.js';

export const passwordResetRequestSchema = z.object({
  email: z
    .string({ error: 'Enter your email address' })
    .trim()
    .toLowerCase()
    .min(1, 'Enter your email address')
    .max(254, 'That email address is too long'),
});

export const passwordResetSchema = z.object({
  token: z
    .string({ error: 'This link is missing its token' })
    .trim()
    .min(1, 'This link is missing its token'),
  password,
});
