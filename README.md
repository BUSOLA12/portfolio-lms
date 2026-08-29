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

### Infrastructure as Code, not config files

The whole project is described in one file:

```txt
.railway/railway.ts
```

Config as Code (`railway.json` / `railway.toml`) is **deprecated**. New services
cannot opt into it, and existing files stop being read on **2026-12-01**. Neither
of our services uses it, and the two `railway.json` files that briefly existed
here have been deleted.

That file is the single source of truth for the environment: one project
definition, one apply, and **omit means delete**. Removing a resource from it and
applying will remove it from Railway.

| Command                | Effect                                              |
| ---------------------- | --------------------------------------------------- |
| `railway config plan`  | Preview the diff. Read-only, never changes Railway. |
| `railway config apply` | Apply after confirmation. `--yes` skips the prompt. |
| `railway config pull`  | Re-import live state into the file.                 |

Deleting a service or a variable is a destructive change, and non-interactively
it additionally requires `--confirm-destructive`, so a stray `--yes` cannot
remove infrastructure on its own.

**Check which environment you are planning against.** The project has both
`production` and `development`, and `plan` targets whichever is linked —
`railway status` names it. Applying against the wrong one creates a second copy
of both services.

### Toolchain requirement: `nodejs-current`

The Railway CLI evaluates `.railway/railway.ts` as TypeScript. Alpine's default
`nodejs` package cannot run it — **`nodejs-current` is required**. Do not
downgrade it; `railway config plan` stops working if you do.

The CLI must also be **5.42.1 or newer**; older versions use a retired engine and
refuse to run.

### Why both services build from the repository root

This is a workspace root, not a bare application, so Railway cannot infer either
service. **Neither service sets `rootDirectory`** — both build from the
repository root, which is what lets one install resolve `@platform/schemas` for
both. Scoping a service to `apps/api` or `apps/web` would break the shared
package. This is the one-time price of the monorepo.

| Service | Build                                                    | Start                                     |
| ------- | -------------------------------------------------------- | ----------------------------------------- |
| `api`   | `npm install && npm run build --workspace @platform/api` | `npm run start --workspace @platform/api` |
| `web`   | `npm run build --workspace @platform/web`                | `npm run start --workspace @platform/web` |

The API's build script is `prisma generate`. It is not optional: the generated
client is written to `apps/api/prisma/generated/`, which is gitignored, so a
fresh clone has none and `src/db/client.js` cannot import it. Without it the
service builds green and then crashes on boot.

The API also carries a healthcheck on `/health`, so a deploy that boots but
cannot serve is caught rather than left running.

### Why `prisma` is a runtime dependency

`prisma` sits in `dependencies` in `apps/api/package.json`, not
`devDependencies`. **Do not move it back.**

The API runs `prisma migrate deploy` as a pre-deploy command. Pre-deploy runs
between build and deploy, in a separate container, from the application image —
and Railway requires that such a command "has the dependencies it needs to run
installed in the application image". Railway does not install `devDependencies`
in production, so from `devDependencies` the `prisma` binary is simply absent and
the step fails **with empty logs**, which is a miserable thing to debug.

`@prisma/client` is the runtime library; `prisma` is the CLI that runs
migrations and `generate`. Both are needed at runtime here.

### Migrations run on deploy

The API's pre-deploy command is:

```
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
```

If it exits non-zero **the deployment does not proceed and is not retried**, so a
failed migration stops the release rather than shipping code against an
unmigrated database. Pre-deploy has no time limit by default; set a Pre-deploy
Timeout on the service if a migration could hang. Note that pre-deploy runs in a
separate container with no volume mounted, so it must not touch the filesystem.

### Environment variables

Variables are declared in `.railway/railway.ts`, not set by hand in the
dashboard. Neither app reads a `.env` file in production — the API's start script
uses `--env-file-if-exists`, a no-op when the file is absent.

| Service | Variable                   | Source                                   |
| ------- | -------------------------- | ---------------------------------------- |
| `api`   | `DATABASE_URL`             | Typed reference to the Postgres service  |
| `api`   | `NODE_ENV`                 | `production`                             |
| `api`   | `WEB_ORIGIN`               | The web service's public domain          |
| `api`   | `AUTH_SESSION_COOKIE_NAME` | `auth_session`                           |
| `api`   | `AUTH_SESSION_SECRET`      | `preserve()` — set once in the dashboard |
| `web`   | `NEXT_PUBLIC_API_URL`      | The api service's public domain          |
| `web`   | `NEXT_PUBLIC_SITE_URL`     | The web service's public domain          |

`PORT` is supplied by Railway. Do not set it.

`DATABASE_URL` is a **typed reference** (`Postgres.env.DATABASE_URL`), not a
pasted connection string, so a credential rotation follows the reference
automatically.

**Secrets are never inlined in the file.** `AUTH_SESSION_SECRET` uses
`preserve()`, which keeps whatever value Railway already holds. Set it once in
the dashboard:

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

The email and payment variables in `apps/api/.env.example` stay unset: the
provider and gateway are still undecided, and each is annotated with the step
that resolves it.

### Two things deliberately left open

**Cookie domain.** `AUTH_COOKIE_DOMAIN` is unset because whether the API sits on
a subdomain of the web app (simpler cookies) or a separate domain (CORS) is still
undecided — see "Still undecided" in `CLAUDE.md`. Railway's generated
`*.up.railway.app` URLs put the two services on unrelated subdomains, so cookies
will not be shared until custom domains are set. That does not block deployment;
it blocks step 1.8.

**Public domains.** Neither service declares a domain, so the
`RAILWAY_PUBLIC_DOMAIN` references in `WEB_ORIGIN`, `NEXT_PUBLIC_API_URL` and
`NEXT_PUBLIC_SITE_URL` resolve only once a domain exists for that service.
Generate one per service after the first apply, or add `domains` to the file when
the real hostnames are decided.
