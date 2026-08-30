// Step 1.7 — the guardian claim flow.
//
// Proves the done-when condition: the invitation link lets the guardian set a
// password once; replaying it fails; an expired token fails.
//
// The token is taken from the invitation email itself rather than from the
// database, so what is exercised is the link a guardian actually receives.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import { createApp } from '../src/app.js';
import { prisma } from '../src/db/client.js';
import {
  GUARDIAN_INVITATION,
  hashOneTimeToken,
} from '../src/services/invitationService.js';
import { createOneTimeToken } from '../src/repositories/oneTimeTokenRepository.js';
import { verifyPassword } from '../src/services/passwordService.js';
import { registerLearner } from '../src/services/registrationService.js';
import {
  GUARDIAN_INVITATION_RESEND,
  resendGuardianInvitation,
} from '../src/services/guardianshipService.js';
import { hashPassword } from '../src/services/passwordService.js';

const EMAIL_PREFIX = 'step-1-7-claim';
const NEW_PASSWORD = 'a password the guardian chose';

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

async function postClaim(body) {
  const response = await fetch(`${origin}/auth/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

/**
 * Registers a learner naming a guardian, and returns the claim token as it
 * appears in the invitation email's link.
 */
async function invite({
  guardianEmail = freshEmail('guardian'),
  learnerName = 'A Learner',
} = {}) {
  const provider = recordingProvider();

  await registerLearner(
    {
      relationship: 'guardian',
      fullName: learnerName,
      email: freshEmail('learner'),
      password: 'the learner own password',
      guardian: { fullName: 'A Guardian', email: guardianEmail, phone: '08000000030' },
    },
    { emailProvider: provider },
  );

  const invitation = provider.sent.find((message) => message.to === guardianEmail);
  assert.ok(invitation, 'an invitation was sent');

  const match = invitation.text.match(/\/claim\?token=(\S+)/);
  assert.ok(match, 'the invitation links to the claim page');

  const guardian = await prisma.user.findUnique({ where: { email: guardianEmail } });
  return { token: decodeURIComponent(match[1]), guardian, guardianEmail };
}

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set to run these tests');
  assert.ok(process.env.ONE_TIME_TOKEN_SECRET, 'ONE_TIME_TOKEN_SECRET must be set');

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

describe('the invitation link', () => {
  it('lets the guardian set a password once', async () => {
    const { token, guardian, guardianEmail } = await invite();

    // The stub, before: pending and passwordless, per D5.
    assert.equal(guardian.status, 'pending');
    assert.equal(guardian.passwordHash, null);

    const { status, body } = await postClaim({ token, password: NEW_PASSWORD });

    assert.equal(status, 200);
    assert.equal(body.user.email, guardianEmail);
    assert.equal(body.user.status, 'enabled');
    assert.equal('passwordHash' in body.user, false);

    const claimed = await prisma.user.findUnique({ where: { email: guardianEmail } });
    assert.equal(claimed.status, 'enabled');
    assert.equal(await verifyPassword(NEW_PASSWORD, claimed.passwordHash), true);
  });

  it('stamps email_verified_at, per D18', async () => {
    const { token, guardian, guardianEmail } = await invite();

    assert.equal(guardian.emailVerifiedAt, null, 'the stub starts unverified');

    const { body } = await postClaim({ token, password: NEW_PASSWORD });
    assert.ok(body.user.emailVerifiedAt, 'the response reports it too');

    const claimed = await prisma.user.findUnique({ where: { email: guardianEmail } });
    assert.ok(claimed.emailVerifiedAt instanceof Date);

    // The same timestamp that burned the token, so the two cannot disagree
    // about when control of the address was proven.
    const burned = await prisma.oneTimeToken.findUnique({
      where: { tokenHash: hashOneTimeToken(GUARDIAN_INVITATION, token) },
    });
    assert.equal(
      claimed.emailVerifiedAt.getTime(),
      burned.consumedAt.getTime(),
      'verification and consumption share a timestamp',
    );
  });

  it('leaves email_verified_at null when the claim fails', async () => {
    const { guardianEmail } = await invite();

    assert.equal(
      (await postClaim({ token: 'never-issued-by-anyone', password: NEW_PASSWORD }))
        .status,
      422,
    );

    const user = await prisma.user.findUnique({ where: { email: guardianEmail } });
    assert.equal(user.emailVerifiedAt, null);
    assert.equal(user.status, 'pending');
  });

  it('burns the token rather than deleting it', async () => {
    const { token, guardian } = await invite();
    await postClaim({ token, password: NEW_PASSWORD });

    const row = await prisma.oneTimeToken.findUnique({
      where: { tokenHash: hashOneTimeToken(GUARDIAN_INVITATION, token) },
    });

    // Per D8: a consumed marker, not a delete, so the redemption stays
    // auditable and a replay is distinguishable from a token that never was.
    assert.ok(row, 'the row is still there');
    assert.ok(row.consumedAt instanceof Date);
    assert.equal(row.userId, guardian.id);
  });
});

describe('replaying the link', () => {
  it('fails, and leaves the first password standing', async () => {
    const { token, guardianEmail } = await invite();

    assert.equal((await postClaim({ token, password: NEW_PASSWORD })).status, 200);

    const replay = await postClaim({ token, password: 'a different password entirely' });

    assert.equal(replay.status, 422);
    assert.match(replay.body.error.fields.token, /expired or has already been used/);

    const user = await prisma.user.findUnique({ where: { email: guardianEmail } });
    assert.equal(await verifyPassword(NEW_PASSWORD, user.passwordHash), true);
    assert.equal(
      await verifyPassword('a different password entirely', user.passwordHash),
      false,
    );
  });

  it('lets exactly one of two simultaneous claims win', async () => {
    const { token, guardianEmail } = await invite();

    const results = await Promise.all([
      postClaim({ token, password: 'the first simultaneous password' }),
      postClaim({ token, password: 'the second simultaneous password' }),
    ]);

    const succeeded = results.filter((result) => result.status === 200);
    assert.equal(succeeded.length, 1, 'one winner, not two');

    const user = await prisma.user.findUnique({ where: { email: guardianEmail } });
    assert.equal(user.status, 'enabled');
  });

  it('refuses a second live token once the account is claimed', async () => {
    // A guardian named for two learners before claiming holds two live tokens.
    // The second must not work as an unauthenticated password reset.
    const guardianEmail = freshEmail('two-learners');
    const first = await invite({ guardianEmail });
    const second = await invite({ guardianEmail });

    assert.notEqual(first.token, second.token, 'two distinct tokens were issued');

    assert.equal(
      (await postClaim({ token: first.token, password: NEW_PASSWORD })).status,
      200,
    );

    const withSecond = await postClaim({
      token: second.token,
      password: 'a password set by whoever still has the other link',
    });
    assert.equal(withSecond.status, 422);

    const user = await prisma.user.findUnique({ where: { email: guardianEmail } });
    assert.equal(await verifyPassword(NEW_PASSWORD, user.passwordHash), true);
  });
});

describe('an expired token', () => {
  it('fails', async () => {
    const guardianEmail = freshEmail('expired');
    const { guardian } = await invite({ guardianEmail });

    const token = `a-token-that-has-already-lapsed-${randomUUID()}`;
    await createOneTimeToken({
      userId: guardian.id,
      purpose: GUARDIAN_INVITATION,
      tokenHash: hashOneTimeToken(GUARDIAN_INVITATION, token),
      expiresAt: new Date(Date.now() - 1000),
    });

    const { status, body } = await postClaim({ token, password: NEW_PASSWORD });

    assert.equal(status, 422);
    assert.match(body.error.fields.token, /expired or has already been used/);

    const user = await prisma.user.findUnique({ where: { email: guardianEmail } });
    assert.equal(user.status, 'pending', 'the stub is untouched');
    assert.equal(user.passwordHash, null);
  });
});

describe('a malformed claim', () => {
  it('rejects an unknown token without saying it is unknown', async () => {
    const { status, body } = await postClaim({
      token: 'never-issued-by-anyone',
      password: NEW_PASSWORD,
    });

    assert.equal(status, 422);
    assert.match(body.error.fields.token, /expired or has already been used/);
  });

  it('rejects a password that does not meet D16', async () => {
    const { token } = await invite();

    const { status, body } = await postClaim({ token, password: 'short' });

    assert.equal(status, 422);
    assert.match(body.error.fields.password, /at least 8 characters/);
  });

  it('rejects a missing token and a missing password, per field', async () => {
    const { status, body } = await postClaim({});

    assert.equal(status, 422);
    assert.ok(body.error.fields.token);
    assert.ok(body.error.fields.password);
  });

  it('does not burn the token when the password is rejected', async () => {
    const { token, guardianEmail } = await invite();

    assert.equal((await postClaim({ token, password: 'short' })).status, 422);

    // The link must still work: a mistyped password cannot cost the guardian
    // their one chance to claim.
    assert.equal((await postClaim({ token, password: NEW_PASSWORD })).status, 200);

    const user = await prisma.user.findUnique({ where: { email: guardianEmail } });
    assert.equal(user.status, 'enabled');
  });
});

describe('resending a lapsed invitation', () => {
  // Per D19. Without this a guardian who leaves the email a week is locked out
  // permanently: claiming needs a live token, and the reset at 1.8 serves only
  // enabled accounts.

  async function expire(guardianId) {
    await prisma.oneTimeToken.updateMany({
      where: { userId: guardianId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
  }

  function tokenFromResend(provider) {
    const message = provider.sent.at(-1);
    const match = message.text.match(/\/claim\?token=(\S+)/);
    assert.ok(match, 'the resent invitation links to the claim page');
    return decodeURIComponent(match[1]);
  }

  it('lets a locked-out guardian back in', async () => {
    const guardianEmail = freshEmail('resend-locked-out');
    const { token: lapsed, guardian } = await invite({ guardianEmail });
    await expire(guardian.id);

    // The original link is dead.
    assert.equal(
      (await postClaim({ token: lapsed, password: NEW_PASSWORD })).status,
      422,
    );

    const provider = recordingProvider();
    await resendGuardianInvitation(guardianEmail, { emailProvider: provider });

    assert.equal(provider.sent.length, 1);
    assert.equal(provider.sent[0].to, guardianEmail);
    assert.match(provider.sent[0].subject, /named as a guardian for/);

    // The fresh link works, and claiming still behaves as 1.7 requires.
    const fresh = tokenFromResend(provider);
    const claimed = await postClaim({ token: fresh, password: NEW_PASSWORD });
    assert.equal(claimed.status, 200);
    assert.equal(claimed.body.user.status, 'enabled');

    const user = await prisma.user.findUnique({ where: { email: guardianEmail } });
    assert.equal(await verifyPassword(NEW_PASSWORD, user.passwordHash), true);
    assert.ok(user.emailVerifiedAt, 'D18 still applies to a resent invitation');
  });

  it('records the resend under its own type, so repeats are not suppressed', async () => {
    const guardianEmail = freshEmail('resend-twice');
    const { guardian } = await invite({ guardianEmail });
    await expire(guardian.id);

    const provider = recordingProvider();
    await resendGuardianInvitation(guardianEmail, { emailProvider: provider });
    await resendGuardianInvitation(guardianEmail, { emailProvider: provider });

    assert.equal(provider.sent.length, 2, 'a second request also sends');

    const rows = await prisma.emailLog.findMany({
      where: { userId: guardian.id, type: GUARDIAN_INVITATION_RESEND },
    });
    assert.equal(rows.length, 2);
    assert.notEqual(rows[0].entityRef, rows[1].entityRef, 'scoped per token');

    // The original automatic invitation is a separate event in the log.
    const original = await prisma.emailLog.findMany({
      where: { userId: guardian.id, type: GUARDIAN_INVITATION },
    });
    assert.equal(original.length, 1);
  });

  it('sends nothing for an account that is not a pending stub', async () => {
    const guardianEmail = freshEmail('resend-enabled');
    const { token, guardian } = await invite({ guardianEmail });
    await postClaim({ token, password: NEW_PASSWORD });

    const provider = recordingProvider();
    await resendGuardianInvitation(guardianEmail, { emailProvider: provider });

    assert.equal(provider.sent.length, 0, 'an enabled account uses the reset instead');

    const issued = await prisma.oneTimeToken.findMany({
      where: { userId: guardian.id, purpose: GUARDIAN_INVITATION, consumedAt: null },
    });
    assert.equal(issued.length, 0, 'and no new token was minted');
  });

  it('sends nothing for a pending account with no guardianship', async () => {
    // Not a guardian stub, so there is no learner to name in the email.
    const stray = await prisma.user.create({
      data: {
        email: freshEmail('resend-no-guardianship'),
        fullName: 'Not A Guardian',
        status: 'pending',
      },
    });

    const provider = recordingProvider();
    await resendGuardianInvitation(stray.email, { emailProvider: provider });

    assert.equal(provider.sent.length, 0);
    assert.equal(
      (await prisma.oneTimeToken.findMany({ where: { userId: stray.id } })).length,
      0,
    );
  });

  it('answers identically whatever the address is', async () => {
    const guardianEmail = freshEmail('resend-uniform-pending');
    await invite({ guardianEmail });

    const enabled = await prisma.user.create({
      data: {
        email: freshEmail('resend-uniform-enabled'),
        fullName: 'An Enabled Person',
        passwordHash: await hashPassword(NEW_PASSWORD),
        status: 'enabled',
      },
    });

    const responses = await Promise.all(
      [guardianEmail, enabled.email, freshEmail('resend-uniform-unknown')].map((email) =>
        fetch(`${origin}/auth/invitation/resend`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email }),
        }),
      ),
    );

    const bodies = await Promise.all(responses.map((response) => response.json()));

    for (const response of responses) assert.equal(response.status, 202);
    assert.deepEqual(bodies[0], bodies[1]);
    assert.deepEqual(bodies[1], bodies[2]);
  });

  it('rejects a missing address', async () => {
    const response = await fetch(`${origin}/auth/invitation/resend`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });

    assert.equal(response.status, 422);
    const body = await response.json();
    assert.ok(body.error.fields.email);
  });
});
