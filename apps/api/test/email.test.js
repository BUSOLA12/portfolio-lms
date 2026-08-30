// Step 1.5 — email provider abstraction and `email_log`.
//
// Proves the done-when condition: a test send writes an `email_log` row, and a
// second send of the same type for the same entity is refused by the guard
// rather than by the provider.
//
// The provider is a recording fake throughout. That is not a convenience — it
// is what makes the second half of the condition checkable at all: the only way
// to show the guard refused the repeat is to show the transport was never
// reached.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';

import { prisma } from '../src/db/client.js';
import { findEmailSent } from '../src/repositories/emailLogRepository.js';
import { SEND_ALREADY_SENT, SEND_SENT, sendEmail } from '../src/services/emailService.js';
import { getEmailProvider } from '../src/services/providers/emailProvider.js';

const EMAIL_PREFIX = 'step-1-5-email';

const createdUserIds = [];

// Records every message it is handed, and never transmits.
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

const template = {
  subject: 'A subject',
  html: '<p>A body</p>',
  text: 'A body',
};

async function makeUser() {
  const user = await prisma.user.create({
    data: {
      email: `${EMAIL_PREFIX}+${randomUUID()}@example.invalid`,
      fullName: 'An Email Recipient',
      status: 'enabled',
    },
  });
  createdUserIds.push(user.id);
  return user;
}

before(() => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set to run these tests');
});

beforeEach(() => {
  // Restored per test because one case below deletes it deliberately.
  // test/setup.js is what guarantees no suite can reach a real transport.
  process.env.EMAIL_FROM = 'Tests <tests@example.invalid>';
});

after(async () => {
  if (createdUserIds.length > 0) {
    // email_log rows cascade from the user.
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  }
  await prisma.$disconnect();
});

describe('sendEmail', () => {
  it('writes an email_log row', async () => {
    const user = await makeUser();
    const provider = recordingProvider();

    const result = await sendEmail({
      user,
      type: 'guardian_invitation',
      entityRef: 'token-1',
      template,
      provider,
    });

    assert.equal(result.status, SEND_SENT);
    assert.equal(result.sent, true);

    assert.equal(provider.sent.length, 1);
    assert.equal(provider.sent[0].to, user.email);
    assert.equal(provider.sent[0].from, 'Tests <tests@example.invalid>');
    assert.equal(provider.sent[0].subject, 'A subject');
    assert.equal(provider.sent[0].text, 'A body');

    const row = await findEmailSent({
      userId: user.id,
      type: 'guardian_invitation',
      entityRef: 'token-1',
    });
    assert.ok(row, 'the send is recorded');
    assert.equal(row.id, result.emailLog.id);
    assert.ok(row.sentAt instanceof Date);
  });

  it('refuses a repeat by the guard, before the provider is reached', async () => {
    const user = await makeUser();
    const provider = recordingProvider();

    const first = await sendEmail({
      user,
      type: 'expiry_warning_7d',
      entityRef: 'enrollment-1',
      template,
      provider,
    });
    const second = await sendEmail({
      user,
      type: 'expiry_warning_7d',
      entityRef: 'enrollment-1',
      template,
      provider,
    });

    assert.equal(first.status, SEND_SENT);
    assert.equal(second.status, SEND_ALREADY_SENT);
    assert.equal(second.sent, false);

    // The distinction the done-when draws: the transport saw one message, not
    // two. The repeat was stopped by the guard, not refused downstream.
    assert.equal(provider.sent.length, 1, 'the provider was reached exactly once');

    // And the second call reports the row that already existed.
    assert.equal(second.emailLog.id, first.emailLog.id);

    const rows = await prisma.emailLog.findMany({ where: { userId: user.id } });
    assert.equal(rows.length, 1, 'one row, not two');
  });

  it('runs the daily sweep case: seven calls, one email', async () => {
    // Rule 9's actual scenario. Cron runs every day of the expiry window and
    // must not warn the same learner seven times.
    const user = await makeUser();
    const provider = recordingProvider();

    for (let day = 0; day < 7; day += 1) {
      await sendEmail({
        user,
        type: 'expiry_warning_7d',
        entityRef: 'enrollment-2',
        template,
        provider,
      });
    }

    assert.equal(provider.sent.length, 1);
    assert.equal(
      (await prisma.emailLog.findMany({ where: { userId: user.id } })).length,
      1,
    );
  });

  it('does not confuse one entity with another', async () => {
    // A reminder about instalment 2 must not be suppressed by one already sent
    // about instalment 1.
    const user = await makeUser();
    const provider = recordingProvider();

    await sendEmail({
      user,
      type: 'payment_reminder_7d',
      entityRef: 'instalment-1',
      template,
      provider,
    });
    const second = await sendEmail({
      user,
      type: 'payment_reminder_7d',
      entityRef: 'instalment-2',
      template,
      provider,
    });

    assert.equal(second.status, SEND_SENT);
    assert.equal(provider.sent.length, 2);
  });

  it('does not confuse one type with another', async () => {
    const user = await makeUser();
    const provider = recordingProvider();

    await sendEmail({ user, type: 'email_verification', template, provider });
    const second = await sendEmail({
      user,
      type: 'guardian_invitation',
      template,
      provider,
    });

    assert.equal(second.status, SEND_SENT);
    assert.equal(provider.sent.length, 2);
  });

  it('guards account-level mail, which has no entity at all', async () => {
    // entity_ref is null here. The index is not unique precisely so that this
    // case still dedupes — Postgres would treat every NULL as distinct.
    const user = await makeUser();
    const provider = recordingProvider();

    await sendEmail({ user, type: 'email_verification', template, provider });
    const second = await sendEmail({
      user,
      type: 'email_verification',
      template,
      provider,
    });

    assert.equal(second.status, SEND_ALREADY_SENT);
    assert.equal(provider.sent.length, 1);
  });

  it('records nothing when the provider refuses', async () => {
    // Send first, record second. A row written before a failed transmission
    // would suppress every retry, and the learner would never be warned.
    const user = await makeUser();
    const failing = {
      name: 'failing',
      async send() {
        throw new Error('transport refused');
      },
    };

    await assert.rejects(
      sendEmail({ user, type: 'payment_reminder_1d', template, provider: failing }),
      /transport refused/,
    );

    assert.equal(
      (await prisma.emailLog.findMany({ where: { userId: user.id } })).length,
      0,
      'a failed send leaves the guard open for tomorrow',
    );
  });

  it('refuses to send with no sender configured', async () => {
    const user = await makeUser();
    delete process.env.EMAIL_FROM;

    await assert.rejects(
      sendEmail({
        user,
        type: 'email_verification',
        template,
        provider: recordingProvider(),
      }),
      /EMAIL_FROM/,
    );
  });
});

describe('the test transport lock', () => {
  it('pins every suite to a transport that cannot deliver', () => {
    // test/setup.js, loaded via --import. Both locks, not one: the transport is
    // console, and the key cannot authenticate, so even a suite that selects
    // resend fails at Resend rather than delivering. Overwritten rather than
    // deleted, because importing Prisma re-reads .env and would restore it.
    assert.equal(process.env.EMAIL_PROVIDER, 'console');
    assert.equal(process.env.EMAIL_API_KEY, 'blocked-by-test-setup');
  });
});

describe('getEmailProvider', () => {
  it('resolves the configured transports by name', () => {
    assert.equal(getEmailProvider('resend').name, 'resend');
    assert.equal(getEmailProvider('console').name, 'console');
  });

  it('throws on an unknown transport', () => {
    assert.throws(() => getEmailProvider('postmark'), /EMAIL_PROVIDER must be one of/);
    assert.throws(() => getEmailProvider(''), /EMAIL_PROVIDER must be one of/);
  });

  it('throws rather than defaulting when EMAIL_PROVIDER is unset', () => {
    // An unset EMAIL_PROVIDER quietly becoming a no-op would mean a deploy
    // that logs every dunning reminder and sends none.
    const configured = process.env.EMAIL_PROVIDER;
    delete process.env.EMAIL_PROVIDER;

    try {
      assert.throws(() => getEmailProvider(), /EMAIL_PROVIDER must be one of/);
    } finally {
      if (configured !== undefined) process.env.EMAIL_PROVIDER = configured;
    }
  });
});
