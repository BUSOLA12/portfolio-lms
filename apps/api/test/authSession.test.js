// Step 1.2 — auth core services.
//
// Proves the done-when condition: an auth session is created, resolved from a
// cookie value, revoked, and the revoked token no longer resolves — and the
// raw token is nowhere in the database.
//
// These run against the real database named by DATABASE_URL, because the
// behaviour under test is a database read on every request. Each test creates
// its own user with a unique address and deletes it afterwards; the auth
// session rows go with it on cascade.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import { prisma } from '../src/db/client.js';
import { createAuthSession } from '../src/repositories/authSessionRepository.js';
import {
  authCookieName,
  authCookieOptions,
  clearAuthCookie,
  hashAuthToken,
  issueAuthSession,
  readAuthCookie,
  resolveAuthSession,
  revokeAllAuthSessionsForUser,
  revokeAuthSession,
  setAuthCookie,
} from '../src/services/authSessionService.js';
import { hashPassword, verifyPassword } from '../src/services/passwordService.js';
import { requireAuth } from '../src/middleware/requireAuth.js';

const EMAIL_PREFIX = 'step-1-2-authsession';

const createdUserIds = [];

async function makeUser(status = 'enabled') {
  const user = await prisma.user.create({
    data: {
      email: `${EMAIL_PREFIX}+${randomUUID()}@example.invalid`,
      fullName: 'Auth Core Test User',
      status,
    },
  });
  createdUserIds.push(user.id);
  return user;
}

// Stands in for an Express response, recording what res.cookie was handed.
function fakeResponse() {
  return {
    cookies: [],
    cleared: [],
    cookie(name, value, options) {
      this.cookies.push({ name, value, options });
    },
    clearCookie(name, options) {
      this.cleared.push({ name, options });
    },
  };
}

// Turns what setAuthCookie wrote into the Cookie header a browser would send
// back, so the resolution path is exercised end to end rather than by handing
// the raw token straight to the resolver.
function requestCarrying(...cookies) {
  const header = cookies
    .map(({ name, value }) => `${name}=${encodeURIComponent(value)}`)
    .join('; ');
  return { headers: { cookie: header } };
}

before(() => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set to run these tests');
  assert.ok(
    process.env.AUTH_SESSION_SECRET,
    'AUTH_SESSION_SECRET must be set to run these tests',
  );
});

after(async () => {
  if (createdUserIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await prisma.$disconnect();
});

describe('passwordService', () => {
  it('verifies a password against its own hash', async () => {
    const stored = await hashPassword('correct horse battery staple');

    assert.equal(await verifyPassword('correct horse battery staple', stored), true);
    assert.equal(await verifyPassword('correct horse battery stapl', stored), false);
  });

  it('never stores the password itself, and salts every hash', async () => {
    const first = await hashPassword('a shared password');
    const second = await hashPassword('a shared password');

    assert.notEqual(first, second, 'two hashes of one password must differ');
    assert.ok(!first.includes('a shared password'));
    assert.match(first, /^scrypt\$32768\$8\$1\$/);
  });

  it('refuses an account with no password set', async () => {
    // A pending guardian stub (D5) has a null password_hash and cannot log in.
    assert.equal(await verifyPassword('anything', null), false);
    assert.equal(await verifyPassword('anything', ''), false);
  });
});

describe('authSessionService', () => {
  it('creates, resolves from a cookie, then refuses the revoked token', async () => {
    const user = await makeUser();

    // Create.
    const { token, authSession, expiresAt } = await issueAuthSession(user, {
      userAgent: 'node:test',
    });

    const res = fakeResponse();
    setAuthCookie(res, token, expiresAt);

    const [written] = res.cookies;
    assert.equal(written.name, authCookieName());
    assert.equal(written.options.httpOnly, true);
    assert.equal(written.options.sameSite, 'lax');
    assert.equal(written.options.path, '/');
    assert.equal(written.options.expires.getTime(), expiresAt.getTime());

    // Resolve, from the cookie value rather than from the token variable.
    const presented = readAuthCookie(requestCarrying(written));
    assert.equal(presented, token);

    const resolved = await resolveAuthSession(presented);
    assert.ok(resolved, 'a live auth session must resolve');
    assert.equal(resolved.user.id, user.id);
    assert.equal(resolved.authSession.id, authSession.id);
    assert.equal('passwordHash' in resolved.user, false);

    // Revoke.
    assert.equal(await revokeAuthSession(authSession.id), 1);

    assert.equal(
      await resolveAuthSession(presented),
      null,
      'a revoked token must not resolve',
    );

    // Revocation is a timestamp, not a delete — the row stays auditable.
    const row = await prisma.authSession.findUnique({ where: { id: authSession.id } });
    assert.ok(row.revokedAt instanceof Date);
  });

  it('keeps the raw token out of the database', async () => {
    const user = await makeUser();
    const { token, authSession } = await issueAuthSession(user);

    const row = await prisma.authSession.findUnique({ where: { id: authSession.id } });

    assert.notEqual(row.tokenHash, token);
    assert.match(row.tokenHash, /^[0-9a-f]{64}$/);
    assert.equal(
      JSON.stringify(row).includes(token),
      false,
      'no column may contain the raw token',
    );

    // Belt and braces: a full-table scan for the raw value finds nothing.
    const [{ count }] = await prisma.$queryRaw`
      SELECT count(*)::int AS count FROM auth_sessions WHERE token_hash = ${token}
    `;
    assert.equal(count, 0);
  });

  it('refuses an expired auth session', async () => {
    const user = await makeUser();
    const token = 'expired-token-under-test';

    await createAuthSession({
      userId: user.id,
      tokenHash: hashAuthToken(token),
      expiresAt: new Date(Date.now() - 1000),
    });

    assert.equal(await resolveAuthSession(token), null);
  });

  it('refuses a suspended account immediately', async () => {
    // CLAUDE.md rule 5: this is the case a JWT would get wrong.
    const user = await makeUser();
    const { token } = await issueAuthSession(user);

    assert.ok(await resolveAuthSession(token));

    await prisma.user.update({ where: { id: user.id }, data: { status: 'suspended' } });

    assert.equal(await resolveAuthSession(token), null);
  });

  it('revokes every live auth session for one user', async () => {
    const user = await makeUser();
    const first = await issueAuthSession(user);
    const second = await issueAuthSession(user);

    assert.equal(await revokeAllAuthSessionsForUser(user.id), 2);

    assert.equal(await resolveAuthSession(first.token), null);
    assert.equal(await resolveAuthSession(second.token), null);
  });

  it('marks the cookie Secure unless explicitly opted out, per D20', () => {
    const configured = process.env.AUTH_COOKIE_SECURE;

    try {
      // The failure that produced D20: NODE_ENV was set on one service and not
      // the other, and the cookie silently lost its Secure flag on a public
      // HTTPS host. Forgetting a variable must now fail strict, not loose.
      delete process.env.AUTH_COOKIE_SECURE;
      assert.equal(authCookieOptions().secure, true, 'unset stays secure');

      process.env.AUTH_COOKIE_SECURE = '';
      assert.equal(authCookieOptions().secure, true, 'empty stays secure');

      process.env.AUTH_COOKIE_SECURE = 'FALSE_BUT_NOT_QUITE';
      assert.equal(authCookieOptions().secure, true, 'a misspelt value stays secure');

      process.env.AUTH_COOKIE_SECURE = 'true';
      assert.equal(authCookieOptions().secure, true);

      // Only the literal opt-out turns it off, for local http development.
      process.env.AUTH_COOKIE_SECURE = 'false';
      assert.equal(authCookieOptions().secure, false);

      process.env.AUTH_COOKIE_SECURE = '  FALSE  ';
      assert.equal(authCookieOptions().secure, false, 'trimmed and case-insensitive');
    } finally {
      if (configured === undefined) delete process.env.AUTH_COOKIE_SECURE;
      else process.env.AUTH_COOKIE_SECURE = configured;
    }
  });

  it('does not read NODE_ENV for the Secure flag', () => {
    const configuredNode = process.env.NODE_ENV;
    const configuredSecure = process.env.AUTH_COOKIE_SECURE;

    try {
      delete process.env.AUTH_COOKIE_SECURE;
      process.env.NODE_ENV = 'development';

      // The old form returned false here, which is the whole defect.
      assert.equal(authCookieOptions().secure, true);
    } finally {
      if (configuredNode === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = configuredNode;
      if (configuredSecure === undefined) delete process.env.AUTH_COOKIE_SECURE;
      else process.env.AUTH_COOKIE_SECURE = configuredSecure;
    }
  });

  it('clears the cookie with the attributes it was set with', () => {
    const res = fakeResponse();
    clearAuthCookie(res);

    const [cleared] = res.cleared;
    assert.equal(cleared.name, authCookieName());
    assert.deepEqual(cleared.options, authCookieOptions());
  });

  it('reads no token from an absent or unrelated cookie header', () => {
    assert.equal(readAuthCookie({ headers: {} }), null);
    assert.equal(readAuthCookie({ headers: { cookie: 'other=value' } }), null);
    assert.equal(readAuthCookie({ headers: { cookie: `${authCookieName()}=` } }), null);
  });
});

describe('requireAuth', () => {
  it('admits a live auth session and attaches the user', async () => {
    const user = await makeUser();
    const { token, expiresAt } = await issueAuthSession(user);

    const res = fakeResponse();
    setAuthCookie(res, token, expiresAt);

    const req = requestCarrying(res.cookies[0]);

    let passedError = 'not called';
    await requireAuth(req, res, (error) => {
      passedError = error;
    });

    assert.equal(passedError, undefined, 'next() must be called with no error');
    assert.equal(req.user.id, user.id);
    assert.ok(req.authSession.id);
  });

  it('refuses a revoked auth session with 401', async () => {
    const user = await makeUser();
    const { token, authSession, expiresAt } = await issueAuthSession(user);

    const res = fakeResponse();
    setAuthCookie(res, token, expiresAt);
    const req = requestCarrying(res.cookies[0]);

    await revokeAuthSession(authSession.id);

    let passedError;
    await requireAuth(req, res, (error) => {
      passedError = error;
    });

    assert.equal(passedError.status, 401);
    assert.equal(req.user, undefined);
  });

  it('refuses a request carrying no cookie at all', async () => {
    let passedError;
    await requireAuth({ headers: {} }, fakeResponse(), (error) => {
      passedError = error;
    });

    assert.equal(passedError.status, 401);
  });
});
