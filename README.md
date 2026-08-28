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

| Command                | Effect                        |
| ---------------------- | ----------------------------- |
| `npm run lint`         | ESLint across every workspace |
| `npm run lint:fix`     | ESLint with autofix           |
| `npm run format`       | Prettier write                |
| `npm run format:check` | Prettier check, no writes     |

Development and build commands arrive with the applications themselves, in
steps 0.2 and 0.4.

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

Railway, two services plus a managed Postgres. Because this is a workspace root
rather than a bare application, each Railway service keeps its root directory at
the repository root and targets its workspace through the build and start
commands. Configured in step 0.5.
