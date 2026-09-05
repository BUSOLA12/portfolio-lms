// Step 1.12 — email verification and CORS.
//
// Proves the done-when: a verification link stamps `email_verified_at` once and
// a replay fails; a browser served from WEB_ORIGIN can call the API with
// credentials and read the response, and an origin that is not WEB_ORIGIN
// cannot.
//
// The token is taken from the verification email itself, so what is exercised
// is the link a learner actually receives — the link that, per D21, had nothing
// to redeem it until this step.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import { createApp } from '../src/app.js';
import { prisma } from '../src/db/client.js';
import { createOneTimeToken } from '../src/repositories/oneTimeTokenRepository.js';
import {
  EMAIL_VERIFICATION,
  hashOneTimeToken,
} from '../src/services/invitationService.js';
import { registerLearner } from '../src/services/registrationService.js';

const EMAIL_PREFIX = 'step-1-12-verify';
const WEB_ORIGIN = 'https://web.example.invalid';

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

function call(path, { method = 'POST', body, headers = {} } = {}) {
  return fetch(`${origin}${path}`, {
    method,
    headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Registers a learner and returns the token from their verification email. */
async function registerAndTakeToken(label) {
  const provider = recordingProvider();
  const email = freshEmail(label);

  const { user } = await registerLearner(
    {
      relationship: 'self',
      fullName: 'A Learner',
      email,
      password: 'a perfectly good password',
    },
    { emailProvider: provider },
  );

  const message = provider.sent.find((sent) => sent.to === email);
  assert.ok(message, 'a verification email was sent');

  const match = message.text.match(/\/verify\?token=(\S+)/);
  assert.ok(match, 'it links to the verification page');

  return { token: decodeURIComponent(match[1]), user, email };
}

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set to run these tests');

  // test/setup.js sets this; the CORS cases assert against the same value.
  assert.equal(process.env.WEB_ORIGIN, WEB_ORIGIN);

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

describe('the verification link', () => {
  it('stamps email_verified_at once', async () => {
    const { token, user } = await registerAndTakeToken('stamps');

    // Registration leaves it null — verification is a timestamp, not a status,
    // per D5, and nothing had ever set it for a learner before this step.
    assert.equal(user.emailVerifiedAt, null);

    const response = await call('/auth/verify', { body: { token } });
    assert.equal(response.status, 200);

    const body = await response.json();
    assert.ok(body.user.emailVerifiedAt);
    assert.equal('passwordHash' in body.user, false);

    const stored = await prisma.user.findUnique({ where: { id: user.id } });
    assert.ok(stored.emailVerifiedAt instanceof Date);

    // The status is untouched: verification is not a status, and the learner
    // was already `enabled`.
    assert.equal(stored.status, 'enabled');
  });

  it('burns the token rather than deleting it', async () => {
    const { token, user } = await registerAndTakeToken('burns');
    await call('/auth/verify', { body: { token } });

    const row = await prisma.oneTimeToken.findUnique({
      where: { tokenHash: hashOneTimeToken(EMAIL_VERIFICATION, token) },
    });

    assert.ok(row, 'the row survives');
    assert.ok(row.consumedAt instanceof Date);
    assert.equal(row.userId, user.id);
  });

  it('fails on replay, without moving the timestamp', async () => {
    const { token, user } = await registerAndTakeToken('replay');

    assert.equal((await call('/auth/verify', { body: { token } })).status, 200);
    const first = await prisma.user.findUnique({ where: { id: user.id } });

    const replay = await call('/auth/verify', { body: { token } });
    assert.equal(replay.status, 422);
    assert.match(
      (await replay.json()).error.fields.token,
      /expired or has already been used/,
    );

    const second = await prisma.user.findUnique({ where: { id: user.id } });
    assert.equal(
      second.emailVerifiedAt.getTime(),
      first.emailVerifiedAt.getTime(),
      'the moment it was proven does not move',
    );
  });

  it('refuses an expired link and leaves the address unverified', async () => {
    const { user } = await registerAndTakeToken('expired');
    const stale = `a-verification-token-past-it-${randomUUID()}`;

    await createOneTimeToken({
      userId: user.id,
      purpose: EMAIL_VERIFICATION,
      tokenHash: hashOneTimeToken(EMAIL_VERIFICATION, stale),
      expiresAt: new Date(Date.now() - 1000),
    });

    assert.equal((await call('/auth/verify', { body: { token: stale } })).status, 422);

    const stored = await prisma.user.findUnique({ where: { id: user.id } });
    assert.equal(stored.emailVerifiedAt, null);
  });

  it('refuses an unknown token, and a missing one per field', async () => {
    const unknown = await call('/auth/verify', { body: { token: 'never-issued' } });
    assert.equal(unknown.status, 422);

    const missing = await call('/auth/verify', { body: {} });
    assert.equal(missing.status, 422);
    assert.ok((await missing.json()).error.fields.token);
  });

  it('refuses an account that is not enabled', async () => {
    const { token, user } = await registerAndTakeToken('suspended');
    await prisma.user.update({ where: { id: user.id }, data: { status: 'suspended' } });

    assert.equal((await call('/auth/verify', { body: { token } })).status, 422);

    const stored = await prisma.user.findUnique({ where: { id: user.id } });
    assert.equal(stored.emailVerifiedAt, null);
  });
});

describe('cross-origin access', () => {
  it('lets the web origin call with credentials and read the reply', async () => {
    const response = await call('/health', {
      method: 'GET',
      headers: { origin: WEB_ORIGIN },
    });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), WEB_ORIGIN);
    assert.equal(response.headers.get('access-control-allow-credentials'), 'true');

    // Never the wildcard: it is invalid alongside credentials, and the browser
    // would reject the response rather than fall back to something permissive.
    assert.notEqual(response.headers.get('access-control-allow-origin'), '*');

    // The rate limiter's budget is readable now. 1.9 duplicated retryAfter into
    // the body because these were unreachable cross-origin.
    const exposed = response.headers.get('access-control-expose-headers');
    assert.match(exposed, /Retry-After/);
    assert.match(exposed, /RateLimit-Remaining/);

    // Always, so a cache cannot serve one origin's response to another.
    assert.match(response.headers.get('vary'), /Origin/);
  });

  it('answers a preflight for a JSON POST', async () => {
    const response = await call('/auth/verify', {
      method: 'OPTIONS',
      headers: {
        origin: WEB_ORIGIN,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    });

    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), WEB_ORIGIN);
    assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
    assert.match(response.headers.get('access-control-allow-methods'), /POST/);
    assert.match(response.headers.get('access-control-allow-headers'), /Content-Type/i);
    assert.ok(Number(response.headers.get('access-control-max-age')) > 0);
  });

  it('refuses an origin that is not the web origin', async () => {
    const hostile = 'https://not-the-web-app.example.invalid';

    const simple = await call('/health', { method: 'GET', headers: { origin: hostile } });
    assert.equal(simple.headers.get('access-control-allow-origin'), null);
    assert.equal(simple.headers.get('access-control-allow-credentials'), null);
    assert.match(simple.headers.get('vary'), /Origin/, 'still varies on Origin');

    const preflight = await call('/auth/verify', {
      method: 'OPTIONS',
      headers: { origin: hostile, 'access-control-request-method': 'POST' },
    });
    assert.equal(preflight.status, 403);
    assert.equal(preflight.headers.get('access-control-allow-origin'), null);
  });

  it('leaves a request with no Origin header alone', async () => {
    // A health check or a webhook is not a browser cross-origin request.
    const response = await call('/health', { method: 'GET' });

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('access-control-allow-origin'), null);
  });

  it('refuses every origin when WEB_ORIGIN is unset, per D20', async () => {
    const configured = process.env.WEB_ORIGIN;
    delete process.env.WEB_ORIGIN;

    try {
      const response = await call('/health', {
        method: 'GET',
        headers: { origin: WEB_ORIGIN },
      });
      assert.equal(
        response.headers.get('access-control-allow-origin'),
        null,
        'forgetting the variable fails shut, not open',
      );
    } finally {
      process.env.WEB_ORIGIN = configured;
    }
  });
});
