// Auth request handling: validate at the boundary, delegate, shape the reply.
//
// Validation failures are answered here rather than thrown to the error
// middleware, because they carry a `fields` map that the shared error envelope
// has no room for. If a later step wants that map on every endpoint, hoisting
// it into `middleware/error.js` is the move — it is deliberately not done here,
// where only one endpoint needs it.

import {
  claimSchema,
  fieldErrors,
  invitationResendSchema,
  loginSchema,
  passwordResetRequestSchema,
  passwordResetSchema,
  registrationSchema,
} from '@platform/schemas';

import {
  RegistrationConflictError,
  registerLearner,
} from '../services/registrationService.js';
import { claimGuardianInvitation } from '../services/invitationService.js';
import { resendGuardianInvitation } from '../services/guardianshipService.js';
import {
  authenticate,
  publicUser,
  resolveRoleStanding,
} from '../services/authService.js';
import {
  clearAuthCookie,
  issueAuthSession,
  readAuthCookie,
  resolveAuthSession,
  revokeAuthSession,
  setAuthCookie,
} from '../services/authSessionService.js';
import {
  completePasswordReset,
  requestPasswordReset,
} from '../services/passwordResetService.js';

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
    // Only the learner is echoed back. The guardian stub and its invitation
    // token stay server-side — the person filling in this form is not
    // necessarily the guardian, and the token is step 1.6's to email.
    const { user } = await registerLearner(parsed.data);
    res.status(201).json({ user });
  } catch (error) {
    if (error instanceof RegistrationConflictError) {
      respondWithFieldErrors(res, error.status, error.message, error.fields);
      return;
    }
    next(error);
  }
}

export async function claim(req, res, next) {
  const parsed = claimSchema.safeParse(req.body);

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
    const user = await claimGuardianInvitation(parsed.data);

    // One message for every way a token can fail — unknown, expired, already
    // used, account no longer eligible. The distinction is of no use to the
    // person holding the link, and naming it would tell a stranger which.
    if (user === null) {
      respondWithFieldErrors(res, 422, 'This invitation cannot be used', {
        token: 'This link has expired or has already been used',
      });
      return;
    }

    // No auth session is issued here. Logging in is step 1.8; the claim page
    // sends the guardian to sign in with the password they just set.
    res.status(200).json({ user });
  } catch (error) {
    next(error);
  }
}

export async function login(req, res, next) {
  const parsed = loginSchema.safeParse(req.body);

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
    const user = await authenticate(parsed.data.email, parsed.data.password);

    // 401 with one message for every cause. Naming which of the address or the
    // password was wrong would make this endpoint a register of who has an
    // account here.
    if (user === null) {
      res.status(401).json({
        error: {
          status: 401,
          message: 'Those credentials do not match an account',
        },
      });
      return;
    }

    const { token, expiresAt } = await issueAuthSession(user, {
      userAgent: req.get('user-agent') ?? null,
    });
    setAuthCookie(res, token, expiresAt);

    res.status(200).json({ user, standing: await resolveRoleStanding(user.id) });
  } catch (error) {
    next(error);
  }
}

/**
 * Logout is deliberately not behind requireAuth. Presenting a cookie that has
 * already lapsed should still clear it, not answer 401 — the caller's intent is
 * satisfied either way, so this always answers 204.
 */
export async function logout(req, res, next) {
  try {
    const token = readAuthCookie(req);
    const resolved = token === null ? null : await resolveAuthSession(token);

    if (resolved !== null) {
      await revokeAuthSession(resolved.authSession.id);
    }

    clearAuthCookie(res);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
}

/** Requires requireAuth, which has already resolved the session and the user. */
export async function me(req, res, next) {
  try {
    res.status(200).json({
      user: publicUser(req.user),
      standing: await resolveRoleStanding(req.user.id),
    });
  } catch (error) {
    next(error);
  }
}

export async function requestReset(req, res, next) {
  const parsed = passwordResetRequestSchema.safeParse(req.body);

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
    await requestPasswordReset(parsed.data.email);

    // 202 whether or not an account exists, with the same body. The service
    // decides silently whether anything was sent.
    res.status(202).json({
      message: 'If that address has an account, a reset link is on its way',
    });
  } catch (error) {
    next(error);
  }
}

export async function completeReset(req, res, next) {
  const parsed = passwordResetSchema.safeParse(req.body);

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
    const user = await completePasswordReset(parsed.data);

    if (user === null) {
      respondWithFieldErrors(res, 422, 'This reset link cannot be used', {
        token: 'This link has expired or has already been used',
      });
      return;
    }

    // No session is issued: a reset has just revoked every session this account
    // had, and issuing a fresh one here would undo that for whoever holds the
    // link. They sign in with the password they just set.
    res.status(200).json({ user });
  } catch (error) {
    next(error);
  }
}

/**
 * Per D19. A pending guardian whose invitation lapsed has no other route in —
 * claiming needs a live token and the reset at 1.8 serves only enabled
 * accounts.
 *
 * Rate limiting is step 1.9's and this endpoint depends on it: unthrottled, it
 * posts mail to any address a caller names.
 */
export async function resendInvitation(req, res, next) {
  const parsed = invitationResendSchema.safeParse(req.body);

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
    await resendGuardianInvitation(parsed.data.email);

    // 202 and the same body whatever happened, as the reset does. The service
    // decides silently whether there was anything to send.
    res.status(202).json({
      message: 'If that address has an invitation waiting, a new link is on its way',
    });
  } catch (error) {
    next(error);
  }
}
