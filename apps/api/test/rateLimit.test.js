// Step 1.9 — rate limiting.
//
// Proves the done-when condition: repeated login attempts from one address are
// refused with 429 and the limit resets on schedule.
//
// The limits are lowered for these cases and the counters cleared between them,
// because test/setup.js raises them out of the way for every other suite.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

import { createApp } from '../src/app.js';
import { prisma } from '../src/db/client.js';
import { allLimiters, createRateLimiter } from '../src/middleware/rateLimit.js';
import { hashPassword } from '../src/services/passwordService.js';

const EMAIL_PREFIX = 'step-1-9-ratelimit';
const PASSWORD = 'a perfectly good password';

// Long enough to hold several attempts, because each login costs a scrypt
// derivation plus a round trip to a remote database — roughly half a second.
// A shorter window expires between attempts and the counter never accumulates,
// which is a flaw in the test rather than in the limiter.
const WINDOW_MS = 5000;

let server;
let origin;

const usedEmails = [];
const raised = {};

function freshEmail(label) {
  const address = `${EMAIL_PREFIX}+${label}-${randomUUID()}@example.invalid`;
  usedEmails.push(address);
  return address;
}

async function makeUser(label) {
  const user = await prisma.user.create({
    data: {
      email: freshEmail(label),
      fullName: 'A Person',
      passwordHash: await hashPassword(PASSWORD),
      status: 'enabled',
    },
  });
  return user;
}

function post(path, body) {
  return fetch(`${origin}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set to run these tests');

  for (const name of [
    'RATE_LIMIT_AUTH_MAX',
    'RATE_LIMIT_LOGIN_MAX',
    'RATE_LIMIT_LOGIN_WINDOW_MS',
    'RATE_LIMIT_EMAIL_MAX',
  ]) {
    raised[name] = process.env[name];
  }

  process.env.RATE_LIMIT_LOGIN_MAX = '3';
  process.env.RATE_LIMIT_LOGIN_WINDOW_MS = String(WINDOW_MS);
  process.env.RATE_LIMIT_EMAIL_MAX = '2';

  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => {
  // Every case starts from an empty store; the limiters are module-level and
  // shared by the whole process.
  for (const limiter of allLimiters) limiter.reset();
});

after(async () => {
  for (const [name, value] of Object.entries(raised)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }

  if (usedEmails.length > 0) {
    await prisma.user.deleteMany({ where: { email: { in: usedEmails } } });
  }
  await prisma.$disconnect();
  await new Promise((resolve) => server.close(resolve));
});

describe('repeated login attempts', () => {
  it('are refused with 429, and the limit resets on schedule', async () => {
    const user = await makeUser('login-limit');
    const attempt = () => post('/auth/login', { email: user.email, password: 'wrong' });

    const windowStartedAt = Date.now();

    // Three are allowed through to the credential check and correctly fail.
    for (let i = 0; i < 3; i += 1) {
      assert.equal((await attempt()).status, 401, `attempt ${i + 1} reached the handler`);
    }

    const refused = await attempt();
    assert.equal(refused.status, 429);

    const body = await refused.json();
    assert.equal(body.error.status, 429);
    assert.match(body.error.message, /Too many requests/);
    assert.ok(body.error.retryAfter >= 1);
    assert.ok(refused.headers.get('retry-after'));

    // Refused before the handler: a correct password is turned away too, which
    // is what makes this a limit rather than a slow failure.
    const correct = await post('/auth/login', {
      email: user.email,
      password: PASSWORD,
    });
    assert.equal(correct.status, 429);
    assert.equal(correct.headers.getSetCookie().length, 0);

    // And the limit resets on schedule. Waited out from when the window
    // actually opened, rather than a fixed pause, so a slow round trip cannot
    // turn this into a flake.
    await sleep(Math.max(0, WINDOW_MS - (Date.now() - windowStartedAt)) + 250);

    const afterReset = await post('/auth/login', {
      email: user.email,
      password: PASSWORD,
    });
    assert.equal(afterReset.status, 200, 'the window expired and the account works');
    assert.ok(afterReset.headers.getSetCookie().length > 0);
  });

  it('lock one account without locking anyone else', async () => {
    // The reason login keys on the address as well as the source: Nigerian
    // mobile networks put whole cohorts behind one NAT address, and one
    // learner mistyping a password must not lock out the rest.
    const locked = await makeUser('locked-out');
    const bystander = await makeUser('bystander');

    for (let i = 0; i < 4; i += 1) {
      await post('/auth/login', { email: locked.email, password: 'wrong' });
    }

    assert.equal(
      (await post('/auth/login', { email: locked.email, password: PASSWORD })).status,
      429,
    );
    assert.equal(
      (await post('/auth/login', { email: bystander.email, password: PASSWORD })).status,
      200,
      'a different account on the same address is unaffected',
    );
  });

  it('report the budget on every response', async () => {
    const user = await makeUser('headers');

    const first = await post('/auth/login', { email: user.email, password: 'wrong' });
    assert.equal(first.headers.get('ratelimit-limit'), '3');
    assert.equal(first.headers.get('ratelimit-remaining'), '2');

    const second = await post('/auth/login', { email: user.email, password: 'wrong' });
    assert.equal(second.headers.get('ratelimit-remaining'), '1');
  });
});

describe('the email-sending endpoints', () => {
  it('limit per recipient, not per caller', async () => {
    // Password reset and the invitation resend post mail to an address the
    // caller names. The bound that matters is on the recipient.
    const target = freshEmail('mail-target');

    for (let i = 0; i < 2; i += 1) {
      assert.equal((await post('/auth/password-reset', { email: target })).status, 202);
    }

    assert.equal((await post('/auth/password-reset', { email: target })).status, 429);

    // The resend shares the bucket, because it sends the same kind of message
    // to the same person.
    assert.equal(
      (await post('/auth/invitation/resend', { email: target })).status,
      429,
      'rotating the endpoint does not lift the per-recipient bound',
    );

    // A different recipient is unaffected.
    assert.equal(
      (await post('/auth/password-reset', { email: freshEmail('mail-other') })).status,
      202,
    );
  });
});

describe('the limiter itself', () => {
  function harness({ max, windowMs = 60_000, key = () => 'fixed' }) {
    const limiter = createRateLimiter({
      name: 'test',
      windowMs: () => windowMs,
      max: () => max,
      key,
    });

    const calls = { passed: 0 };
    const res = {
      headers: {},
      statusCode: null,
      setHeader(name, value) {
        this.headers[name] = value;
      },
      status(code) {
        this.statusCode = code;
        return this;
      },
      json() {
        return this;
      },
    };

    return {
      limiter,
      res,
      calls,
      run(req = { ip: '1.2.3.4', body: {} }) {
        res.statusCode = null;
        limiter(req, res, () => {
          calls.passed += 1;
        });
        return res.statusCode;
      },
    };
  }

  it('allows exactly the configured number before refusing', () => {
    const { run, calls } = harness({ max: 2 });

    assert.equal(run(), null);
    assert.equal(run(), null);
    assert.equal(run(), 429);
    assert.equal(calls.passed, 2);
  });

  it('skips a request with no key to count against', () => {
    // A per-target limiter must not silently fall back to counting everything
    // in one bucket when the target is absent.
    const { run, calls } = harness({ max: 1, key: () => null });

    assert.equal(run(), null);
    assert.equal(run(), null);
    assert.equal(calls.passed, 2);
  });

  it('counts separate keys separately', () => {
    const { limiter, res } = harness({ max: 1, key: (req) => req.ip });

    const call = (ip) => {
      res.statusCode = null;
      limiter({ ip, body: {} }, res, () => {});
      return res.statusCode;
    };

    assert.equal(call('1.1.1.1'), null);
    assert.equal(call('1.1.1.1'), 429);
    assert.equal(call('2.2.2.2'), null, 'a different key has its own budget');
  });

  it('starts a fresh window once the old one lapses', async () => {
    const { run } = harness({ max: 1, windowMs: 120 });

    assert.equal(run(), null);
    assert.equal(run(), 429);

    await sleep(180);
    assert.equal(run(), null, 'the window expired');
  });
});
