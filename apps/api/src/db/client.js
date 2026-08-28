// Single PrismaClient for the API process.
//
// One instance is shared across the whole process. A client per request would
// open a fresh connection pool every time and exhaust Postgres. In development
// the instance is parked on globalThis so `node --watch` reloads reuse it
// rather than leaking a pool on every restart.

import { PrismaClient } from '../../prisma/generated/index.js';

const globalForPrisma = globalThis;

export const prisma = globalForPrisma.__prismaClient ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.__prismaClient = prisma;
}
