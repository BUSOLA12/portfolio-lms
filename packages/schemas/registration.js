// Registration input, shared by the API route boundary and the web form.
//
// The `relationship` field is the discriminant: `self` means the learner is
// registering for themselves, `guardian` means an adult is named alongside
// them. Modelling it as a discriminated union is what makes the guardian
// fields conditionally required without a second schema and without an `if`
// in two codebases that could drift apart.
//
// Note the terminology collision, and keep it straight: this `relationship`
// answers "who is registering" and is a fixed pair of values. The
// `guardianships.relationship` column answers "how is the guardian related to
// this learner" and is free text. They are different questions.

import { z } from 'zod';

// No document sets a password policy. These are engineering defaults, chosen
// along NIST 800-63B lines — a length floor, no composition rules, and an
// upper bound so an unbounded string cannot be handed to the key derivation.
// Worth confirming before launch.
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;

const NAME_MAX = 120;

const fullName = z
  .string({ error: 'Enter a full name' })
  .trim()
  .min(1, 'Enter a full name')
  .max(NAME_MAX, `Keep the name under ${NAME_MAX} characters`);

// Lowercased here rather than at the database, so the value the form validates
// is the value that gets stored and the unique constraint sees one casing.
const email = z
  .string({ error: 'Enter an email address' })
  .trim()
  .toLowerCase()
  .min(1, 'Enter an email address')
  .max(254, 'That email address is too long')
  .pipe(z.email('Enter a valid email address'));

const phone = z
  .string({ error: 'Enter a phone number' })
  .trim()
  .min(1, 'Enter a phone number')
  .max(32, 'That phone number is too long');

const password = z
  .string({ error: 'Enter a password' })
  .min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters`)
  .max(PASSWORD_MAX, `Keep the password under ${PASSWORD_MAX} characters`);

// Fields common to both branches. `phone` is optional because `users.phone` is
// nullable; the learner's own number is not named as a required field anywhere.
const learnerFields = {
  fullName,
  email,
  phone: phone.optional(),
  password,
};

/// Brief section 6.1: "Selecting guardian reveals conditional fields for the
/// guardian's name, email, and contact details." All three are required — the
/// name and email because step 1.4 creates a stub account and emails an
/// invitation to them, the phone because the brief names it.
const guardianDetails = z.object({
  fullName,
  email,
  phone,
});

export const registrationSchema = z
  .discriminatedUnion('relationship', [
    z.object({
      relationship: z.literal('self'),
      ...learnerFields,
    }),
    z.object({
      relationship: z.literal('guardian'),
      ...learnerFields,
      // `prefault` rather than `optional`: when the object is absent entirely,
      // the empty default is still validated, so each missing field reports its
      // own error instead of one opaque "guardian is required" on the parent.
      guardian: guardianDetails.prefault({}),
    }),
  ])
  .check((ctx) => {
    // One person cannot be their own guardian. Caught here rather than at the
    // database, where it would surface as a unique-constraint violation on the
    // stub account step 1.4 tries to create.
    const value = ctx.value;
    if (value.relationship === 'guardian' && value.guardian.email === value.email) {
      ctx.issues.push({
        code: 'custom',
        input: value.guardian.email,
        path: ['guardian', 'email'],
        message: 'Use a different address from the learner’s',
      });
    }
  });

/**
 * Flattens Zod issues into `{ 'guardian.email': 'message' }`, which is the
 * shape a form binds to. First message per path wins: a field shows one error,
 * not a stack of them.
 */
export function fieldErrors(error) {
  const fields = {};

  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_';
    if (!(key in fields)) {
      fields[key] = issue.message;
    }
  }

  return fields;
}
