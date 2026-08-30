// Guardian claim input, shared by the API route boundary and the claim page.
//
// The token arrives in the link the invitation email carried (step 1.6), so the
// form's only real field is the password — but the token is validated here too,
// because the endpoint must not reach the database with an empty string and
// call the result "not found".
//
// The password rules are D16's, imported rather than restated.

import { z } from 'zod';

import { password } from './password.js';

const token = z
  .string({ error: 'This link is missing its token' })
  .trim()
  .min(1, 'This link is missing its token');

export const claimSchema = z.object({
  token,
  password,
});
