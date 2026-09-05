// Shared Zod schemas. Populated from step 1.3 onward.
//
// Every schema defined here is imported by both the API route boundary and the
// corresponding web form, so validation cannot drift between the two.
//
// Export one named schema per file, re-exported below.

export { registrationSchema, fieldErrors } from './registration.js';
export { claimSchema } from './claim.js';
export { invitationResendSchema } from './invitation.js';
export { loginSchema } from './login.js';
export { verificationSchema } from './verification.js';
export { passwordResetRequestSchema, passwordResetSchema } from './passwordReset.js';
export { password, PASSWORD_MIN, PASSWORD_MAX } from './password.js';
