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

// Per D16, the project's password policy: NIST 800-63B shaped. A length floor
// and no composition rules, because composition requirements push people toward
// predictable shapes and produce weaker passwords in practice. The ceiling is
// operational rather than a security limit — an unbounded string should never
// reach the key derivation.
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 128;

const NAME_MAX = 120;
const RELATIONSHIP_MAX = 60;

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

/// How this guardian relates to this learner — the value stored in the
/// `guardianships.relationship` column. Per D15: optional free text, no fixed
/// option list, because the range is too wide to enumerate before seeing real
/// data. Blank normalises to undefined rather than to an empty string, so the
/// service applying the `guardian` default at step 1.4 sees one absent value
/// and not two.
///
/// Note the collision, again: this answers "how are they related", while the
/// top-level `relationship` answers "who is registering".
const guardianRelationship = z
  .string({ error: 'Enter how the guardian is related' })
  .trim()
  .max(RELATIONSHIP_MAX, `Keep it under ${RELATIONSHIP_MAX} characters`)
  .transform((value) => (value === '' ? undefined : value))
  .optional();

/// Brief section 6.1: "Selecting guardian reveals conditional fields for the
/// guardian's name, email, and contact details." Those three are required — the
/// name and email because step 1.4 creates a stub account and emails an
/// invitation to them, the phone because the brief names it. The fourth,
/// `relationship`, is optional per D15.
const guardianDetails = z.object({
  fullName,
  email,
  phone,
  relationship: guardianRelationship,
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
