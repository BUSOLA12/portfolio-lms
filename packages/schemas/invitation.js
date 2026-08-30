// Guardian invitation resend input.
//
// Only an address. Per D19 the endpoint answers identically whether or not
// that address exists or is eligible, so nothing else is needed and nothing
// else may be returned.

import { z } from 'zod';

export const invitationResendSchema = z.object({
  email: z
    .string({ error: 'Enter your email address' })
    .trim()
    .toLowerCase()
    .min(1, 'Enter your email address')
    .max(254, 'That email address is too long'),
});
