// Password hashing and verification.
//
// scrypt from node:crypto, not bcrypt or argon2. Both of those are native
// addons that must compile in Railway's build image; scrypt is memory-hard,
// ships with Node, and adds nothing to the dependency tree the deploy has to
// resolve. The stored string carries its own parameters, so raising the cost
// later does not invalidate hashes written today.
//
// This module never touches the database. Whether a user has a password at all
// is a question for the caller — a pending guardian stub (D5) has none.

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback);

const ALGORITHM = 'scrypt';

// N=2^15, r=8, p=1. Memory is 128 * N * r, so 32 MiB per hash. Node's default
// maxmem is exactly 32 MiB and the allocation would be refused at the
// boundary, hence the explicit ceiling below.
const COST = 2 ** 15;
const BLOCK_SIZE = 8;
const PARALLELISATION = 1;
const MAX_MEMORY = 64 * 1024 * 1024;

const KEY_LENGTH = 32;
const SALT_LENGTH = 16;

// Unicode normalisation, applied on both sides. Without it the same password
// typed on two keyboards can produce two different byte sequences.
function normalise(password) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new TypeError('A password must be a non-empty string');
  }
  return password.normalize('NFKC');
}

/**
 * Returns `scrypt$N$r$p$salt$key`, salt and key base64. Self-describing, so
 * verification reads the parameters out of the stored value rather than
 * assuming today's constants.
 */
export async function hashPassword(password) {
  const salt = randomBytes(SALT_LENGTH);

  const key = await scrypt(normalise(password), salt, KEY_LENGTH, {
    N: COST,
    r: BLOCK_SIZE,
    p: PARALLELISATION,
    maxmem: MAX_MEMORY,
  });

  return [
    ALGORITHM,
    COST,
    BLOCK_SIZE,
    PARALLELISATION,
    salt.toString('base64'),
    key.toString('base64'),
  ].join('$');
}

/**
 * False for an account with no password set — a pending stub cannot log in.
 * A stored value that is present but malformed throws instead: that is
 * corruption, and failing loudly is easier to diagnose than a login that
 * silently refuses a correct password.
 */
export async function verifyPassword(password, storedHash) {
  if (storedHash === null || storedHash === undefined || storedHash === '') {
    return false;
  }

  const parts = storedHash.split('$');
  if (parts.length !== 6 || parts[0] !== ALGORITHM) {
    throw new Error('Stored password hash is malformed');
  }

  const [, cost, blockSize, parallelisation, saltBase64, keyBase64] = parts;
  const salt = Buffer.from(saltBase64, 'base64');
  const expected = Buffer.from(keyBase64, 'base64');

  const actual = await scrypt(normalise(password), salt, expected.length, {
    N: Number(cost),
    r: Number(blockSize),
    p: Number(parallelisation),
    maxmem: MAX_MEMORY,
  });

  // Lengths are equal by construction; timingSafeEqual throws if they are not.
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
