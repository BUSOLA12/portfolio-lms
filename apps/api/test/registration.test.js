// Step 1.3 — registration with the relationship field.
//
// Proves the done-when condition: a `self` registration creates one user, and
// a `guardian` registration missing its guardian fields is rejected with
// field-level errors.
//
// Driven through the assembled Express app over a real socket, so the route,
// controller, schema and service are exercised together rather than in
// isolation. The database is the one named by DATABASE_URL — see the note in
// authSession.test.js.

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';

import { createApp } from '../src/app.js';
import { prisma } from '../src/db/client.js';
import { verifyPassword } from '../src/services/passwordService.js';

const EMAIL_PREFIX = 'step-1-3-registration';

let server;
let origin;

const usedEmails = [];

function freshEmail(label) {
  const address = `${EMAIL_PREFIX}+${label}-${randomUUID()}@example.invalid`;
  usedEmails.push(address);
  return address;
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

describe('POST /auth/register — self', () => {
  it('creates exactly one user', async () => {
    const email = freshEmail('self');

    const { status, body } = await postRegistration({
      relationship: 'self',
      fullName: 'Ada Lovelace',
      email,
      phone: '08000000001',
      password: 'a correct password',
    });

    assert.equal(status, 201);
    assert.equal(body.user.email, email);
    assert.equal(body.user.fullName, 'Ada Lovelace');

    // D5: the learner set a password, so the row is `enabled`. `pending` is an
    // unclaimed stub, which this is not.
    assert.equal(body.user.status, 'enabled');
    assert.equal(body.user.emailVerifiedAt, null);
    assert.equal('passwordHash' in body.user, false);

    const rows = await prisma.user.findMany({ where: { email } });
    assert.equal(rows.length, 1, 'exactly one user row');
    assert.equal(rows[0].isAdmin, false);
    assert.equal(await verifyPassword('a correct password', rows[0].passwordHash), true);
  });

  it('normalises the email and trims the name before storing', async () => {
    const email = freshEmail('normalise');

    const { status } = await postRegistration({
      relationship: 'self',
      fullName: '  Grace Hopper  ',
      email: `  ${email.toUpperCase()}  `,
      password: 'a correct password',
    });

    assert.equal(status, 201);

    const stored = await prisma.user.findUnique({ where: { email } });
    assert.ok(stored, 'the lowercased address is what was stored');
    assert.equal(stored.fullName, 'Grace Hopper');
    assert.equal(stored.phone, null, 'the learner phone is optional');
  });

  it('refuses a second account on the same email', async () => {
    const email = freshEmail('duplicate');
    const body = {
      relationship: 'self',
      fullName: 'Ada Lovelace',
      email,
      password: 'a correct password',
    };

    assert.equal((await postRegistration(body)).status, 201);

    const second = await postRegistration(body);
    assert.equal(second.status, 409);
    assert.match(second.body.error.fields.email, /already exists/);

    assert.equal((await prisma.user.findMany({ where: { email } })).length, 1);
  });
});

describe('POST /auth/register — guardian', () => {
  it('accepts an optional guardian relationship, and treats blank as absent', async () => {
    // Per D15: free text, no option list, and blank is not an empty string.
    const stated = await postRegistration({
      relationship: 'guardian',
      fullName: 'A Learner',
      email: freshEmail('guardian-relationship'),
      password: 'a correct password',
      guardian: {
        fullName: 'A Guardian',
        email: freshEmail('guardian-relationship-adult'),
        phone: '08000000004',
        relationship: '  Aunt  ',
      },
    });
    assert.equal(stated.status, 201);

    const blank = await postRegistration({
      relationship: 'guardian',
      fullName: 'A Learner',
      email: freshEmail('guardian-blank-relationship'),
      password: 'a correct password',
      guardian: {
        fullName: 'A Guardian',
        email: freshEmail('guardian-blank-relationship-adult'),
        phone: '08000000005',
        relationship: '   ',
      },
    });
    assert.equal(blank.status, 201);
  });

  it('does not require the guardian relationship', async () => {
    const { body } = await postRegistration({
      relationship: 'guardian',
      fullName: 'A Learner',
      email: freshEmail('guardian-relationship-optional'),
      password: 'a correct password',
    });

    // The three required fields report; the optional fourth does not.
    assert.equal('guardian.relationship' in body.error.fields, false);
  });

  it('rejects a guardian registration with no guardian fields, per field', async () => {
    const email = freshEmail('guardian-missing');

    const { status, body } = await postRegistration({
      relationship: 'guardian',
      fullName: 'A Learner',
      email,
      password: 'a correct password',
    });

    assert.equal(status, 422);

    // Field-level, not one opaque error on the parent object: a form renders
    // three inputs and each needs its own message.
    assert.deepEqual(Object.keys(body.error.fields).sort(), [
      'guardian.email',
      'guardian.fullName',
      'guardian.phone',
    ]);

    assert.equal(
      (await prisma.user.findMany({ where: { email } })).length,
      0,
      'a rejected registration writes nothing',
    );
  });

  it('reports only the guardian fields actually missing', async () => {
    const { status, body } = await postRegistration({
      relationship: 'guardian',
      fullName: 'A Learner',
      email: freshEmail('guardian-partial'),
      password: 'a correct password',
      guardian: { fullName: 'A Guardian' },
    });

    assert.equal(status, 422);
    assert.deepEqual(Object.keys(body.error.fields).sort(), [
      'guardian.email',
      'guardian.phone',
    ]);
  });

  it('refuses a guardian sharing the learner’s email address', async () => {
    const email = freshEmail('guardian-same');

    const { status, body } = await postRegistration({
      relationship: 'guardian',
      fullName: 'A Learner',
      email,
      password: 'a correct password',
      guardian: { fullName: 'A Guardian', email, phone: '08000000002' },
    });

    assert.equal(status, 422);
    assert.ok(body.error.fields['guardian.email']);
  });

  it('accepts a complete guardian registration, creating learner and stub', async () => {
    const email = freshEmail('guardian-valid');
    const guardianEmail = freshEmail('guardian-valid-adult');

    const { status, body } = await postRegistration({
      relationship: 'guardian',
      fullName: 'A Learner',
      email,
      password: 'a correct password',
      guardian: {
        fullName: 'A Guardian',
        email: guardianEmail,
        phone: '08000000003',
      },
    });

    assert.equal(status, 201);
    assert.equal(body.user.email, email);

    assert.equal((await prisma.user.findMany({ where: { email } })).length, 1);

    // Until 1.4 this asserted the stub did *not* exist, guarding the seam
    // registrationService left open. 1.4 closed it, so the assertion inverts —
    // the guard fired on the first run of the step that filled the seam in.
    // The stub itself is covered in depth by guardianship.test.js.
    assert.equal(
      (await prisma.user.findMany({ where: { email: guardianEmail } })).length,
      1,
      'the guardian stub is created alongside the learner',
    );
  });
});

describe('POST /auth/register — malformed input', () => {
  it('rejects an unknown relationship value', async () => {
    const { status, body } = await postRegistration({
      relationship: 'parent',
      fullName: 'A Learner',
      email: freshEmail('bad-relationship'),
      password: 'a correct password',
    });

    assert.equal(status, 422);
    assert.ok(body.error.fields.relationship);
  });

  it('rejects a short password and an invalid email', async () => {
    const { status, body } = await postRegistration({
      relationship: 'self',
      fullName: 'A Learner',
      email: 'not-an-email',
      password: 'short',
    });

    assert.equal(status, 422);
    assert.ok(body.error.fields.email);
    assert.ok(body.error.fields.password);
  });

  it('rejects an empty body with a field-level error on every requirement', async () => {
    const { status, body } = await postRegistration({});

    assert.equal(status, 422);
    assert.equal(body.error.status, 422);
    assert.ok(body.error.fields.relationship);
  });
});
