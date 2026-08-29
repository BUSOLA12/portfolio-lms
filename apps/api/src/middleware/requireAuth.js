// Gate for authenticated routes.
//
// Reads the auth session cookie, resolves it against the database on every
// request, and refuses anything that does not come back. There is deliberately
// no caching layer here: a cached decision is the JWT problem wearing a
// different hat, and CLAUDE.md rule 5 rules it out.
//
// On success the request carries `req.user` (without its password hash) and
// `req.authSession`. Later steps read those; nothing downstream re-reads the
// cookie.

import { readAuthCookie, resolveAuthSession } from '../services/authSessionService.js';

function unauthorised() {
  const error = new Error('Authentication required');
  error.status = 401;
  return error;
}

export async function requireAuth(req, res, next) {
  try {
    const token = readAuthCookie(req);

    const resolved = token === null ? null : await resolveAuthSession(token);
    if (resolved === null) {
      next(unauthorised());
      return;
    }

    req.user = resolved.user;
    req.authSession = resolved.authSession;

    next();
  } catch (error) {
    next(error);
  }
}

export default requireAuth;
