// Step 1.8 — login, logout, current user, password reset.
//
// Proves the done-when condition: login sets the cookie; `/me` returns the user
// with `is_admin` and derived learner/guardian standing; logout makes the
// cookie useless immediately.
//
// Driven over HTTP with the Set-Cookie header fed back in, so what is exercised
// is the cookie a browser would actually hold.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import { createApp } from '../src/app.js';
import { prisma } from '../src/db/client.js';
import { authCookieName } from '../src/services/authSessionService.js';
import {
  EMAIL_VERIFICATION,
  GUARDIAN_INVITATION,
  PASSWORD_RESET,
  hashOneTimeToken,
  issueEmailVerification,
  issueGuardianInvitation,
  issuePasswordReset,
} from '../src/services/invitationService.js';
import { createOneTimeToken } from '../src/repositories/oneTimeTokenRepository.js';
import { verifyPassword } from '../src/services/passwordService.js';
import { requestPasswordReset } from '../src/services/passwordResetService.js';
import { hashPassword } from '../src/services/passwordService.js';

const EMAIL_PREFIX = 'step-1-8-session';
const PASSWORD = 'a perfectly good password';

let server;
let origin;

const usedEmails = [];

function freshEmail(label) {
  const address = `${EMAIL_PREFIX}+${label}-${randomUUID()}@example.invalid`;
  usedEmails.push(address);
  return address;
}

function recordingProvider() {
  return {
    name: 'recording',
    sent: [],
    async send(message) {
      this.sent.push(message);
      return { id: `recording-${this.sent.length}` };
    },
  };
}

async function makeUser({ label, status = 'enabled', isAdmin = false } = {}) {
  return prisma.user.create({
    data: {
      email: freshEmail(label),
      fullName: 'A Person',
      passwordHash: await hashPassword(PASSWORD),
      status,
      isAdmin,
    },
  });
}

function call(path, { method = 'GET', body, cookie } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (cookie) headers.cookie = cookie;

  return fetch(`${origin}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// The Set-Cookie header reduced to what a browser would send back.
function cookieFrom(response) {
  const header = response.headers
    .getSetCookie()
    .find((entry) => entry.startsWith(`${authCookieName()}=`));
  assert.ok(header, 'a Set-Cookie for the auth cookie was sent');
  return header.split(';')[0];
}

function attributesOf(response) {
  return response.headers
    .getSetCookie()
    .find((entry) => entry.startsWith(`${authCookieName()}=`));
}

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set to run these tests');

  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (usedEmails.length > 0) {
    await prisma.user.deleteMany({ where: { email: { in: usedEmails } } });
  }
  await prisma.$disconnect();
  await new Promise((resolve) => server.close(resolve));
});

describe('login', () => {
  it('sets the auth cookie', async () => {
    const user = await makeUser({ label: 'login' });

    const response = await call('/auth/login', {
      method: 'POST',
      body: { email: user.email, password: PASSWORD },
    });

    assert.equal(response.status, 200);

    const attributes = attributesOf(response);
    assert.match(attributes, /HttpOnly/i);
    assert.match(attributes, /SameSite=Lax/i);
    assert.match(attributes, /Path=\//i);

    // The cookie value is the raw token; the database holds only its hash.
    const value = cookieFrom(response).split('=')[1];
    const rows = await prisma.authSession.findMany({ where: { userId: user.id } });
    assert.equal(rows.length, 1);
    assert.notEqual(rows[0].tokenHash, value);

    const body = await response.json();
    assert.equal(body.user.email, user.email);
    assert.equal('passwordHash' in body.user, false);
  });

  it('refuses a wrong password and an unknown address alike', async () => {
    const user = await makeUser({ label: 'wrong' });

    const wrong = await call('/auth/login', {
      method: 'POST',
      body: { email: user.email, password: 'not the right password' },
    });
    const unknown = await call('/auth/login', {
      method: 'POST',
      body: { email: freshEmail('never-registered'), password: PASSWORD },
    });

    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);

    // Identical, so the endpoint is not a register of who has an account.
    assert.deepEqual(await wrong.json(), await unknown.json());
    assert.equal(unknown.headers.getSetCookie().length, 0);
  });

  it('refuses an account that is not enabled', async () => {
    // A suspended learner must lose access at once — CLAUDE.md rule 5.
    const suspended = await makeUser({ label: 'suspended', status: 'suspended' });
    const pending = await makeUser({ label: 'pending-stub', status: 'pending' });

    for (const user of [suspended, pending]) {
      const response = await call('/auth/login', {
        method: 'POST',
        body: { email: user.email, password: PASSWORD },
      });
      assert.equal(response.status, 401);
    }
  });
});

describe('/me', () => {
  it('returns the user with is_admin and derived standing', async () => {
    const admin = await makeUser({ label: 'admin', isAdmin: true });

    const login = await call('/auth/login', {
      method: 'POST',
      body: { email: admin.email, password: PASSWORD },
    });
    const cookie = cookieFrom(login);

    const response = await call('/auth/me', { cookie });
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.equal(body.user.id, admin.id);
    assert.equal(body.user.isAdmin, true);
    assert.equal('passwordHash' in body.user, false);

    assert.equal(body.standing.guardian, false);

    // Structurally present, and false until step 3.1 creates `enrollments`.
    assert.equal(body.standing.learner, false);
  });

  it('derives guardian standing from a guardianship row', async () => {
    const guardian = await makeUser({ label: 'guardian' });
    const learner = await makeUser({ label: 'ward' });

    await prisma.guardianship.create({
      data: { guardianId: guardian.id, learnerId: learner.id, relationship: 'parent' },
    });

    const login = await call('/auth/login', {
      method: 'POST',
      body: { email: guardian.email, password: PASSWORD },
    });

    const body = await (await call('/auth/me', { cookie: cookieFrom(login) })).json();
    assert.equal(body.standing.guardian, true);

    // Relationship-scoped, per rule 6: being someone's guardian does not make
    // the learner one.
    const learnerLogin = await call('/auth/login', {
      method: 'POST',
      body: { email: learner.email, password: PASSWORD },
    });
    const learnerBody = await (
      await call('/auth/me', { cookie: cookieFrom(learnerLogin) })
    ).json();
    assert.equal(learnerBody.standing.guardian, false);
  });

  it('refuses without a cookie', async () => {
    assert.equal((await call('/auth/me')).status, 401);
  });
});

describe('logout', () => {
  it('makes the cookie useless immediately', async () => {
    const user = await makeUser({ label: 'logout' });

    const login = await call('/auth/login', {
      method: 'POST',
      body: { email: user.email, password: PASSWORD },
    });
    const cookie = cookieFrom(login);

    assert.equal((await call('/auth/me', { cookie })).status, 200);

    const out = await call('/auth/logout', { method: 'POST', cookie });
    assert.equal(out.status, 204);

    // The same cookie, immediately afterwards. This is the whole reason for
    // database sessions rather than JWTs.
    assert.equal((await call('/auth/me', { cookie })).status, 401);

    const row = await prisma.authSession.findFirst({ where: { userId: user.id } });
    assert.ok(row.revokedAt instanceof Date, 'revoked, not deleted');
  });

  it('answers 204 for a caller with no session at all', async () => {
    assert.equal((await call('/auth/logout', { method: 'POST' })).status, 204);
  });
});

describe('password reset', () => {
  it('answers identically whether or not the address exists', async () => {
    const user = await makeUser({ label: 'reset-exists' });

    const known = await call('/auth/password-reset', {
      method: 'POST',
      body: { email: user.email },
    });
    const unknown = await call('/auth/password-reset', {
      method: 'POST',
      body: { email: freshEmail('reset-unknown') },
    });

    assert.equal(known.status, 202);
    assert.equal(unknown.status, 202);
    assert.deepEqual(await known.json(), await unknown.json());
  });

  it('sets a new password, burns the link, and kills every session', async () => {
    const user = await makeUser({ label: 'reset-complete' });

    // Two live sessions before the reset.
    const first = cookieFrom(
      await call('/auth/login', {
        method: 'POST',
        body: { email: user.email, password: PASSWORD },
      }),
    );
    const second = cookieFrom(
      await call('/auth/login', {
        method: 'POST',
        body: { email: user.email, password: PASSWORD },
      }),
    );

    const provider = recordingProvider();
    await requestPasswordReset(user.email, { emailProvider: provider });

    assert.equal(provider.sent.length, 1);
    assert.equal(provider.sent[0].subject, 'Reset your password');
    assert.match(provider.sent[0].text, /expires in 1 hour\b/);

    const match = provider.sent[0].text.match(/\/reset\?token=(\S+)/);
    assert.ok(match, 'the email links to the reset page');
    const token = decodeURIComponent(match[1]);

    const done = await call('/auth/password-reset/complete', {
      method: 'POST',
      body: { token, password: 'a brand new password entirely' },
    });
    assert.equal(done.status, 200);

    const updated = await prisma.user.findUnique({ where: { id: user.id } });
    assert.equal(
      await verifyPassword('a brand new password entirely', updated.passwordHash),
      true,
    );
    assert.equal(await verifyPassword(PASSWORD, updated.passwordHash), false);

    // Both pre-existing sessions are dead. A reset is what someone does when
    // they think their password is known to somebody else.
    assert.equal((await call('/auth/me', { cookie: first })).status, 401);
    assert.equal((await call('/auth/me', { cookie: second })).status, 401);

    // And the link is spent.
    const replay = await call('/auth/password-reset/complete', {
      method: 'POST',
      body: { token, password: 'a third password' },
    });
    assert.equal(replay.status, 422);
  });

  it('records each request separately so a second can be asked for', async () => {
    // A null entity_ref would let 1.5's guard suppress every request after the
    // first, forever.
    const user = await makeUser({ label: 'reset-twice' });
    const provider = recordingProvider();

    await requestPasswordReset(user.email, { emailProvider: provider });
    await requestPasswordReset(user.email, { emailProvider: provider });

    assert.equal(provider.sent.length, 2, 'the second request also sends');

    const rows = await prisma.emailLog.findMany({
      where: { userId: user.id, type: PASSWORD_RESET },
    });
    assert.equal(rows.length, 2);
    assert.notEqual(rows[0].entityRef, rows[1].entityRef);
  });

  it('sends nothing for an account that is not enabled', async () => {
    const pending = await makeUser({ label: 'reset-pending', status: 'pending' });
    const provider = recordingProvider();

    await requestPasswordReset(pending.email, { emailProvider: provider });

    assert.equal(provider.sent.length, 0);
    assert.equal(
      (await prisma.oneTimeToken.findMany({ where: { userId: pending.id } })).length,
      0,
    );
  });

  it('refuses an expired link', async () => {
    const user = await makeUser({ label: 'reset-expired' });
    const token = `a-reset-token-past-its-hour-${randomUUID()}`;

    await createOneTimeToken({
      userId: user.id,
      purpose: PASSWORD_RESET,
      tokenHash: hashOneTimeToken(PASSWORD_RESET, token),
      expiresAt: new Date(Date.now() - 1000),
    });

    const response = await call('/auth/password-reset/complete', {
      method: 'POST',
      body: { token, password: 'a password that will not be set' },
    });

    assert.equal(response.status, 422);
    const unchanged = await prisma.user.findUnique({ where: { id: user.id } });
    assert.equal(await verifyPassword(PASSWORD, unchanged.passwordHash), true);
  });

  it('rejects a new password below D16, without burning the link', async () => {
    const user = await makeUser({ label: 'reset-weak' });
    const provider = recordingProvider();
    await requestPasswordReset(user.email, { emailProvider: provider });

    const token = decodeURIComponent(
      provider.sent[0].text.match(/\/reset\?token=(\S+)/)[1],
    );

    const weak = await call('/auth/password-reset/complete', {
      method: 'POST',
      body: { token, password: 'short' },
    });
    assert.equal(weak.status, 422);

    // The link must still work.
    const good = await call('/auth/password-reset/complete', {
      method: 'POST',
      body: { token, password: 'a properly long password' },
    });
    assert.equal(good.status, 200);
  });
});

describe('token lifetimes', () => {
  // A regression test with a specific history: when the shared issuer moved
  // from days to milliseconds, one call site kept passing 7 and started minting
  // verification tokens that expired seven milliseconds later. Every purpose is
  // pinned here so a unit mismatch fails loudly rather than as a puzzling
  // "expired" somewhere downstream.
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;

  async function windowOf(issue) {
    const user = await makeUser({ label: 'ttl' });
    const before = Date.now();
    const { oneTimeToken } = await issue(user.id);
    return oneTimeToken.expiresAt.getTime() - before;
  }

  it('gives an invitation seven days', async () => {
    const window = await windowOf((id) => issueGuardianInvitation(id));
    assert.ok(window > 6.9 * DAY && window < 7.1 * DAY, `got ${window}ms`);
  });

  it('gives email verification seven days', async () => {
    const window = await windowOf((id) => issueEmailVerification(id));
    assert.ok(window > 6.9 * DAY && window < 7.1 * DAY, `got ${window}ms`);
  });

  it('gives a password reset one hour', async () => {
    const window = await windowOf((id) => issuePasswordReset(id));
    assert.ok(window > 0.9 * HOUR && window < 1.1 * HOUR, `got ${window}ms`);
  });

  it('issues each purpose under its own name', async () => {
    const user = await makeUser({ label: 'purposes' });

    await issueGuardianInvitation(user.id);
    await issueEmailVerification(user.id);
    await issuePasswordReset(user.id);

    const rows = await prisma.oneTimeToken.findMany({ where: { userId: user.id } });
    assert.deepEqual(
      rows.map((row) => row.purpose).sort(),
      [EMAIL_VERIFICATION, GUARDIAN_INVITATION, PASSWORD_RESET].sort(),
    );
  });
});
