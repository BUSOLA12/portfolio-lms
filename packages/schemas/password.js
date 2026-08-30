// The password field, defined once.
//
// Per D16 the policy is NIST 800-63B shaped: a length floor, an upper bound,
// and no composition rules — no mixed case, no digit, no symbol. Composition
// requirements push people toward predictable shapes and produce weaker
// passwords in practice, which is why NIST dropped them. Length is what counts.
// The ceiling is operational rather than a security limit: an unbounded string
// should never reach the key derivation.
//
// Shared rather than restated, because three flows set a password — registration
// at 1.3, the guardian claim at 1.7, the reset at 1.8 — and a policy written
// out three times is a policy that will differ in one of them.

import { z } from 'zod';

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

export const password = z
  .string({ error: 'Enter a password' })
  .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters`)
  .max(PASSWORD_MAX, `Keep the password under ${PASSWORD_MAX} characters`);
