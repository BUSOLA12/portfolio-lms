// Auth session lifecycle: mint a token, carry it in a cookie, resolve it back
// to a user, revoke it.
//
// CLAUDE.md rule 5 — database sessions, not JWTs. Nothing here is
// self-validating: every resolution reads the row, so revoking it or
// suspending the account takes effect on the very next request. That is the
// whole reason this table exists, and it is why `resolveAuthSession` must
// never be replaced by a signature check.
//
// The raw token exists in exactly two places: the response cookie and the
// user's browser. The database stores only a keyed hash of it.

import { createHmac, randomBytes } from 'node:crypto';

import {
  createAuthSession,
  findAuthSessionByTokenHash,
  revokeAuthSessionById,
  revokeAuthSessionsForUser,
} from '../repositories/authSessionRepository.js';

// 256 bits of entropy. Not guessable, so the stored hash is not defending
// against a brute-force of the token itself — it defends against a database
// dump being directly replayable as a set of live cookies.
const TOKEN_BYTES = 32;

const DEFAULT_TTL_DAYS = 30;
const DEFAULT_COOKIE_NAME = 'auth_session';

// Lax is correct while the API is same-site with the web app. If the API ends
// up on a separate domain, this must become `none` (which browsers only honour
// alongside Secure) and CORS credentials must be configured to match. That
// choice is still open in docs/build-plan.md, so it is read from the
// environment rather than decided here.
const DEFAULT_SAME_SITE = 'lax';

function requireSecret() {
  const secret = process.env.AUTH_SESSION_SECRET;
  if (!secret) {
    throw new Error(
      'AUTH_SESSION_SECRET is not set. Auth sessions cannot be created or resolved without it.',
    );
  }
  return secret;
}

/**
 * Keyed hash, not a bare digest. An attacker holding only the table cannot
 * precompute against it without also holding the secret.
 */
export function hashAuthToken(token) {
  return createHmac('sha256', requireSecret()).update(token).digest('hex');
}

function generateAuthToken() {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

function ttlMilliseconds() {
  const days = Number(process.env.AUTH_SESSION_TTL_DAYS) || DEFAULT_TTL_DAYS;
  return days * 24 * 60 * 60 * 1000;
}

export function authCookieName() {
  return process.env.AUTH_SESSION_COOKIE_NAME || DEFAULT_COOKIE_NAME;
}

/**
 * One definition of the cookie's attributes, used for both setting and
 * clearing. A cleared cookie whose attributes differ from the one that was set
 * is a second cookie, and the original stays in the browser.
 */
export function authCookieOptions(expiresAt) {
  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.AUTH_COOKIE_SAMESITE || DEFAULT_SAME_SITE,
    path: '/',
  };

  if (process.env.AUTH_COOKIE_DOMAIN) {
    options.domain = process.env.AUTH_COOKIE_DOMAIN;
  }

  if (expiresAt) {
    options.expires = expiresAt;
  }

  return options;
}

export function setAuthCookie(res, token, expiresAt) {
  res.cookie(authCookieName(), token, authCookieOptions(expiresAt));
}

export function clearAuthCookie(res) {
  res.clearCookie(authCookieName(), authCookieOptions());
}

/**
 * Reads the raw token out of the request's Cookie header. Parsed here rather
 * than by middleware so that the cookie's name and encoding are defined in one
 * module alongside the code that writes it.
 */
export function readAuthCookie(req) {
  const header = req.headers?.cookie;
  if (!header) return null;

  const name = authCookieName();

  for (const pair of header.split(';')) {
    const separator = pair.indexOf('=');
    if (separator === -1) continue;

    if (pair.slice(0, separator).trim() !== name) continue;

    const value = pair.slice(separator + 1).trim();
    if (!value) return null;

    try {
      return decodeURIComponent(value);
    } catch {
      return null;
    }
  }

  return null;
}

// The password hash has no business travelling further into the request than
// the login check, so it is dropped the moment a user is read for a session.
function withoutPasswordHash(user) {
  const safe = { ...user };
  delete safe.passwordHash;
  return safe;
}

/**
 * Mints an auth session and returns the raw token alongside the stored row.
 * The token is returned once and never retrievable again — the caller hands it
 * straight to `setAuthCookie`.
 */
export async function issueAuthSession(user, { userAgent = null } = {}) {
  const token = generateAuthToken();
  const expiresAt = new Date(Date.now() + ttlMilliseconds());

  const authSession = await createAuthSession({
    userId: user.id,
    tokenHash: hashAuthToken(token),
    expiresAt,
    userAgent,
  });

  return { token, authSession, expiresAt };
}

/**
 * Resolves a raw token to its auth session and user, or null.
 *
 * Null covers every failure identically — unknown, revoked, expired,
 * or belonging to an account that is not `enabled` — because the caller has no
 * use for the distinction and a specific message would tell an attacker which
 * of those a token is.
 */
export async function resolveAuthSession(token, { now = new Date() } = {}) {
  if (typeof token !== 'string' || token.length === 0) return null;

  const authSession = await findAuthSessionByTokenHash(hashAuthToken(token));
  if (!authSession) return null;

  if (authSession.revokedAt !== null) return null;
  if (authSession.expiresAt <= now) return null;

  // Rule 5's payoff: an admin sets `suspended` and the next request is refused,
  // with no waiting for anything to expire.
  if (authSession.user.status !== 'enabled') return null;

  const { user, ...rest } = authSession;

  return { authSession: rest, user: withoutPasswordHash(user) };
}

/** Logout. Idempotent — revoking twice leaves the first timestamp standing. */
export function revokeAuthSession(authSessionId) {
  return revokeAuthSessionById(authSessionId);
}

/** Suspension and "log out everywhere". Returns how many were live. */
export function revokeAllAuthSessionsForUser(userId) {
  return revokeAuthSessionsForUser(userId);
}
