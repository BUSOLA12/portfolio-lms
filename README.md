# Portfolio + LMS

A portfolio website with an integrated LMS module. Two audiences — **clients**
on the software services side and **learners** on the training side — kept as
separate journeys throughout.

## Authority

`CLAUDE.md` at the repository root is authoritative. Where it disagrees with any
other document, it wins. Read it before writing code.

Supporting documents, which `CLAUDE.md` supersedes on conflict:

- Product Concept Brief v1.1 — concept, domain model, roles, flows
- Technical Architecture v1.1 — frontend, backend, database, hosting
- `design-system.html` — visual reference, added in step 0.4
- `tokens.css` / `tokens.json` — design tokens, added in step 0.4

## Layout

```
apps/api          Standalone Express API. Owns the database, the cron
                  scheduler, and payment webhooks.
apps/web          Next.js App Router. Route groups: (marketing), (app), (admin).
packages/schemas  Zod schemas imported by both tiers, so validation cannot
                  drift between the form and the endpoint it posts to.
```

The API is separate from Next rather than living in route handlers because
dunning, expiry sweeps, and class session reminders need a persistent cron
process — and because the v2 mobile application will consume the same API.

## Prerequisites

- Node 22 or later (`.nvmrc` pins the major version)
- PostgreSQL 15 or later for local development

## Setup

```
git clone <repo>
cd portfolio-lms
npm install
```

One install at the root covers all three workspaces.

Then copy the environment templates:

```
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
```

Several values are intentionally blank. They correspond to decisions not yet
made — the email provider, the payment gateway, and the cookie domain. Each is
noted in the template alongside the step that resolves it.

## Commands

| Command                                   | Effect                                               |
| ----------------------------------------- | ---------------------------------------------------- |
| `npm run lint`                            | ESLint across every workspace, then the CSS guard    |
| `npm run lint:js`                         | ESLint only                                          |
| `npm run lint:css`                        | Stylelint only — the primitive guard                 |
| `npm run lint:fix`                        | Both linters with autofix                            |
| `npm run format`                          | Prettier write                                       |
| `npm run format:check`                    | Prettier check, no writes                            |
| `npm run dev --workspace @platform/api`   | Start the API in watch mode on `PORT` (default 4000) |
| `npm run start --workspace @platform/api` | Start the API without watch                          |
| `npm run dev --workspace @platform/web`   | Start Next.js in development on port 3000            |
| `npm run build --workspace @platform/web` | Production build of the web app                      |

The API loads `apps/api/.env` if present (`--env-file-if-exists`), so it runs
without one.

## Design tokens

`apps/web/styles/tokens.css` is a verbatim copy of `docs/tokens.css` and is the
single source of truth for colour, type and spacing. It is imported once, by
`apps/web/app/globals.css`, and is listed in `.prettierignore` so tooling never
rewrites it.

Components reference **semantic** tokens (`--action-primary-bg`), never
primitives (`--green-600`). `npm run lint:css` enforces this across
`apps/web/app/**` and `apps/web/components/**`; `tokens.css` itself is exempt,
since primitives legitimately live there.

Fonts are self-hosted subsets in `apps/web/public/fonts/`, each cut to exactly
the `unicode-range` its `@font-face` declares — which includes U+20A6, the naira
sign. All three are OFL; the licences sit beside them.

## Conventions

Naming rules that are load-bearing rather than stylistic:

- A **class session** is a scheduled live class. Table: `class_sessions`.
- An **auth session** is a login session. Table: `auth_sessions`.
- Nothing is ever named `session` unqualified — not a table, not a variable,
  not a route.
- Learners enroll into **cohorts**, never into courses.
- A **purchase** links a learner to a course and owns the money. An
  **enrollment** links a learner to a cohort and references a purchase.
- Enrollment statuses are `pending`, `enrolled`, `suspended`, `completed`,
  `expired`, `deferred`. Never `active` — that word belongs to the design
  system's visual state vocabulary and means something different.
- Money is integers in kobo. `amount_kobo`, `price_kobo`, `total_kobo`.

The full terminology table is in `CLAUDE.md`.

## Build order

Ten stages, defined in `CLAUDE.md`, preceded by a foundation stage. Payments
precede content deliberately: the entitlement model everything downstream rests
on is established there.

## Deployment

Railway, two services plus a managed Postgres, all in one project, deploying on
push to `main`.

### Why both services look unusual

This is a workspace root, not a bare application, so Railway cannot infer either
service. Both keep **Root Directory at the repository root** — not at
`apps/api` or `apps/web` — and name their workspace explicitly in the build and
start commands. That is what lets one `npm ci` at the root resolve
`@platform/schemas` for both. It is the one-time price of the monorepo.

Each service's settings live in a tracked file rather than only in the
dashboard, so the deployment shape can be reviewed in a diff:

| Service | Config path             |
| ------- | ----------------------- |
| API     | `apps/api/railway.json` |
| Web     | `apps/web/railway.json` |

In Railway, set each service's **Config-as-code** path to its file. Everything
below is already in those files — repeated here so the intent is readable
without opening JSON.

| Service | Build command                                                          | Start command                             |
| ------- | ---------------------------------------------------------------------- | ----------------------------------------- |
| API     | `npm ci && npx prisma generate --schema apps/api/prisma/schema.prisma` | `npm run start --workspace @platform/api` |
| Web     | `npm ci && npm run build --workspace @platform/web`                    | `npm run start --workspace @platform/web` |

The API's `prisma generate` is not optional. The generated client is written to
`apps/api/prisma/generated/`, which is gitignored, so a fresh clone has no
client and `src/db/client.js` fails to import. Without that step the service
builds cleanly and then crashes on boot.

The API service also carries a healthcheck on `/health`, so a deploy that boots
but cannot serve is rolled back rather than left running.

### Environment variables

Set these per service in Railway. Neither app reads a `.env` file in
production — the API's start script uses `--env-file-if-exists`, which is a
no-op when the file is absent.

**API service**

| Variable                   | Value                                                                                       |
| -------------------------- | ------------------------------------------------------------------------------------------- |
| `DATABASE_URL`             | `${{Postgres.DATABASE_URL}}` — a reference, not a pasted string                             |
| `NODE_ENV`                 | `production`                                                                                |
| `PORT`                     | Supplied by Railway. Do not set it.                                                         |
| `WEB_ORIGIN`               | The web service's public URL                                                                |
| `AUTH_SESSION_SECRET`      | 32 random bytes: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `AUTH_SESSION_COOKIE_NAME` | `auth_session`                                                                              |
| `AUTH_COOKIE_DOMAIN`       | Leave blank — see below                                                                     |

**Web service**

| Variable               | Value                        |
| ---------------------- | ---------------------------- |
| `NEXT_PUBLIC_API_URL`  | The API service's public URL |
| `NEXT_PUBLIC_SITE_URL` | The web service's public URL |

Use Railway's `${{Postgres.DATABASE_URL}}` reference rather than pasting the
connection string, so a database credential rotation does not silently break the
API.

The email and payment variables in `apps/api/.env.example` stay unset: the
provider and gateway are still undecided, and each is annotated with the step
that resolves it.

### Two things deliberately left open

**Cookie domain.** `AUTH_COOKIE_DOMAIN` is blank because whether the API sits on
a subdomain of the web app (simpler cookies) or a separate domain (CORS) is
still undecided — see "Still undecided" in `CLAUDE.md`. Railway's generated
`*.up.railway.app` URLs put the two services on unrelated subdomains, which
means cookies will not be shared until custom domains are set. That does not
block deployment; it blocks step 1.8, and should be settled before then.

**Migrations do not run on deploy.** Nothing in the build or start command calls
`prisma migrate deploy`, so a new migration reaches the database only when run by
hand. That is correct for now — the initial migration is already applied — but it
is a trap the first time a migration is added in stage 1. Decide then whether it
belongs in the build command, a pre-deploy command, or stays a deliberate manual
step. It is called out here so it is not discovered by an outage.
