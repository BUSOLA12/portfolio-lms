// Email verification input, shared by the API route boundary and the landing
// page that redeems the link.
//
// Only the token. The link carries it; there is nothing for a person to type.
// It is still validated, because the endpoint must not reach the database with
// an empty string and report the result as "not found".

import { z } from 'zod';

export const verificationSchema = z.object({
  token: z
    .string({ error: 'This link is missing its token' })
    .trim()
    .min(1, 'This link is missing its token'),
});
