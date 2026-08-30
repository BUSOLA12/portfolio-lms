// Step 1.6 — invitation and verification emails.
//
// Proves the done-when condition: registering as a guardian-linked learner
// sends both emails, each recorded in `email_log`.
//
// Split deliberately. The HTTP tests prove the wiring end to end with the
// `console` transport, which exercises the whole path without delivering; the
// service tests use a recording provider to inspect what the messages actually
// say and where they link.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

import { createApp } from '../src/app.js';
import { prisma } from '../src/db/client.js';
import {
  EMAIL_VERIFICATION,
  GUARDIAN_INVITATION,
  redeemOneTimeToken,
} from '../src/services/invitationService.js';
import { registerLearner } from '../src/services/registrationService.js';

const EMAIL_PREFIX = 'step-1-6-emails';
// Must match what test/setup.js sets.
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

function guardianInput({ learnerEmail, guardianEmail, learnerName = 'Ada Lovelace' }) {
  return {
    relationship: 'guardian',
    fullName: learnerName,
    email: learnerEmail,
    password: 'a correct password',
    guardian: { fullName: 'A Guardian', email: guardianEmail, phone: '08000000020' },
  };
}

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set to run these tests');
  assert.ok(process.env.ONE_TIME_TOKEN_SECRET, 'ONE_TIME_TOKEN_SECRET must be set');

  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => {
  // test/setup.js pins the transport and these values for every suite. Asserted
  // rather than assigned, so the guarantee is checked rather than assumed.
  assert.equal(process.env.EMAIL_PROVIDER, 'console');
  assert.equal(process.env.WEB_ORIGIN, WEB_ORIGIN);
  assert.ok(process.env.EMAIL_FROM);
});

after(async () => {
  if (usedEmails.length > 0) {
    await prisma.user.deleteMany({ where: { email: { in: usedEmails } } });
  }
  await prisma.$disconnect();
  await new Promise((resolve) => server.close(resolve));
});

describe('registering a guardian-linked learner', () => {
  it('sends both emails, each recorded in email_log', async () => {
    const learnerEmail = freshEmail('both-learner');
    const guardianEmail = freshEmail('both-guardian');

    const response = await fetch(`${origin}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(guardianInput({ learnerEmail, guardianEmail })),
    });
    assert.equal(response.status, 201);

    const [learner, guardian] = await Promise.all([
      prisma.user.findUnique({ where: { email: learnerEmail } }),
      prisma.user.findUnique({ where: { email: guardianEmail } }),
    ]);

    const learnerLog = await prisma.emailLog.findMany({ where: { userId: learner.id } });
    assert.equal(learnerLog.length, 1);
    assert.equal(learnerLog[0].type, EMAIL_VERIFICATION);
    assert.equal(learnerLog[0].entityRef, null, 'account-level mail has no entity');

    const guardianLog = await prisma.emailLog.findMany({
      where: { userId: guardian.id },
    });
    assert.equal(guardianLog.length, 1);
    assert.equal(guardianLog[0].type, GUARDIAN_INVITATION);
    assert.equal(guardianLog[0].entityRef, learner.id, 'scoped to the learner');
  });

  it('sends only the verification email for a self registration', async () => {
    const learnerEmail = freshEmail('self-only');

    const response = await fetch(`${origin}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        relationship: 'self',
        fullName: 'Grace Hopper',
        email: learnerEmail,
        password: 'a correct password',
      }),
    });
    assert.equal(response.status, 201);

    const learner = await prisma.user.findUnique({ where: { email: learnerEmail } });
    const log = await prisma.emailLog.findMany({ where: { userId: learner.id } });

    assert.equal(log.length, 1);
    assert.equal(log[0].type, EMAIL_VERIFICATION);
  });
});

describe('the messages themselves', () => {
  it('deep-link into the web app with working single-use tokens', async () => {
    const provider = recordingProvider();
    const learnerEmail = freshEmail('links-learner');
    const guardianEmail = freshEmail('links-guardian');

    await registerLearner(guardianInput({ learnerEmail, guardianEmail }), {
      emailProvider: provider,
    });

    assert.equal(provider.sent.length, 2);
    const [verification, invitation] = provider.sent;

    assert.equal(verification.to, learnerEmail);
    assert.equal(verification.subject, 'Confirm your email address');
    assert.equal(invitation.to, guardianEmail);
    assert.match(invitation.subject, /named as a guardian for Ada Lovelace/);

    // Pull each token back out of the link and prove it redeems — which is what
    // makes these deep links rather than decorative URLs.
    const verifyToken = tokenFrom(verification, `${WEB_ORIGIN}/verify`);
    const claimToken = tokenFrom(invitation, `${WEB_ORIGIN}/claim`);

    assert.ok(await redeemOneTimeToken(EMAIL_VERIFICATION, verifyToken));
    assert.ok(await redeemOneTimeToken(GUARDIAN_INVITATION, claimToken));

    // Single-use, per 1.4.
    assert.equal(await redeemOneTimeToken(EMAIL_VERIFICATION, verifyToken), null);
  });

  it('states an expiry that matches the token it describes', async () => {
    const provider = recordingProvider();
    await registerLearner(
      guardianInput({
        learnerEmail: freshEmail('expiry-learner'),
        guardianEmail: freshEmail('expiry-guardian'),
      }),
      { emailProvider: provider },
    );

    for (const message of provider.sent) {
      assert.match(message.text, /expires in 7 days/);
      assert.match(message.html, /expires in 7 days/);
    }
  });

  it('carries a plain-text half alongside the html', async () => {
    const provider = recordingProvider();
    await registerLearner(
      guardianInput({
        learnerEmail: freshEmail('text-learner'),
        guardianEmail: freshEmail('text-guardian'),
      }),
      { emailProvider: provider },
    );

    for (const message of provider.sent) {
      assert.ok(message.text.length > 0, 'a text-only client must see something');
      assert.equal(message.text.includes('<'), false, 'the text half is not markup');
      assert.match(message.html, /^<!doctype html>/);
    }
  });

  it('escapes a learner name that would otherwise be markup', async () => {
    const provider = recordingProvider();
    const learnerEmail = freshEmail('escape-learner');

    await registerLearner(
      guardianInput({
        learnerEmail,
        guardianEmail: freshEmail('escape-guardian'),
        learnerName: 'Ada <script>alert(1)</script>',
      }),
      { emailProvider: provider },
    );

    const invitation = provider.sent.find((message) => message.to !== learnerEmail);
    assert.equal(invitation.html.includes('<script>'), false);
    assert.match(invitation.html, /&lt;script&gt;/);
  });

  it('sends no invitation when the guardian already has an account', async () => {
    // 1.4 issues no token for an enabled account, so there is nothing to claim
    // and nothing to post.
    const guardianEmail = freshEmail('enabled-guardian');
    await registerLearner(
      {
        relationship: 'self',
        fullName: 'An Adult',
        email: guardianEmail,
        password: 'a correct password',
      },
      { emailProvider: recordingProvider() },
    );

    const provider = recordingProvider();
    await registerLearner(
      guardianInput({ learnerEmail: freshEmail('enabled-learner'), guardianEmail }),
      { emailProvider: provider },
    );

    assert.equal(provider.sent.length, 1);
    assert.equal(provider.sent[0].subject, 'Confirm your email address');
  });

  it('still registers when the provider is down', async () => {
    // The account is already committed by the time sending is attempted. A
    // provider outage must not turn into a 500 that sends the learner back to a
    // form which now rejects their address as taken.
    const learnerEmail = freshEmail('outage-learner');
    const failing = {
      name: 'failing',
      async send() {
        throw new Error('transport refused');
      },
    };

    const { user } = await registerLearner(
      guardianInput({ learnerEmail, guardianEmail: freshEmail('outage-guardian') }),
      { emailProvider: failing },
    );

    assert.equal(user.email, learnerEmail);

    // Nothing recorded, which is exactly the signal a later resend looks for.
    assert.equal(
      (await prisma.emailLog.findMany({ where: { userId: user.id } })).length,
      0,
    );
  });
});

function tokenFrom(message, prefix) {
  const match = message.text.match(new RegExp(`${prefix}\\?token=(\\S+)`));
  assert.ok(match, `the message links to ${prefix}`);
  return decodeURIComponent(match[1]);
}
