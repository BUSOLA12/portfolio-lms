// Step 1.4 — guardian stub accounts and invitation tokens.
//
// Proves the done-when condition: a guardian registration produces a pending
// stub user, a guardianship row, and a token that expires and cannot be reused.
//
// Registration is driven through the HTTP endpoint, because "a guardian
// registration produces" is a claim about the whole flow, not about the
// services in isolation. The token itself is exercised directly — it never
// appears in a response body, and step 1.6 is what will put it in an email.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import { createApp } from '../src/app.js';
import { prisma } from '../src/db/client.js';
import {
  createOneTimeToken,
  findOneTimeTokenByHash,
} from '../src/repositories/oneTimeTokenRepository.js';
import {
  DEFAULT_RELATIONSHIP,
  isGuardianOf,
  linkGuardianToLearner,
} from '../src/services/guardianshipService.js';
import {
  GUARDIAN_INVITATION,
  hashOneTimeToken,
  issueGuardianInvitation,
  redeemOneTimeToken,
  resolveOneTimeToken,
} from '../src/services/invitationService.js';
import { registerLearner } from '../src/services/registrationService.js';

const EMAIL_PREFIX = 'step-1-4-guardianship';

let server;
let origin;

const usedEmails = [];

function freshEmail(label) {
  const address = `${EMAIL_PREFIX}+${label}-${randomUUID()}@example.invalid`;
  usedEmails.push(address);
  return address;
}

function guardianRegistration({ learnerEmail, guardianEmail, relationship }) {
  const guardian = {
    fullName: 'A Guardian',
    email: guardianEmail,
    phone: '08000000010',
  };

  if (relationship !== undefined) {
    guardian.relationship = relationship;
  }

  return {
    relationship: 'guardian',
    fullName: 'A Learner',
    email: learnerEmail,
    password: 'a correct password',
    guardian,
  };
}

async function postRegistration(body) {
  const response = await fetch(`${origin}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  return { status: response.status, body: await response.json() };
}

before(async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must be set to run these tests');
  assert.ok(
    process.env.ONE_TIME_TOKEN_SECRET,
    'ONE_TIME_TOKEN_SECRET must be set to run these tests',
  );

  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (usedEmails.length > 0) {
    // Tokens and guardianships cascade from the user rows.
    await prisma.user.deleteMany({ where: { email: { in: usedEmails } } });
  }
  await prisma.$disconnect();
  await new Promise((resolve) => server.close(resolve));
});

describe('a guardian registration', () => {
  it('produces a pending stub user, a guardianship row, and a token', async () => {
    const learnerEmail = freshEmail('full-learner');
    const guardianEmail = freshEmail('full-guardian');

    const { status } = await postRegistration(
      guardianRegistration({ learnerEmail, guardianEmail, relationship: 'Aunt' }),
    );
    assert.equal(status, 201);

    const learner = await prisma.user.findUnique({ where: { email: learnerEmail } });
    const guardian = await prisma.user.findUnique({ where: { email: guardianEmail } });

    // The stub, per D5: pending, and no password until it is claimed at 1.7.
    assert.ok(guardian, 'the guardian stub exists');
    assert.equal(guardian.status, 'pending');
    assert.equal(guardian.passwordHash, null);
    assert.equal(guardian.fullName, 'A Guardian');
    assert.equal(guardian.phone, '08000000010');

    // The learner is unaffected by the guardian branch.
    assert.equal(learner.status, 'enabled');

    const guardianship = await prisma.guardianship.findUnique({
      where: {
        guardianId_learnerId: { guardianId: guardian.id, learnerId: learner.id },
      },
    });
    assert.ok(guardianship, 'the guardianship row links the pair');
    assert.equal(guardianship.relationship, 'Aunt');

    const tokens = await prisma.oneTimeToken.findMany({
      where: { userId: guardian.id },
    });
    assert.equal(tokens.length, 1, 'exactly one invitation token');
    assert.equal(tokens[0].purpose, GUARDIAN_INVITATION);
    assert.equal(tokens[0].consumedAt, null);
    assert.ok(tokens[0].expiresAt > new Date());
  });

  it('defaults a blank relationship to `guardian`, per D15', async () => {
    const learnerEmail = freshEmail('default-learner');
    const guardianEmail = freshEmail('default-guardian');

    await postRegistration(guardianRegistration({ learnerEmail, guardianEmail }));

    const [learner, guardian] = await Promise.all([
      prisma.user.findUnique({ where: { email: learnerEmail } }),
      prisma.user.findUnique({ where: { email: guardianEmail } }),
    ]);

    const guardianship = await prisma.guardianship.findUnique({
      where: {
        guardianId_learnerId: { guardianId: guardian.id, learnerId: learner.id },
      },
    });

    assert.equal(guardianship.relationship, DEFAULT_RELATIONSHIP);
    assert.equal(guardianship.relationship, 'guardian');
  });

  it('never returns the invitation token to the browser', async () => {
    const learnerEmail = freshEmail('leak-learner');
    const guardianEmail = freshEmail('leak-guardian');

    const { body } = await postRegistration(
      guardianRegistration({ learnerEmail, guardianEmail }),
    );

    const guardian = await prisma.user.findUnique({ where: { email: guardianEmail } });
    const [token] = await prisma.oneTimeToken.findMany({
      where: { userId: guardian.id },
    });

    const serialised = JSON.stringify(body);
    assert.equal(serialised.includes(token.tokenHash), false);
    assert.equal('guardian' in body, false, 'the response carries the learner only');
  });

  it('reuses an existing account rather than colliding on the unique email', async () => {
    // A parent registering a second child. The brief allows one person to be a
    // learner on one course and a guardian for their child.
    const guardianEmail = freshEmail('shared-guardian');
    const firstLearner = freshEmail('shared-learner-one');
    const secondLearner = freshEmail('shared-learner-two');

    assert.equal(
      (
        await postRegistration(
          guardianRegistration({ learnerEmail: firstLearner, guardianEmail }),
        )
      ).status,
      201,
    );
    assert.equal(
      (
        await postRegistration(
          guardianRegistration({ learnerEmail: secondLearner, guardianEmail }),
        )
      ).status,
      201,
    );

    const guardians = await prisma.user.findMany({ where: { email: guardianEmail } });
    assert.equal(guardians.length, 1, 'one guardian account, not two');

    const guardianships = await prisma.guardianship.findMany({
      where: { guardianId: guardians[0].id },
    });
    assert.equal(guardianships.length, 2, 'one guardianship per learner');

    // Still unclaimed, so the second registration issued a second invitation.
    assert.equal(guardians[0].status, 'pending');
    assert.equal(
      (await prisma.oneTimeToken.findMany({ where: { userId: guardians[0].id } })).length,
      2,
    );
  });

  it('issues no invitation to a guardian who already has an account', async () => {
    // Nothing to claim on an account that already has a password.
    const guardianEmail = freshEmail('enabled-guardian');
    await registerLearner({
      relationship: 'self',
      fullName: 'An Adult',
      email: guardianEmail,
      password: 'a correct password',
    });

    const learnerEmail = freshEmail('enabled-guardian-learner');
    assert.equal(
      (await postRegistration(guardianRegistration({ learnerEmail, guardianEmail })))
        .status,
      201,
    );

    const guardian = await prisma.user.findUnique({ where: { email: guardianEmail } });
    assert.equal(guardian.status, 'enabled');
    assert.equal(
      (await prisma.oneTimeToken.findMany({ where: { userId: guardian.id } })).length,
      0,
      'an enabled account gets no claim token',
    );

    const learner = await prisma.user.findUnique({ where: { email: learnerEmail } });
    assert.equal(await isGuardianOf(guardian.id, learner.id), true);
  });

  it('writes nothing at all when the guardian branch fails', async () => {
    const learnerEmail = freshEmail('rollback-learner');

    // Called below the schema on purpose, with a guardian the database will
    // refuse: `users.full_name` is NOT NULL. The learner row is written first,
    // so this fails only after there is something to roll back.
    await assert.rejects(
      registerLearner({
        relationship: 'guardian',
        fullName: 'A Learner',
        email: learnerEmail,
        password: 'a correct password',
        guardian: {
          fullName: null,
          email: freshEmail('rollback-guardian'),
          phone: '08000000011',
        },
      }),
    );

    assert.equal(
      (await prisma.user.findMany({ where: { email: learnerEmail } })).length,
      0,
      'the learner row rolled back with the guardian branch',
    );
  });
});

describe('the invitation token', () => {
  async function makeGuardian(label) {
    return prisma.user.create({
      data: { email: freshEmail(label), fullName: 'A Guardian', status: 'pending' },
    });
  }

  it('is stored only as a hash, scoped to its purpose', async () => {
    const guardian = await makeGuardian('hash');
    const { token, oneTimeToken } = await issueGuardianInvitation(guardian.id);

    assert.notEqual(oneTimeToken.tokenHash, token);
    assert.match(oneTimeToken.tokenHash, /^[0-9a-f]{64}$/);

    const [{ count }] = await prisma.$queryRaw`
      SELECT count(*)::int AS count FROM one_time_tokens WHERE token_hash = ${token}
    `;
    assert.equal(count, 0, 'the raw token is nowhere in the table');

    // The purpose is part of the hashed message, so the same raw value
    // presented to another flow does not match.
    assert.notEqual(
      hashOneTimeToken('password_reset', token),
      hashOneTimeToken(GUARDIAN_INVITATION, token),
    );
    assert.equal(await resolveOneTimeToken('password_reset', token), null);
  });

  it('cannot be reused', async () => {
    const guardian = await makeGuardian('reuse');
    const { token } = await issueGuardianInvitation(guardian.id);

    const first = await redeemOneTimeToken(GUARDIAN_INVITATION, token);
    assert.ok(first, 'the first redemption succeeds');
    assert.equal(first.userId, guardian.id);

    assert.equal(
      await redeemOneTimeToken(GUARDIAN_INVITATION, token),
      null,
      'the second redemption is refused',
    );
    assert.equal(await resolveOneTimeToken(GUARDIAN_INVITATION, token), null);

    // Consumed, not deleted — the redemption stays auditable.
    const row = await findOneTimeTokenByHash(
      hashOneTimeToken(GUARDIAN_INVITATION, token),
    );
    assert.ok(row.consumedAt instanceof Date);
  });

  it('lets exactly one of two simultaneous redemptions win', async () => {
    const guardian = await makeGuardian('race');
    const { token } = await issueGuardianInvitation(guardian.id);

    const results = await Promise.all([
      redeemOneTimeToken(GUARDIAN_INVITATION, token),
      redeemOneTimeToken(GUARDIAN_INVITATION, token),
    ]);

    assert.equal(results.filter(Boolean).length, 1, 'one winner, not two');
  });

  it('expires', async () => {
    const guardian = await makeGuardian('expiry');
    const { token } = await issueGuardianInvitation(guardian.id);

    const afterExpiry = new Date(Date.now() + 8 * 24 * 60 * 60 * 1000);

    assert.equal(
      await resolveOneTimeToken(GUARDIAN_INVITATION, token, { now: afterExpiry }),
      null,
    );
    assert.equal(
      await redeemOneTimeToken(GUARDIAN_INVITATION, token, { now: afterExpiry }),
      null,
    );
  });

  it('refuses a token that was already expired when stored', async () => {
    const guardian = await makeGuardian('stored-expired');
    const token = 'a-token-that-is-already-past-it';

    await createOneTimeToken({
      userId: guardian.id,
      purpose: GUARDIAN_INVITATION,
      tokenHash: hashOneTimeToken(GUARDIAN_INVITATION, token),
      expiresAt: new Date(Date.now() - 1000),
    });

    assert.equal(await redeemOneTimeToken(GUARDIAN_INVITATION, token), null);
  });

  it('refuses an unknown token', async () => {
    assert.equal(await resolveOneTimeToken(GUARDIAN_INVITATION, 'never-issued'), null);
    assert.equal(await resolveOneTimeToken(GUARDIAN_INVITATION, ''), null);
  });
});

describe('linkGuardianToLearner', () => {
  it('runs inside the caller’s transaction', async () => {
    const learnerEmail = freshEmail('tx-learner');
    const guardianEmail = freshEmail('tx-guardian');

    await assert.rejects(
      prisma.$transaction(async (tx) => {
        const learner = await tx.user.create({
          data: { email: learnerEmail, fullName: 'A Learner', status: 'enabled' },
        });

        await linkGuardianToLearner(tx, learner, {
          fullName: 'A Guardian',
          email: guardianEmail,
          phone: '08000000012',
        });

        throw new Error('rolled back on purpose');
      }),
    );

    assert.equal(
      (await prisma.user.findMany({ where: { email: guardianEmail } })).length,
      0,
      'the stub rolled back with the transaction that made it',
    );
  });
});
