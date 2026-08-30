// Credentials and role standing.
//
// Sits between the controller and the session machinery from 1.2: it answers
// "are these credentials good, and who is this person" without knowing
// anything about cookies or HTTP.

import { prisma } from '../db/client.js';
import { verifyPassword } from './passwordService.js';

// A real scrypt hash of a random string nobody holds. Used when the address
// does not exist, or the account has no password, so that a failed login costs
// the same key derivation as a successful one. Without it, "no such user"
// returns in microseconds while a wrong password takes ~100ms, and that gap
// tells an attacker which addresses are registered.
const ABSENT_PASSWORD_HASH =
  'scrypt$32768$8$1$Yjums/19tEKb/RBi61f1gQ==$oLmy3RaqXaHBPGuqvklCKUjXGnUkl/yrkZ/w4U58JL4=';

const PUBLIC_USER_FIELDS = {
  id: true,
  email: true,
  fullName: true,
  phone: true,
  status: true,
  emailVerifiedAt: true,
  isAdmin: true,
  createdAt: true,
};

/**
 * Verifies an email and password, returning the user or null.
 *
 * Null covers every failure alike — unknown address, wrong password, an account
 * that is not `enabled`. A login form has no use for the difference, and
 * distinguishing them turns the endpoint into a register of who has an account.
 *
 * A `pending` stub is refused here as well as failing on its null password: per
 * D5 it is an account created on someone's behalf and not yet claimed.
 */
export async function authenticate(email, password) {
  const user = await prisma.user.findUnique({ where: { email } });

  const matches = await verifyPassword(
    password,
    user?.passwordHash ?? ABSENT_PASSWORD_HASH,
  );

  if (!user || !matches) return null;
  if (user.status !== 'enabled') return null;

  return publicUser(user);
}

export function publicUser(user) {
  const safe = {};
  for (const field of Object.keys(PUBLIC_USER_FIELDS)) {
    safe[field] = user[field];
  }
  return safe;
}

/**
 * Who this person is, derived rather than stored.
 *
 * Architecture §4.7: no role enum on users. `is_admin` is the one stored flag;
 * learner and guardian standing come from the existence of rows elsewhere.
 *
 * `learner` is structurally present and always false at this step, because it
 * derives from `enrollments` and that table does not exist until step 3.1. The
 * seam is the one line below: when 3.1 lands, count enrollments there and
 * nothing else in this file, the controller or the response shape changes.
 */
export async function resolveRoleStanding(userId) {
  const guardianships = await prisma.guardianship.count({
    where: { guardianId: userId },
  });

  // Step 3.1: replace with a count of this user's enrollments.
  const enrollments = 0;

  return {
    learner: enrollments > 0,
    guardian: guardianships > 0,
  };
}
