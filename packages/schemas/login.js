// Login input, shared by the API route boundary and the login form.
//
// The password is checked for presence only, deliberately — not against D16's
// rules. Login verifies a password that already exists; applying the policy
// here would reject a correct password if the policy ever tightened, telling
// the holder their password is wrong when it is the rules that changed.

import { z } from 'zod';

export const loginSchema = z.object({
  email: z
    .string({ error: 'Enter your email address' })
    .trim()
    .toLowerCase()
    .min(1, 'Enter your email address')
    .max(254, 'That email address is too long'),
  password: z.string({ error: 'Enter your password' }).min(1, 'Enter your password'),
});
