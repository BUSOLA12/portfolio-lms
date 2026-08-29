import {
  defineRailway,
  github,
  postgres,
  preserve,
  project,
  service,
  volume,
} from 'railway/iac';

// Railway infrastructure for the Portfolio + LMS project.
//
// This file is the single source of truth for the environment: one project
// definition, one apply, and omit means delete. Config as Code (railway.json)
// is deprecated and stops being read on 2026-12-01; neither service uses it.
//
// Both services build from the REPOSITORY ROOT — neither sets rootDirectory.
// That is deliberate and load-bearing: this is an npm workspaces monorepo, and
// a root install is what lets each workspace resolve @platform/schemas. Setting
// rootDirectory to apps/api or apps/web would scope the install to that
// directory and break the shared package.

export default defineRailway(() => {
  const Postgres = postgres('Postgres', { region: 'ams' });
  const postgresVolume = volume('postgres-volume', {
    alerts: { usage: { '100': {}, '80': {}, '95': {} } },
    allowOnlineResize: true,
    region: 'ams',
    sizeMB: 500,
  });

  const api = service('api', {
    source: github('BUSOLA12/portfolio-lms', { checkSuites: false }),
    // `npm run build` in apps/api runs `prisma generate`. The generated client
    // is written to apps/api/prisma/generated/, which is gitignored, so a fresh
    // clone has none and src/db/client.js cannot import. Without this the
    // service builds green and then crashes on boot.
    build: 'npm run build --workspace @platform/api',
    start: 'npm run start --workspace @platform/api',
    healthcheck: '/health',
    // Runs between build and deploy, in a separate container, from the
    // application image. If it exits non-zero the deployment does not proceed
    // and is not retried — a failed migration stops the release rather than
    // shipping code against an unmigrated database. This is why `prisma` is a
    // runtime dependency in apps/api/package.json.
    preDeploy: 'npx prisma migrate deploy --schema apps/api/prisma/schema.prisma',
    replicas: { ams: 1 },
    env: {
      NODE_ENV: 'production',
      // Typed reference to the Postgres service, not a pasted connection
      // string: a credential rotation follows the reference automatically.
      DATABASE_URL: Postgres.env.DATABASE_URL,
      WEB_ORIGIN: 'https://${{web.RAILWAY_PUBLIC_DOMAIN}}',
      AUTH_SESSION_COOKIE_NAME: 'auth_session',
      // Secrets are never inlined here. preserve() keeps whatever value
      // Railway already holds; set it once in the dashboard.
      AUTH_SESSION_SECRET: preserve(),
    },
  });

  const web = service('web', {
    source: github('BUSOLA12/portfolio-lms', { checkSuites: false }),
    build: 'npm run build --workspace @platform/web',
    start: 'npm run start --workspace @platform/web',
    replicas: { ams: 1 },
    env: {
      NODE_ENV: 'production',
      // Read by the browser, so this must be the public origin including the
      // scheme. A typed api.env.RAILWAY_PUBLIC_DOMAIN reference would yield a
      // bare hostname with no https://, which is not what the app expects.
      NEXT_PUBLIC_API_URL: 'https://${{api.RAILWAY_PUBLIC_DOMAIN}}',
      NEXT_PUBLIC_SITE_URL: 'https://${{web.RAILWAY_PUBLIC_DOMAIN}}',
    },
  });

  return project('confident-light', {
    resources: [api, web, Postgres, postgresVolume],
  });
});
