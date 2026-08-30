// Data access for `email_log`. Prisma calls only.
//
// The index architecture section 4.8 names is `(user_id, type, entity_ref)`,
// which is exactly the lookup below — the guard reads it before every send.

import { prisma } from '../db/client.js';

export function recordEmailSent({ userId, type, entityRef = null }, client = prisma) {
  return client.emailLog.create({
    data: { userId, type, entityRef },
  });
}

/**
 * The duplicate-send guard's read. `entityRef: null` matches only rows whose
 * `entity_ref` is null, which is what account-level mail wants — a second
 * verification email must find the first one.
 */
export function findEmailSent({ userId, type, entityRef = null }, client = prisma) {
  return client.emailLog.findFirst({
    where: { userId, type, entityRef },
    orderBy: { sentAt: 'asc' },
  });
}
