// Auth request handling: validate at the boundary, delegate, shape the reply.
//
// Validation failures are answered here rather than thrown to the error
// middleware, because they carry a `fields` map that the shared error envelope
// has no room for. If a later step wants that map on every endpoint, hoisting
// it into `middleware/error.js` is the move — it is deliberately not done here,
// where only one endpoint needs it.

import { fieldErrors, registrationSchema } from '@platform/schemas';

import {
  RegistrationConflictError,
  registerLearner,
} from '../services/registrationService.js';

// 422: the request was understood and well-formed JSON, but its contents did
// not validate. 400 would not distinguish it from unparseable input.
function respondWithFieldErrors(res, status, message, fields) {
  res.status(status).json({ error: { status, message, fields } });
}

export async function register(req, res, next) {
  const parsed = registrationSchema.safeParse(req.body);

  if (!parsed.success) {
    respondWithFieldErrors(
      res,
      422,
      'Check the highlighted fields',
      fieldErrors(parsed.error),
    );
    return;
  }

  try {
    const learner = await registerLearner(parsed.data);
    res.status(201).json({ user: learner });
  } catch (error) {
    if (error instanceof RegistrationConflictError) {
      respondWithFieldErrors(res, error.status, error.message, error.fields);
      return;
    }
    next(error);
  }
}
