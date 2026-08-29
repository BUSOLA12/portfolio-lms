# Stepping-stone build plan

Portfolio + LMS. Derived from CLAUDE.md build order, expanded into implementable steps.

**Repo layout** — decided: one repository, npm workspaces.

```
/apps/api            @platform/api      Express — routes -> controllers -> services -> repositories
/apps/web            @platform/web      Next.js — (marketing) (app) (admin)
/packages/schemas    @platform/schemas  Zod schemas shared by both tiers
```

The `@platform/` scope avoids `@app/`, which would collide with the `(app)`
route group, and `@lms/`, which would name the marketing site after the training
side. Renaming it is a find-and-replace across four files.

All paths below assume this. Table names follow the architecture §4 plan.

Note on terminology in this document: `class session` always means a scheduled
live class, `auth session` always means a login session. Never `session` alone.

---

## Decisions taken

Recorded here so they are not re-argued. Each amends the relevant step below.

**D1. The payment component is `PaymentRail`. Its parts are the rail and its
knots.** "Stepper", "step", "node" and "connector" are retired from the project
vocabulary. CLAUDE.md decides the visual — vertical rail, knots as instalments —
and a component named `PaymentStepper` rendering a rail would make the code say
one thing while the screen says another, which is the drift the terminology
rules exist to prevent. The vertical line between knots stays unnamed: it is a
rendering detail of the rail, not a domain concept, and design-system.html
implements it without naming it. Amend the brief's terminology table at v1.2.

Instalment vocabulary splits in two, and the halves never mix. The **column**
stores only the payment fact (see D7). The **visual** state is
`done · active · locked · overdue`. The mapping between them lives once, in the
payment view service at step 3.4, server-derived — never in a component, never
in the browser.

**D2. The shared component layer is called `elements`.** Layers are tokens →
elements → composites → features. "Primitive" belongs to raw token values and
cannot be borrowed, because CLAUDE.md's rule "components never reference a
primitive" is authoritative and depends on that meaning.

Elements live in `apps/web/components/elements/` — Button, Input, Select, Field,
Card, Badge, Modal, Table, Toast, Rail. Everything above them is organised by
feature, per architecture §2.3: `components/payments/`, `components/lms/`,
`components/guardian/`, `components/marketing/`, `components/admin/`.

`Rail` is an element, not a composite: it carries the motif and no domain
knowledge, and three unrelated features consume it — tranche progress, the
portfolio project timeline, and the payment schedule. `PaymentRail` is the
composite that feeds instalments into it.

**D3. `--state-overdue-rail` is added to `tokens.css`.** Light
`var(--red-600)`, dark `#E88A78`. tokens.json has declared this token since
1.1.0 and tokens.css never received it, so this closes an existing drift between
the two files rather than inventing a token. Without it there is no legal way to
render an overdue knot, since components may not reach for `--red-600` directly.
Applied at step 0.4, when tokens.css enters the repository.

**D4. A class session's visual state comes from entitlement and schedule, never
from watch progress.** The four states attach at two different levels:

| Level         | State     | Meaning                                           |
| ------------- | --------- | ------------------------------------------------- |
| Tranche       | `locked`  | Instalment not paid                               |
| Tranche       | `overdue` | Instalment past due, or enrollment suspended      |
| Tranche       | `active`  | Paid, and the cohort is currently inside it       |
| Tranche       | `done`    | Paid, and every class session in it has been held |
| Class session | `done`    | Entitled, and the class has been held             |
| Class session | `active`  | Entitled, and it is live or the next one up       |
| Class session | `locked`  | In an unpaid tranche                              |

A paid, future class session that is not next up carries **no badge** — a date
and a title only. That is not a fifth state; it is the absence of one. The
alternative, marking the whole current tranche `active`, would put nine ochre
cards on one screen and break the one-ochre-per-region rule outright.

This is the most interpretive of the four decisions, because it reads intent
into the four-state rule rather than applying a written one. Overrule it if the
reading is wrong.

---

## Decisions taken — enum values and storage shape

These are engineering calls, made on the same principle CLAUDE.md applies to
tranche unlock: **store facts, derive everything a clock or a count can
answer.** None of them touches business policy.

**D5. `users.status` is `pending · enabled · suspended`.**
`pending` is an unclaimed stub — a guardian account created on someone's behalf
with no password set. `enabled` can log in. `suspended` is an admin-disabled
account, reusing the project's preferred word for reversible removal of access.

Not `active`, deliberately: that word belongs to the visual state vocabulary,
and the same reasoning that made enrollments use `enrolled` applies here.
Email verification is _not_ a status — `email_verified_at` already carries it,
and folding it in would make one column answer two unrelated questions.

**D6. `attendance.status` is `present · absent · late`.**
An unmarked class session has no attendance row at all, so there is no
`unmarked` value. "Excused" is deliberately absent: it encodes a policy about
what counts as a valid reason, which is yours to set, not mine. Add it when you
have that policy.

**D7. `instalments.status` stores `unpaid · paid · cancelled`. `due`,
`upcoming` and `overdue` are derived, never stored.**
`paid` is a fact, written inside the same database transaction as the
settlement — that is its moment of truth, and storing it is correct. The other
three are pure functions of `due_on` against `now()`. Storing them would need a
cron job to flip them, and between runs the column would lie. This is the
tranche-unlock argument applied to the same problem one table over.

The architecture's `instalments (due_on, status)` index still earns its place:
the dunning and overdue sweeps scan for `unpaid` rows within a date window.

**D8. One `one_time_tokens` table serves all three single-use flows.**
Columns: `id, user_id, purpose, token_hash, expires_at, consumed_at,
created_at`, unique on `token_hash`. `purpose` is
`guardian_invitation · email_verification · password_reset`.

Three near-identical mechanisms — invitation, verification, reset — would
otherwise be built three times and diverge on the fourth. The shape mirrors
`auth_sessions`, which already proves it in this codebase: hash at rest, expiry,
and a consumed marker rather than a delete.

**D9. `resources.kind` is `recording · slides · code · reading`.**
Exactly the four the architecture names in §4.2. No speculative fifth value.

**D10. `cohorts.status` is `draft · open · running · completed`.**
`draft` is not publicly visible. `open` accepts enrollment. `running` has
started. `completed` has held its final class session.

Capacity-full is **not** a status. It is `count(enrollments) >= capacity`,
computed at read time — same reasoning as D7. A stored full flag drifts the
moment someone defers out of a cohort.

**D11. Resubmission updates the submission row in place.**
The unique constraint on `submissions (assignment_id, user_id)` in architecture
§4.8 already assumes this, and §8 says updating in place is sufficient unless
the history of attempts is wanted. It isn't yet. If it becomes wanted, an
attempts table is an additive migration, not a rewrite. Unblocks step 6.1.

**D12. Watch progress stores seconds; completion is derived from them.**
`watched_seconds` accumulates from the IFrame Player. A class session counts as
watched at 90% of `duration_minutes`, computed. `completed_at` is stamped once
when that threshold is first crossed and never unset — like `paid`, it is a fact
about a moment, not a rolling calculation.

Storing seconds keeps both readings of "progress" available at no extra cost:
percentage watched for the learner's own view, completed-count for the guardian
summary. Unblocks step 5.7.

**D13. The primitive guard bans colour and shape primitives only.** Spacing and
type primitives are exempt: `--space-5` and `--size-lg` are already the semantic
names for their steps, and tokens.css publishes no layer above them. Banning
them left compliant components with no legal way to reference either scale. The
rule the design system actually states is about colour, which is what a rebrand
touches.

The banned list is therefore `--green-*`, `--ochre-*`, `--slate-*`, `--red-*`,
`--paper*`, `--line*`, `--white`, `--success`, `--success-soft`, `--shadow-*`,
`--radius-*`, `--border-hair`, `--border-firm`. The `--border-*` namespace is
split deliberately: `--border-default`, `--border-subtle`, `--border-strong` and
`--border-focus` are semantic and stay legal. Enforced by `stylelint.config.js`
across `apps/web/app/**` and `apps/web/components/**`; tokens.css is exempt.

**D14. Radius and shadow get a semantic layer, not an exemption.** Unlike
spacing and type, `--radius-md` is not already the semantic name for its job,
and both radius and elevation change in a rebrand. Eight tokens added:
`--surface-radius`, `--surface-radius-sm`, `--surface-radius-lg`,
`--control-radius`, `--pill-radius`, `--elevation-raised`,
`--elevation-floating`, `--elevation-overlay`. The primitive guard is unchanged
and still bans `--radius-*` and `--shadow-*` in components.

Added to tokens.css at v1.4 and tokens.json at 1.4.0. The elevation aliases
carry no dark-mode override: the shadow primitives are already redefined under
`[data-theme="dark"]`, and a custom property resolves at the point of use, so
`--elevation-raised` picks up the dark shadow on its own. Redeclaring them would
be the drift D3 was written to close.

---

## Stage 0 — Foundation

**Not in the CLAUDE.md build order.** Stage 1 cannot run without it. Raised
rather than assumed; say if you want it folded into stage 1 instead.

### 0.1 Workspace and repository skeleton — **DONE**

- **Builds:** monorepo root with npm workspaces, shared lint/format config, `.env.example` per app, `.gitignore`, and `CLAUDE.md` placed at the repository root so Claude Code reads it on every session.
- **Files:** `package.json`, `package-lock.json`, `.gitignore`, `.prettierrc`, `.prettierignore`, `.editorconfig`, `.nvmrc`, `eslint.config.js`, `README.md`, `CLAUDE.md`, `apps/api/package.json`, `apps/api/.env.example`, `apps/web/package.json`, `apps/web/.env.example`, `packages/schemas/package.json`, `packages/schemas/index.js`.
- **Tables:** none.
- **Done when:** `git clone` plus one install command produces a working tree on your Android setup; both app directories exist and are empty shells. **Verified:** workspaces link, `npm run lint` and `npm run format:check` both pass clean.
- **Depends on:** nothing.
- **Decided during the step:** scope is `@platform/`; `CLAUDE.md` and `tokens.css` are in `.prettierignore` so tooling never rewrites the authoritative documents; no `dev` scripts until 0.2 and 0.4 give them something to run. The API `.env.example` carries commented blanks for the email provider, payment gateway and cookie domain, each naming the step that resolves it.

### 0.2 Express API skeleton — **DONE**

- **Builds:** Express app with the routes → controllers → services → repositories directory structure, JSON body parsing, request logging, error-handling middleware, `/health` endpoint, graceful shutdown.
- **Files:** `apps/api/src/app.js`, `apps/api/src/server.js`, `apps/api/src/routes/index.js`, `apps/api/src/middleware/error.js`, `apps/api/src/middleware/logger.js`. Changed `apps/api/package.json` (added `express` dependency, first `dev` and `start` scripts), `package-lock.json`, and the root `README.md` command table.
- **Tables:** none.
- **Done when:** `GET /health` returns 200 locally, and a thrown error in a controller produces a structured JSON error rather than a stack trace.
- **Depends on:** 0.1.
- **Verified:** `GET /health` returns `200 {"status":"ok"}` over HTTP; an unknown route returns a structured `404` JSON body; a thrown handler error (sync and async, tested with temporary routes then reverted) returns `500 {"error":{"status":500,"message":"Internal Server Error"}}` with the stack trace going to server logs only; `SIGTERM` triggers graceful shutdown. `npm run lint` passes clean. `npm run format:check` reports only 6 pre-existing `docs/*` files (introduced by the earlier `docs: v1.2 specifications` commit, confirmed by stashing this step's changes); the `README.md` edit passes.
- **Decided during the step:** Express 5 (`^5.1.0`), so async handler rejections reach the error middleware without a wrapper. Request logging is a dependency-free custom middleware, not `morgan`. Env loading uses `node --env-file-if-exists=.env` rather than a `dotenv` dependency, so the API runs with no `.env` present. A `notFoundHandler` was added to `middleware/error.js` — same concern as the error handler: an API path that would otherwise return Express's default HTML. `controllers/`, `services/` and `repositories/` directories are not created yet; they arrive with their first real file in later steps.

### 0.3 Prisma initialisation and database conventions — **DONE**

- **Builds:** Prisma installed, datasource configured, an initial migration, plus the project-wide conventions encoded once — UUID v7 default for public ids, `timestamptz` for every timestamp, kobo integers.
- **Files:** `apps/api/prisma/schema.prisma`, `apps/api/prisma/migrations/migration_lock.toml`, `apps/api/prisma/migrations/20260828160000_init/migration.sql`, `apps/api/src/db/client.js`. Changed `apps/api/package.json` (added `prisma` and `@prisma/client`) and `package-lock.json` — not in the original Files list, but "Prisma installed" requires it. Generated client output is `apps/api/prisma/generated/` (gitignored).
- **Tables:** `scratch_probe` — transitional, exists only to prove the conventions against a real database; step 1.1 removes it. No domain tables.
- **Done when:** a migration runs against a local Postgres and `prisma migrate status` is clean; a scratch model demonstrates a UUID v7 default and a `timestamptz` column.
- **Depends on:** 0.1.
- **Verified:** against the Railway Postgres. `prisma validate` passes; `prisma generate` succeeds and `src/db/client.js` imports `PrismaClient` cleanly under ESM. `prisma migrate status` reports "Database schema is up to date!" with the one migration applied. On that database: `uuid_generate_v7()` exists; `scratch_probe.id` is `uuid` defaulting to `uuid_generate_v7()`; `scratch_probe.created_at` is `timestamp with time zone` defaulting to `CURRENT_TIMESTAMP`; rows inserted with defaults get valid UUID v7 ids (version nibble `7`, variant bits `10`), time-ordered across inserts, and `created_at` round-trips as a timezone-aware value. Probe rows inserted for the check were deleted afterward. `npm run lint` clean; `npm run format:check` unchanged (only the 6 pre-existing `docs/*` files).
- **Decided during the step:** the initial migration carries the `uuid_generate_v7()` function plus a committed `scratch_probe` table/model, rather than being literally empty, because the done-when requires a scratch model to demonstrate against — 1.1 deletes it. Postgres has no native `uuidv7()` before v18, so `uuid_generate_v7()` is defined in SQL (millisecond timestamp from `clock_timestamp()`, randomness from core `gen_random_uuid()`, version/variant bits stamped); compatible with Postgres 15–18. Prisma is 6.19.3 with the `prisma-client-js` generator and `output = "./generated"` (matching the ignore entries from 0.1). Models will use `@default(dbgenerated("uuid_generate_v7()")) @db.Uuid` for public ids and `@db.Timestamptz(6)` for timestamps. Prisma's dependency tree carries 3 high-severity npm audit advisories; `npm audit fix` was not run.

### 0.4 Next.js skeleton, route groups, tokens and fonts — **DONE**

- **Builds:** Next.js App Router project with `(marketing)`, `(app)`, `(admin)` route groups each carrying its own layout; `tokens.css` imported once at the root; self-hosted subset fonts.
- **Files:** `apps/web/app/layout.js`, `apps/web/app/(marketing)/layout.js`, `apps/web/app/(app)/layout.js`, `apps/web/app/(admin)/layout.js`, `apps/web/app/globals.css`, `apps/web/styles/tokens.css` (copied verbatim from `docs/tokens.css`, verified byte-identical), `apps/web/next.config.js`, `stylelint.config.js`. Fonts: `apps/web/public/fonts/bricolage-grotesque-latin.woff2`, `public-sans-latin.woff2`, `source-code-pro-latin.woff2`, plus `OFL-BricolageGrotesque.txt`, `OFL-PublicSans.txt`, `OFL-SourceCodePro.txt` — the licences are required alongside redistributed OFL fonts, so they are not optional. Three provisional pages were also needed, because route groups add no URL segment and the done-when requires three routes to _render_: `apps/web/app/(marketing)/page.js` (`/`), `apps/web/app/(app)/dashboard/page.js` (`/dashboard`), `apps/web/app/(admin)/admin/page.js` (`/admin`); each names the step that replaces it. Changed `apps/web/package.json` (`dev`/`build`/`start`), the root `package.json` (lint now runs ESLint then stylelint; added `lint:js` and `lint:css`), `package-lock.json`, and `README.md` (command table, plus a design-tokens section).
- **Also builds — the primitive guard.** A stylelint rule refusing colour and shape primitives inside `apps/web/components/**` and `apps/web/app/**`: `--green-*`, `--ochre-*`, `--slate-*`, `--red-*`, `--paper*`, `--line*`, `--white`, `--success`, `--success-soft`, `--shadow-*`, `--radius-*`, `--border-hair`, `--border-firm`. `tokens.css` itself is exempt, since that is where primitives legitimately live. Considered for 0.1 and deferred here, because there is no CSS to lint until this step. **Per D13:** `--size-*` and `--space-*` are _not_ banned — they are already the semantic names for their steps, and banning them left components with no legal way to reference either scale. The semantic `--border-default`, `--border-subtle`, `--border-strong` and `--border-focus` stay legal; only `--border-hair` and `--border-firm` are primitives.
- **Tables:** none.
- **Done when:** three routes render, each with its own layout; a naira sign renders in Public Sans without falling back; DevTools shows the semantic custom properties resolving; a deliberately planted `var(--green-600)` in a component fails the lint run; and a deliberately planted `var(--space-5)` in a component passes it.
- **Depends on:** 0.1. The three subset `.woff2` files were cut during this step rather than supplied — see below. Per D3, `--state-overdue-rail` is in `tokens.css` as it enters the repository: light `var(--red-600)`, dark `#E88A78`. It arrived with the v1.2 document, so no amendment was needed.
- **Verified:** `next build` compiles clean and prerenders `/`, `/dashboard` and `/admin` as static; the emitted HTML carries `data-route-group="marketing"`, `"app"` and `"admin"` respectively, confirming each group's own layout wrapped its route. Compiled CSS resolves the semantic layer — `--bg-page:var(--paper)`, `--text-primary:var(--green-950)`, `--action-primary-bg:var(--green-600)`, `--state-overdue-rail:var(--red-600)` — and the shape layer from D14, with `--elevation-raised` picking up the dark shadow through the primitive and no duplicate declaration in the dark block. The guard was exercised in both directions: a planted `var(--green-600)`, `var(--radius-md)` and `var(--shadow-sm)` each failed with exit 2; planted `var(--space-5)`, `var(--size-lg)`, `var(--surface-radius)`, `var(--elevation-raised)`, `var(--border-default)` and `var(--measure)` all passed. Probes removed, exit back to 0. `npm run lint` (ESLint + stylelint) exits 0. `npm run format:check` reports only the pre-existing `docs/*` files; every file this step touched passes.
- **Not verified in a browser.** `next start` cannot run in this environment — the sandbox denies `os.networkInterfaces()` with errno 13 — so "DevTools shows the properties resolving" and the naira rendering were confirmed from the compiled CSS and the font binaries instead. The naira claim rests on reading the `cmap` table of the shipped `public-sans-latin.woff2`, which contains U+20A6; worth one look on a real device at 0.5.
- **Decided during the step — fonts.** All three faces were cut here from upstream OFL sources rather than supplied: Public Sans and Bricolage Grotesque from `google/fonts`, Source Code Pro from the same. Each is subset to exactly the `unicode-range` its `@font-face` declares and clamped to the weight range it declares — 23.1KB, 43.8KB and 22.1KB, 89KB total. Google's stock `latin` subset was not usable: its range carries U+20AC but not U+20A6, so a drop-in file would have failed the naira condition outright. Note for later: Source Code Pro carries a Reserved Font Name ('Source'), unlike the other two; serving a subset under the original name is what Google Fonts itself does, but it is a licence detail worth knowing.
- **Decided during the step — the mono changed.** JetBrains Mono has no U+20A6 in any release, including JetBrains' own v2.304, while `tokens.css` declared U+20A6 in its mono `unicode-range`. Since mono carries the numbers and the numbers are money, every amount set in mono drew its ₦ from a fallback font mid-string. Replaced with Source Code Pro across all three documents that named it — `tokens.css` (v1.3), `tokens.json` (1.3.0) and `design-system.html`, including its prose. Recorded there rather than as a numbered decision because it corrects a factual error rather than settling a choice.
- **Decided during the step — Next 16.** `next@16.3.3` with React 19.2.8. Next 16 removed the `eslint` key from `next.config.js`, so linting is not configured there; the repository root runs one ESLint pass across every workspace instead. The root `lint` script now chains stylelint after ESLint so a single command covers both.
- **Raised during the step, settled by you:** the guard's original ban list included `--size-*` and `--space-*`, which left components with no legal way to reference either scale — now D13. `--radius-*` and `--shadow-*` had the same gap with a different answer — now D14. Step 2.7's `(admin)/page.js` collided with step 9.2's `(marketing)/page.js` over `/`; corrected in 2.7, and this step's provisional admin page already sits at `/admin`.

### 0.5 Deployment to Railway — **DONE**

- **Builds:** two Railway services plus the managed Postgres, environment variables wired, deploy on push from git.
- **Files:** `.railway/railway.ts` — Infrastructure as Code, one file describing the whole project. `.railway/README.md` was written by `railway config init`. Deploy notes rewritten in `README.md`. Changed `apps/api/package.json`: `prisma` moved from `devDependencies` to `dependencies`, a `"//dependencies"` key recording why, and a `build` script running `prisma generate`. Added `railway` to the root `package.json`. **Deleted** `apps/api/railway.json` and `apps/web/railway.json`.
- **Tables:** none.
- **Done when:** pushing to main deploys both services; the deployed API's `/health` responds; the deployed web app renders; the API connects to the managed database.
- **Depends on:** 0.2, 0.3, 0.4.
- **Workspace cost, paid here.** Because this is a workspace root rather than a bare Node app, Railway cannot infer either service. Each keeps its root directory at the repository root and targets its workspace explicitly through the build and start commands, so the install resolves `@platform/schemas` for both. This is the one-time price of the monorepo; nothing after this step pays it again.
- **Verified against the live deployment**, all four clauses. Commit `a1a1cfd` is pushed and `origin/main` is clean. Both services report `● Online`. `GET https://api-development-939a.up.railway.app/health` returns `HTTP/2 200` with `{"status":"ok"}`, and an unknown route returns the structured `{"error":{"status":404,...}}` rather than a stack trace. The web app returns 200 and renders all three route groups — `/` carries `data-route-group="marketing"`, `/dashboard` `"app"`, `/admin` `"admin"` — with the naira amounts and the subset fonts present in the served HTML. Database connectivity is proven by the pre-deploy log: `Prisma schema loaded from apps/api/prisma/schema.prisma` / `1 migration found in prisma/migrations` / `No pending migrations to apply.` followed by `API listening on port 8080`. Prisma had to reach Postgres and read `_prisma_migrations` to know nothing was pending, so the API demonstrably connects to the managed database. `npm run lint` exits 0.
- **Verified in `development`, not `production`.** The project has both environments; `development` is forked from `production` and is the one linked. Production currently holds only the Postgres — it has no `api` or `web` service. Deploying there is a separate apply against that environment.
- **Config as Code is gone.** Railway deprecated `railway.json` / `railway.toml`: new services cannot opt into it and existing files stop being read on **2026-12-01**. The two `railway.json` files written earlier in this step targeted that dead format and were deleted before anything was applied. A service cannot be managed by both systems at once.
- **Decided during the step — `prisma` is a runtime dependency.** Moved out of `devDependencies` and pinned there with a `"//dependencies"` note, because Railway does not install `devDependencies` in production and the pre-deploy container runs from the application image. Railway's own requirement is that a pre-deploy command "has the dependencies it needs to run installed in the application image". From `devDependencies` the binary is simply absent and the step fails **with empty logs**. `@prisma/client` is the runtime library; `prisma` is the CLI that runs migrations and `generate`.
- **Decided during the step — migrations run as pre-deploy.** `npx prisma migrate deploy --schema apps/api/prisma/schema.prisma` runs between build and deploy. Per Railway's docs, if it exits non-zero "it will not be retried and the deployment will not proceed", so a failed migration stops the release rather than shipping code against an unmigrated database. This closes the gap flagged earlier in the step, when nothing ran migrations on deploy. Pre-deploy runs in a separate container with no volume mounted and has no time limit by default.
- **Decided during the step — neither service sets `rootDirectory`.** Both build from the repository root. The docs' own monorepo example scopes each service to its subdirectory, which would break this repo: a scoped install cannot resolve `@platform/schemas`. `build` and `start` name the workspace instead.
- **Decided during the step — `DATABASE_URL` is a typed reference**, `Postgres.env.DATABASE_URL`, so a credential rotation follows the reference rather than breaking a pasted string. `AUTH_SESSION_SECRET` uses `preserve()`; no secret is written into the file. The three public-domain variables (`WEB_ORIGIN`, `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SITE_URL`) use Railway's `${{service.RAILWAY_PUBLIC_DOMAIN}}` interpolation rather than typed references, because a typed reference yields a bare hostname with no scheme and these must be complete origins.
- **Open: the file and the live environment have drifted.** `railway config plan` reports `0 to add, 7 to change, 0 to destroy` — three `api` variables and two `web` variables unset live, plus two networking updates. All are the file moving Railway forward, so applying is additive. The one regression has been closed: the live `api` build command carries an explicit `npm install` that the file had dropped, and the file now matches. `prisma generate` needs the prisma CLI on disk, so that install is load-bearing — do not remove it.

---

## Stage 1 — Auth and accounts

### 1.1 Identity schema

- **Builds:** the three identity tables and their indexes.
- **Files:** `apps/api/prisma/schema.prisma`, new migration.
- **Tables:** `users`, `auth_sessions`, `guardianships` (unique on `guardian_id, learner_id`; indexes on `guardian_id` and on `learner_id`).
- **Done when:** the migration applies and the three tables exist with the columns from architecture §4.1.
- **Depends on:** 0.3.
- **Per D5:** `users.status` is `pending · enabled · suspended`.

### 1.2 Auth core services

- **Builds:** password hashing, auth-session token generation and hashing, cookie serialisation (httpOnly, secure, SameSite), token verification, revocation.
- **Files:** `apps/api/src/services/authSessionService.js`, `apps/api/src/services/passwordService.js`, `apps/api/src/repositories/authSessionRepository.js`, `apps/api/src/middleware/requireAuth.js`.
- **Tables:** `auth_sessions`, `users`.
- **Done when:** a unit test creates an auth session, resolves it from a cookie value, revokes it, and confirms the revoked token no longer resolves. The raw token never appears in the database.
- **Depends on:** 1.1.

### 1.3 Registration with the relationship field

- **Builds:** the registration endpoint accepting `relationship: self | guardian`, with the guardian branch validated conditionally; Zod schema shared with the web app.
- **Files:** `packages/schemas/registration.js`, `apps/api/src/routes/auth.js`, `apps/api/src/controllers/authController.js`, `apps/api/src/services/registrationService.js`.
- **Tables:** `users`.
- **Done when:** posting a `self` registration creates one user; posting a `guardian` registration without guardian fields is rejected with field-level errors.
- **Depends on:** 1.2.

### 1.4 Guardian stub accounts and invitation tokens

- **Builds:** stub user creation for the named guardian, a `guardianships` row linking them, and a single-use expiring invitation token.
- **Files:** `apps/api/src/services/guardianshipService.js`, `apps/api/src/services/invitationService.js`, `apps/api/src/repositories/guardianshipRepository.js`, migration for invitation token storage.
- **Tables:** `users`, `guardianships`, `one_time_tokens` (per D8 — one table, `purpose` = `guardian_invitation`).
- **Done when:** a guardian registration produces a pending stub user, a guardianship row, and a token that expires and cannot be reused.
- **Depends on:** 1.3.

### 1.5 Email provider abstraction and `email_log`

- **Builds:** one send interface behind a provider handler, templates directory, and the duplicate-send guard every later job depends on.
- **Files:** `apps/api/src/services/emailService.js`, `apps/api/src/services/providers/emailProvider.js`, `apps/api/src/emails/templates/`, `apps/api/src/repositories/emailLogRepository.js`, migration.
- **Tables:** `email_log` (index on `user_id, type, entity_ref`).
- **Done when:** a test send writes an `email_log` row, and a second send of the same type for the same entity is refused by the guard rather than by the provider.
- **Depends on:** 1.1. **Blocked on choosing Resend or Postmark.**

### 1.6 Invitation and verification emails

- **Builds:** the guardian invitation email and the learner email-verification email, both deep-linking into the web app.
- **Files:** `apps/api/src/emails/templates/guardianInvitation.js`, `apps/api/src/emails/templates/emailVerification.js`, wiring in `registrationService.js`.
- **Tables:** `email_log`, `users`.
- **Done when:** registering as a guardian-linked learner sends both emails, each recorded in `email_log`.
- **Depends on:** 1.4, 1.5.

### 1.7 Guardian claim flow

- **Builds:** token redemption endpoint that sets a password, activates the stub user, and burns the token.
- **Files:** `apps/api/src/routes/auth.js`, `apps/api/src/services/invitationService.js`, `packages/schemas/claim.js`.
- **Tables:** `users`, invitation tokens.
- **Done when:** the invitation link lets the guardian set a password once; replaying it fails; an expired token fails.
- **Depends on:** 1.6.

### 1.8 Login, logout, current user, password reset

- **Builds:** login issuing an auth session cookie, logout revoking it, a `/me` endpoint resolving role standing, and the password-reset request and completion pair.
- **Files:** `apps/api/src/routes/auth.js`, `apps/api/src/controllers/authController.js`, `apps/api/src/services/passwordResetService.js`, `apps/api/src/emails/templates/passwordReset.js`.
- **Tables:** `users`, `auth_sessions`, `email_log`.
- **Done when:** login sets the cookie; `/me` returns the user with `is_admin` and derived learner/guardian standing; logout makes the cookie useless immediately.
- **Depends on:** 1.7.

### 1.9 Rate limiting

- **Builds:** rate limits on registration, login, password reset, claim, and later the payment endpoints.
- **Files:** `apps/api/src/middleware/rateLimit.js`, applied in `apps/api/src/routes/auth.js`.
- **Tables:** none, unless the store is database-backed.
- **Done when:** repeated login attempts from one address are refused with 429 and the limit resets on schedule.
- **Depends on:** 1.8.

### 1.10 First shared elements

- **Builds:** the element layer stages 1–10 all reuse: Button, Input, Select, Field, Card, Badge, Toast. Semantic tokens only; 44px minimum touch targets; visible focus rings.
- **Files:** `apps/web/components/elements/Button/`, `Input/`, `Select/`, `Field/`, `Card/`, `Badge/`, `Toast/`, each with its `.module.css`.
- **Tables:** none.
- **Done when:** a scratch page renders all of them in light and dark, and the stylelint primitive guard from 0.4 passes across the whole directory.
- **Depends on:** 0.4.
- **Per D2:** this is the `elements` layer. `Rail` joins it at 3.5, when the first consumer exists.
- **Per D14 — the shape tokens these elements use.** Button, Input and Select take `--control-radius`. Card takes `--surface-radius` and `--elevation-raised`. Badge takes `--pill-radius`. Modal, when it arrives, takes `--surface-radius-lg` and `--elevation-overlay`; Toast takes `--surface-radius` and `--elevation-floating`. None of them may reach for `--radius-*` or `--shadow-*`, which the guard still refuses. Spacing and type come from `--space-*` and `--size-*` directly, per D13.

### 1.11 Auth screens

- **Builds:** registration with progressive disclosure of the guardian fields, login, email verification landing, guardian claim, password reset — all in `(app)` or an `(auth)` segment.
- **Files:** `apps/web/app/(app)/register/page.js`, `login/page.js`, `verify/page.js`, `claim/page.js`, `reset/page.js`, `apps/web/lib/api.js`, `apps/web/lib/queryClient.js`.
- **Tables:** none directly.
- **Done when:** you can register on a phone as a learner with a guardian, receive both emails, claim the guardian account, verify the learner, and log in as either.
- **Depends on:** 1.9, 1.10.

---

## Stage 2 — Courses, cohorts, class sessions, tranches

### 2.1 Catalogue schema

- **Builds:** the five catalogue tables and their indexes.
- **Files:** `apps/api/prisma/schema.prisma`, migration.
- **Tables:** `courses`, `cohorts`, `tranches`, `class_sessions` (index on `cohort_id, position`), `resources`.
- **Done when:** the migration applies; `class_sessions` is named that way from its first migration, never `sessions`.
- **Depends on:** 1.1.
- **Per D9 and D10:** `resources.kind` is `recording · slides · code · reading`; `cohorts.status` is `draft · open · running · completed`, with capacity-full computed rather than stored.

### 2.2 Admin authorisation

- **Builds:** middleware admitting only `is_admin` users, applied across the admin routers.
- **Files:** `apps/api/src/middleware/requireAdmin.js`.
- **Tables:** `users`.
- **Done when:** a learner's auth session receives 403 on every admin route; an admin passes.
- **Depends on:** 1.8.

### 2.3 Course management API

- **Builds:** create, update, list, publish and unpublish courses.
- **Files:** `apps/api/src/routes/admin/courses.js`, `apps/api/src/controllers/courseController.js`, `apps/api/src/services/courseService.js`, `apps/api/src/repositories/courseRepository.js`, `packages/schemas/course.js`.
- **Tables:** `courses`.
- **Done when:** an admin can create a course with a slug and `base_price_kobo`, and toggle `is_published`.
- **Depends on:** 2.1, 2.2.

### 2.4 Cohort management API

- **Builds:** cohorts under a course, with dates, capacity and `price_kobo`.
- **Files:** `apps/api/src/routes/admin/cohorts.js`, plus matching controller, service, repository, `packages/schemas/cohort.js`.
- **Tables:** `cohorts`.
- **Done when:** an admin can create a cohort with start and end dates and a capacity, and the API rejects a cohort on an unpublished course if you decide that's a rule.
- **Depends on:** 2.3.

### 2.5 Tranche and class session management API

- **Builds:** tranches within a cohort by position, and class sessions assigned to a tranche by position.
- **Files:** `apps/api/src/routes/admin/tranches.js`, `apps/api/src/routes/admin/classSessions.js`, matching controller, service and repository files, `packages/schemas/classSession.js`.
- **Tables:** `tranches`, `class_sessions`.
- **Done when:** you can build the live Mobile App Development shape — 2 tranches, 24 class sessions of 120 minutes, 12 per tranche — through the API.
- **Depends on:** 2.4.

### 2.6 Resource attachment API

- **Builds:** attaching resources to a class session, carrying `provider` and `external_ref` behind the media abstraction.
- **Files:** `apps/api/src/routes/admin/resources.js`, `apps/api/src/services/mediaService.js`, `apps/api/src/services/providers/youtubeProvider.js`.
- **Tables:** `resources`, `class_sessions`.
- **Done when:** attaching an unlisted YouTube id stores `provider: 'youtube'` and the id, and nothing in the codebase constructs a YouTube URL outside the provider handler.
- **Depends on:** 2.5.

### 2.7 Admin shell

- **Builds:** the `(admin)` layout, navigation, and its client-rendered data layer. No SEO.
- **Files:** `apps/web/app/(admin)/layout.js`, `apps/web/app/(admin)/admin/page.js`, `apps/web/components/admin/AdminNav/`.
- **Tables:** none.
- **Done when:** logging in as an admin reaches an admin home at `/admin` that a learner cannot open, and the admin bundle is not shipped to marketing visitors.
- **Depends on:** 1.11, 2.2.
- **Route collision, corrected.** This step originally listed `(admin)/page.js`. Route groups add no URL segment, so that resolves to `/` — the same path as step 9.2's `(marketing)/page.js`, and Next refuses to build two pages claiming one route. The marketing group owns `/`. The admin home is therefore `(admin)/admin/page.js`, serving `/admin`. Step 0.4 placed its provisional admin page at that path already.

### 2.8 Admin catalogue screens

- **Builds:** course list and editor, cohort editor, tranche and class session editor, resource attachment.
- **Files:** `apps/web/app/(admin)/courses/`, `cohorts/`, `cohorts/[id]/sessions/`, `apps/web/components/admin/SessionEditor/`, `TrancheGroup/`.
- **Tables:** none directly.
- **Done when:** you can create the full Mobile App Development cohort from your phone without touching the database.
- **Depends on:** 2.6, 2.7.

### 2.9 Seed script

- **Builds:** local development data — one course, one cohort with three tranches, one learner, one guardian, one admin.
- **Files:** `apps/api/prisma/seed.js`.
- **Tables:** all created so far.
- **Done when:** a reset-and-seed command produces a database you can log into as each role.
- **Depends on:** 2.8.

---

## Stage 3 — Purchase and payment plan

### 3.1 Commerce and enrollment schema

- **Builds:** the purchase, instalment and enrollment tables.
- **Files:** `apps/api/prisma/schema.prisma`, migration.
- **Tables:** `purchases`, `instalments` (indexes on `purchase_id, position` and on `due_on, status`), `enrollments` (unique on `user_id, cohort_id`; index on `expires_at, status`).
- **Done when:** the migration applies; `enrollments.status` uses `pending · enrolled · suspended · completed · expired · deferred`; money columns are integers.
- **Depends on:** 2.1.
- **Note:** the build order names stage 3 "purchase and payment plan" and doesn't mention enrollment. Enrollment lives here because the purchase flow creates it. Flagging rather than assuming.

### 3.2 Payment plan generation

- **Builds:** the service that, given a cohort and a plan shape, writes instalments with positions, amounts in kobo, and due dates — with instalment position mapping 1:1 to tranche position.
- **Files:** `apps/api/src/services/paymentPlanService.js`, `apps/api/src/repositories/instalmentRepository.js`.
- **Tables:** `purchases`, `instalments`.
- **Done when:** generating a plan for the live cohort yields exactly two instalments, `15000000` and `10000000` kobo, positions 1 and 2, with due dates matching the week-3 rule.
- **Depends on:** 3.1. **Blocked on where the plan shape is stored** — see the gaps list.

### 3.3 Purchase and enrollment creation

- **Builds:** the endpoint that creates a purchase, generates the plan, and opens a `pending` enrollment against the chosen cohort, refusing when the cohort is at capacity.
- **Files:** `apps/api/src/routes/purchases.js`, `apps/api/src/services/purchaseService.js`, `apps/api/src/services/enrollmentService.js`, `packages/schemas/purchase.js`.
- **Tables:** `purchases`, `instalments`, `enrollments`, `cohorts`.
- **Done when:** a learner can enroll into a cohort and land on a payment page showing two unpaid instalments; a second enrollment into the same cohort is refused by the unique constraint.
- **Depends on:** 3.2.

### 3.4 Payment page read model

- **Builds:** the server-derived view of the schedule: each instalment with its domain status and the visual state it maps to. Never computed in the browser.
- **Files:** `apps/api/src/services/paymentViewService.js`, `apps/api/src/controllers/paymentController.js`.
- **Tables:** `instalments`, `purchases`, `enrollments`.
- **Done when:** the endpoint returns each instalment carrying its state, and changing the system clock past a due date flips one from due to overdue without any client-side date arithmetic.
- **Depends on:** 3.3.
- **Per D7:** the column stores `unpaid · paid · cancelled`. This service derives `due`, `upcoming` and `overdue` from `due_on`, then maps to the visual state.

### 3.5 The payment rail

- **Builds:** `Rail`, the shared motif element, and `PaymentRail`, the composite feeding instalments into it as knots.
- **Files:** `apps/web/components/elements/Rail/`, `apps/web/components/payments/PaymentRail/`, `apps/web/app/(app)/payments/[purchaseId]/page.js`.
- **Tables:** none directly.
- **Done when:** the live cohort's two instalments render as a two-knot rail, the paid knot in `done` and the due knot in `active`, matching design-system.html §07 in both themes; an overdue knot renders in `overdue` using `--state-overdue-rail` from D3.
- **Depends on:** 3.4, 1.10.
- **Per D1:** the component consumes the visual state the API supplies. It performs no date arithmetic and does not map domain status to visual state itself.

---

## Stage 4 — Payment webhooks and tranche unlock

### 4.1 Transaction and audit schema

- **Builds:** the transaction record and the append-only audit log.
- **Files:** `apps/api/prisma/schema.prisma`, migration.
- **Tables:** `transactions` (unique on `gateway_reference`), `payment_audit_log`.
- **Done when:** inserting two rows with the same `gateway_reference` fails at the database, not in application code.
- **Depends on:** 3.1.

### 4.2 Gateway abstraction and payment initiation

- **Builds:** one provider interface and one handler for the chosen gateway; the endpoint that opens a bank-transfer payment for a specific instalment and returns the transfer details.
- **Files:** `apps/api/src/services/paymentGatewayService.js`, `apps/api/src/services/providers/paystackProvider.js` or `flutterwaveProvider.js`, `apps/api/src/routes/payments.js`.
- **Tables:** `instalments`, `transactions`.
- **Done when:** clicking a knot in test mode returns live transfer details and writes a pending transaction.
- **Depends on:** 4.1, 3.5. **Blocked on choosing Paystack or Flutterwave.**

### 4.3 Webhook receiver: verify and dedupe

- **Builds:** the raw-body webhook endpoint, signature verification, rejection of unsigned or mismatched payloads, and idempotent handling of retries.
- **Files:** `apps/api/src/routes/webhooks.js`, `apps/api/src/controllers/webhookController.js`, `apps/api/src/middleware/rawBody.js`.
- **Tables:** `transactions`.
- **Done when:** a correctly signed payload is accepted, a tampered one is rejected, and the same payload delivered three times credits once.
- **Depends on:** 4.2.

### 4.4 Server-to-server re-verification and settlement

- **Builds:** re-querying the gateway for the reference, then recording the transaction, marking the instalment paid, and moving the enrollment from `pending` to `enrolled` — all inside one database transaction, with an audit row.
- **Files:** `apps/api/src/services/settlementService.js`, `apps/api/src/services/paymentAuditService.js`.
- **Tables:** `transactions`, `instalments`, `enrollments`, `payment_audit_log`.
- **Done when:** a verified webhook for instalment 1 leaves the instalment paid, the enrollment `enrolled`, and an audit row present — and a forced failure mid-way leaves all three unchanged. No `is_unlocked` column is written anywhere, because none exists.
- **Depends on:** 4.3.

### 4.5 Manual confirmation fallback

- **Builds:** the admin action for off-platform transfers, writing the same settlement path and recording who confirmed it.
- **Files:** `apps/api/src/routes/admin/payments.js`, `apps/web/app/(admin)/payments/page.js`.
- **Tables:** `transactions`, `instalments`, `enrollments`, `payment_audit_log`.
- **Done when:** an admin can confirm a payment manually and the audit log names them as the actor.
- **Depends on:** 4.4.

### 4.6 Payment completion in the interface

- **Builds:** the payment view for one instalment, and query invalidation so the rail refetches after the webhook lands rather than trusting the browser redirect.
- **Files:** `apps/web/app/(app)/payments/[purchaseId]/[position]/page.js`, `apps/web/lib/hooks/usePaymentPlan.js`.
- **Tables:** none directly.
- **Done when:** paying instalment 1 in test mode turns knot 1 `done` after the webhook, and manually hitting the redirect URL without a webhook unlocks nothing.
- **Depends on:** 4.5.

---

## Stage 5 — Content delivery through EntitlementService

### 5.1 EntitlementService

- **Builds:** the single implementation of the four-condition check, plus the paid-instalment count that condition 4 rests on.
- **Files:** `apps/api/src/services/entitlementService.js`.
- **Tables:** `enrollments`, `instalments`, `tranches`, `class_sessions`.
- **Done when:** a test matrix covers all four conditions failing individually and all four passing; tranche 2 opens the moment instalment 2 is paid, with no flag written.
- **Depends on:** 4.4.

### 5.2 Entitlement-aware serialiser

- **Builds:** the one serialiser that turns a class session plus an entitlement result into a response object — building the unlocked shape, never stripping a full one.
- **Files:** `apps/api/src/serializers/classSessionSerializer.js`.
- **Tables:** none directly.
- **Done when:** a locked class session serialises with title, position, `scheduled_at`, tranche and `locked: true`, and a deep search of that object finds no `meeting_url`, no `external_ref`, and no resource URL.
- **Depends on:** 5.1.

### 5.3 Cohort schedule and class session endpoints

- **Builds:** the learner's schedule listing and single class session detail, both routed through the serialiser.
- **Files:** `apps/api/src/routes/cohorts.js`, `apps/api/src/controllers/cohortController.js`.
- **Tables:** `cohorts`, `tranches`, `class_sessions`, `resources`, `enrollments`, `instalments`.
- **Done when:** a learner with one instalment paid sees 24 class sessions, 12 with material and 12 locked, and the raw JSON contains nothing for the locked 12.
- **Depends on:** 5.2.

### 5.4 Resource and video identifier lookup

- **Builds:** the endpoint returning a playable identifier for one resource, calling the EntitlementService independently rather than trusting that the caller already passed.
- **Files:** `apps/api/src/routes/resources.js`, `apps/api/src/services/mediaService.js`.
- **Tables:** `resources`, `class_sessions`, plus the entitlement chain.
- **Done when:** requesting a tranche 2 identifier by guessing its UUID returns 403 for a learner with one instalment paid.
- **Depends on:** 5.3.

### 5.5 Cohort WhatsApp link

- **Builds:** the group link stored on the cohort and served only behind the entitlement check.
- **Files:** migration adding the column, `apps/api/src/controllers/cohortController.js`.
- **Tables:** `cohorts`.
- **Done when:** the link appears for an enrolled learner and is absent from the payload for a pending one.
- **Depends on:** 5.3.

### 5.6 Learner dashboard and cohort schedule

- **Builds:** the learner's home, the schedule grouped by tranche, and the class session detail view. Locked class sessions render greyed and visible, not hidden.
- **Files:** `apps/web/app/(app)/dashboard/page.js`, `apps/web/app/(app)/cohorts/[id]/page.js`, `apps/web/app/(app)/sessions/[id]/page.js`, `apps/web/components/lms/ClassSessionCard/`, `TrancheGroup/`.
- **Tables:** none directly.
- **Done when:** on a phone you can see the whole 24-session course with tranche 2 greyed, and know what you'd get by paying. Per D4, held class sessions read `done`, the next one reads `active`, tranche 2 reads `locked`, and paid future class sessions carry a date with no badge.
- **Depends on:** 5.4, 1.10.

### 5.7 Video playback and watch progress

- **Builds:** the YouTube IFrame player wrapper, user-initiated only, reporting position to the progress endpoint.
- **Files:** `apps/web/components/lms/RecordingPlayer/`, `apps/api/src/routes/progress.js`, migration.
- **Tables:** `session_progress`.
- **Done when:** a recording plays only after a tap, and progress persists across a reload.
- **Depends on:** 5.6.
- **Per D12:** store `watched_seconds`; derive completion at 90% of `duration_minutes` and stamp `completed_at` once.

---

## Stage 6 — Assignments, submissions, grades

### 6.1 Learning schema

- **Builds:** assignment, submission and attendance tables.
- **Files:** `apps/api/prisma/schema.prisma`, migration.
- **Tables:** `assignments`, `submissions` (unique on `assignment_id, user_id` if you take the update-in-place route), `attendance`.
- **Done when:** the migration applies with `submissions.is_late` present.
- **Depends on:** 2.1.
- **Per D11:** resubmission updates in place, so the unique constraint on `submissions (assignment_id, user_id)` stands.

### 6.2 Assignment management

- **Builds:** admin CRUD over assignments attached to class sessions, with the `draft → published → open → closed` lifecycle.
- **Files:** `apps/api/src/routes/admin/assignments.js`, service, repository, `packages/schemas/assignment.js`.
- **Tables:** `assignments`, `class_sessions`.
- **Done when:** an assignment can be moved through every lifecycle state and only published ones are visible to learners.
- **Depends on:** 6.1, 2.2.

### 6.3 Submission

- **Builds:** the learner submission endpoint, entitlement-gated, permitting resubmission until the due date and flagging late work rather than refusing it.
- **Files:** `apps/api/src/routes/submissions.js`, `apps/api/src/services/submissionService.js`.
- **Tables:** `submissions`, `assignments`.
- **Done when:** submitting after the due date succeeds with `is_late` set; resubmitting before it replaces or versions per the decision; a learner without entitlement for that class session is refused.
- **Depends on:** 6.2, 5.1. **Blocked on file upload storage** — see the gaps list.

### 6.4 Grading and gradebook

- **Builds:** admin grading with feedback, and the aggregation into a gradebook per cohort and per learner.
- **Files:** `apps/api/src/routes/admin/grading.js`, `apps/api/src/services/gradebookService.js`.
- **Tables:** `submissions`, `assignments`, `enrollments`.
- **Done when:** grading a submission sets score, feedback, `graded_by` and `graded_at`, and both the cohort gradebook and the learner's own view reflect it.
- **Depends on:** 6.3.

### 6.5 Attendance marking

- **Builds:** the admin roster for one class session with manual marking.
- **Files:** `apps/api/src/routes/admin/attendance.js`, `apps/web/app/(admin)/sessions/[id]/attendance/page.js`.
- **Tables:** `attendance`, `class_sessions`, `enrollments`.
- **Done when:** an admin can mark a full cohort roster for one class session from a phone.
- **Depends on:** 6.1, 2.7.
- **Per D6:** `present · absent · late`. An unmarked class session has no row.

### 6.6 Learner and admin learning screens

- **Builds:** the learner assignment panel and grade view, and the admin gradebook.
- **Files:** `apps/web/app/(app)/assignments/`, `apps/web/app/(app)/grades/page.js`, `apps/web/app/(admin)/gradebook/page.js`, `apps/web/components/lms/AssignmentPanel/`, `GradeRow/`.
- **Tables:** none directly.
- **Done when:** a learner submits and sees a grade; an admin grades a cohort in one screen.
- **Depends on:** 6.4, 6.5.

---

## Stage 7 — Guardian dashboard and shared payment access

### 7.1 Relationship-scoped observer middleware

- **Builds:** the guard that, for every guardian read, verifies a `guardianships` row links requester to subject before anything else runs.
- **Files:** `apps/api/src/middleware/requireObserver.js`, `apps/api/src/services/guardianshipService.js`.
- **Tables:** `guardianships`.
- **Done when:** guardian A requesting learner B's data receives 403 where no guardianship exists, and every guardian-facing route passes through this middleware without exception.
- **Depends on:** 1.4, 1.8.

### 7.2 Guardian read endpoints

- **Builds:** read-only progress, submissions, grades and attendance for a linked learner, and the list of learners one guardian observes.
- **Files:** `apps/api/src/routes/guardian.js`, `apps/api/src/controllers/guardianController.js`.
- **Tables:** `guardianships`, `enrollments`, `submissions`, `attendance`, `session_progress`.
- **Done when:** a guardian sees their learner's grades and cannot write anything.
- **Depends on:** 7.1, 6.4.

### 7.3 Shared payment page access

- **Builds:** extending the payment view's authorisation so a linked guardian reaches the same page, with `paid_by_user_id` recording who actually paid.
- **Files:** `apps/api/src/controllers/paymentController.js`, `apps/api/src/services/settlementService.js`.
- **Tables:** `purchases`, `instalments`, `transactions`, `guardianships`.
- **Done when:** a guardian pays instalment 2 and the transaction records the guardian as payer while the enrollment stays the learner's.
- **Depends on:** 7.1, 4.4.

### 7.4 Guardian dashboard

- **Builds:** the guardian view and the learner switcher for guardians with several learners.
- **Files:** `apps/web/app/(app)/guardian/page.js`, `apps/web/components/guardian/GuardianDashboard/`, `LearnerSwitcher/`.
- **Tables:** none directly.
- **Done when:** a guardian with two learners can switch between them and sees no write controls anywhere.
- **Depends on:** 7.2, 7.3.

---

## Stage 8 — Scheduled jobs

### 8.1 Cron harness

- **Builds:** node-cron registration inside the API process, a job runner that logs start and finish, timezone-correct comparison against West Africa Time, and a manual trigger for testing.
- **Files:** `apps/api/src/jobs/index.js`, `apps/api/src/jobs/runner.js`, `apps/api/src/routes/admin/jobs.js`.
- **Tables:** `email_log`.
- **Done when:** a no-op job runs on schedule on Railway and can also be fired manually by an admin.
- **Depends on:** 1.5, 0.5.

### 8.2 Dunning reminders

- **Builds:** the daily sweep finding instalments at 7, 3 and 1 days before due and on the due date, sending reminders that deep-link to the payment page, each guarded by `email_log`.
- **Files:** `apps/api/src/jobs/dunningJob.js`, `apps/api/src/emails/templates/instalmentReminder.js`.
- **Tables:** `instalments`, `enrollments`, `users`, `email_log`.
- **Done when:** running the job twice on the same day sends the reminder once, and the email opens the correct payment page.
- **Depends on:** 8.1, 3.4.

### 8.3 Overdue sweep and suspension

- **Builds:** the daily sweep moving enrollments past the grace period to `suspended`, notifying the learner and guardian, and writing an audit row.
- **Files:** `apps/api/src/jobs/overdueJob.js`, `apps/api/src/emails/templates/suspensionNotice.js`.
- **Tables:** `instalments`, `enrollments`, `payment_audit_log`, `email_log`.
- **Done when:** an unpaid instalment past grace suspends the enrollment, and the suspended learner's next content request returns locked immediately — no waiting for a token to expire.
- **Depends on:** 8.2, 5.1.

### 8.4 Reinstatement on settlement

- **Builds:** the path restoring a suspended enrollment to `enrolled` on payment, preserving the **remainder** of the original access window rather than granting a fresh month.
- **Files:** `apps/api/src/services/settlementService.js`, `apps/api/src/services/enrollmentService.js`.
- **Tables:** `enrollments`, `instalments`, `payment_audit_log`.
- **Done when:** suspending, waiting, then settling restores access with the original `expires_at` intact.
- **Depends on:** 8.3.

### 8.5 Completion, expiry warnings and expiry sweep

- **Builds:** three related jobs — marking completion when the final class session has passed _and_ all instalments are paid, warning at 7 and 1 days before `expires_at`, and moving lapsed enrollments to `expired` while retaining records and grades.
- **Files:** `apps/api/src/jobs/completionJob.js`, `expiryWarningJob.js`, `expirySweepJob.js`, `apps/api/src/emails/templates/expiryWarning.js`.
- **Tables:** `enrollments`, `instalments`, `class_sessions`, `email_log`.
- **Done when:** a cohort finished with money outstanding lands in `suspended`, one paid in full lands in `completed` with `expires_at` one month out, and an expired enrollment keeps its grades but returns locked content.
- **Depends on:** 8.4.

### 8.6 Class session reminders and schedule changes

- **Builds:** hourly reminders 24 hours and 1 hour before a class session, and cohort-wide notification when a class session is rescheduled or cancelled — both reaching learners and guardians.
- **Files:** `apps/api/src/jobs/classSessionReminderJob.js`, `apps/api/src/emails/templates/classSessionReminder.js`, `scheduleChange.js`.
- **Tables:** `class_sessions`, `enrollments`, `guardianships`, `email_log`.
- **Done when:** a class session 24 hours out triggers exactly one reminder per recipient, and moving it notifies the cohort once.
- **Depends on:** 8.1.

### 8.7 Weekly guardian summary

- **Builds:** the weekly digest of a linked learner's progress, submissions and payment position.
- **Files:** `apps/api/src/jobs/guardianSummaryJob.js`, `apps/api/src/emails/templates/guardianSummary.js`.
- **Tables:** `guardianships`, `enrollments`, `submissions`, `instalments`, `email_log`.
- **Done when:** a guardian receives one summary per learner per week, deduplicated by `email_log`.
- **Depends on:** 8.6, 7.2. **Blocked on the send day and time.**

---

## Stage 9 — Marketing site and course catalogue

### 9.1 Marketing shell

- **Builds:** the `(marketing)` layout, header, footer, and the code-splitting boundary keeping the app and admin bundles out of it.
- **Files:** `apps/web/app/(marketing)/layout.js`, `apps/web/components/marketing/SiteHeader/`, `SiteFooter/`.
- **Tables:** none.
- **Done when:** a marketing page's JavaScript payload contains nothing from `(app)` or `(admin)`, measured against a stated budget.
- **Depends on:** 1.10.

### 9.2 Portfolio pages

- **Builds:** home, about, services and case studies, statically rendered.
- **Files:** `apps/web/app/(marketing)/page.js`, `about/page.js`, `services/page.js`, `work/[slug]/page.js`, `apps/web/content/`.
- **Tables:** none. **Blocked on you supplying the copy and case study material.**
- **Done when:** the site reads as a portfolio for the software services line, with clients and learners kept as separate journeys.
- **Depends on:** 9.1.

### 9.3 Course catalogue

- **Builds:** the public course list and detail page showing cohort dates, capacity and the instalment breakdown, using revalidated static generation.
- **Files:** `apps/web/app/(marketing)/courses/page.js`, `courses/[slug]/page.js`, `apps/api/src/routes/public/courses.js`.
- **Tables:** `courses`, `cohorts`, `tranches`.
- **Done when:** the Mobile App Development page shows ₦250,000 broken into ₦150,000 and ₦100,000, and a cohort date change appears within the revalidation window.
- **Depends on:** 9.2, 2.4.

### 9.4 Interest list

- **Builds:** the sign-up for courses with no open cohort, and the notification when one opens.
- **Files:** `apps/api/prisma/schema.prisma` migration, `apps/api/src/routes/public/interestList.js`, `apps/web/components/marketing/InterestListForm/`.
- **Tables:** `interest_list`, `courses`, `email_log`.
- **Done when:** a course with no open cohort offers the interest list rather than an enrol button, and publishing a cohort notifies the list. Nothing in the copy says "waitlist".
- **Depends on:** 9.3, 8.1.

### 9.5 SEO and performance pass

- **Builds:** metadata, sitemap, robots rules excluding authenticated routes, image optimisation, and the bundle budget check.
- **Files:** `apps/web/app/sitemap.js`, `apps/web/app/robots.js`, per-page metadata exports, `apps/web/scripts/checkBundle.js`.
- **Tables:** none.
- **Done when:** course pages are indexable, nothing behind auth is, and the budget check fails a build that exceeds it.
- **Depends on:** 9.4.

---

## Stage 10 — Client enquiry and lead pipeline

### 10.1 Lead schema

- **Builds:** the leads table.
- **Files:** `apps/api/prisma/schema.prisma`, migration.
- **Tables:** `leads`.
- **Done when:** the migration applies with the `new → contacted → proposing → won / lost` status values.
- **Depends on:** 2.1. **Blocked on the `project_type`, `budget_range` and `timeline` option lists.**

### 10.2 Enquiry endpoint

- **Builds:** the public submission endpoint with validation, spam protection, and admin notification on receipt.
- **Files:** `apps/api/src/routes/public/leads.js`, `apps/api/src/services/leadService.js`, `packages/schemas/lead.js`, `apps/api/src/emails/templates/newLead.js`.
- **Tables:** `leads`, `email_log`.
- **Done when:** a submission creates a lead and emails you within a minute.
- **Depends on:** 10.1, 1.5.

### 10.3 Enquiry form

- **Builds:** the structured form with the budget range field that filters unserious enquiries, plus the outbound link to your external scheduler.
- **Files:** `apps/web/app/(marketing)/enquiry/page.js`, `apps/web/components/marketing/EnquiryForm/`.
- **Tables:** none directly.
- **Done when:** the form submits from a phone, validates inline, and confirms receipt. **Blocked on the scheduler URL.**
- **Depends on:** 10.2, 9.1.

### 10.4 Admin lead inbox

- **Builds:** the pipeline view moving leads through their statuses with notes.
- **Files:** `apps/web/app/(admin)/leads/page.js`, `apps/web/components/admin/LeadInbox/`, `apps/api/src/routes/admin/leads.js`.
- **Tables:** `leads`.
- **Done when:** you can work a lead from new to won without leaving the admin surface.
- **Depends on:** 10.3, 2.7.

---

## Still open — needs you

Nothing above resolves these. They need a business decision or an asset, not an
engineering call.

**Assets and accounts:** ~~the three subset `.woff2` files~~ (cut from upstream
OFL sources at 0.4) · Paystack or
Flutterwave · Resend or Postmark · the external scheduler URL · portfolio copy
and case study material.

**Money and policy:** where the instalment plan shape is stored, since
₦150,000 / ₦100,000 currently exists only as prose in CLAUDE.md · which of
`courses.base_price_kobo`, `cohorts.price_kobo` and `purchases.total_kobo` a
purchase copies from, and what happens on deferral into a differently priced
cohort · whether a partly-paid instalment counts as paid for condition 4 of the
entitlement check · the cohort capacity number.

**Flow decisions:** whether a pending guardian account gates the first tranche
unlock — brief §8 raises it, and the four conditions as written say no, so
confirm that is what you want · the guardian summary send day and time · the
`project_type`, `budget_range` and `timeline` option lists.

**Infrastructure:** file upload storage for `submissions.file_ref`, which no
document mentions · whether the API sits on a subdomain of the web app, which
simplifies cookie handling, or a separate domain requiring CORS.

---

## Dependency shape

- Stage 0 gates everything.
- Stage 1 gates 2, 7 and every authenticated surface.
- Stage 2 gates 3 (a plan needs a cohort) and 5 (delivery needs class sessions).
- Stage 3 gates 4; stage 4 gates 5, because entitlement rests on paid instalments.
- Stage 5's EntitlementService gates 6 and 7 — both check access before reading.
- Stage 8 depends on 3, 4, 5 and 7, which is why it sits late despite being the reason the API is standalone.
- Stages 9 and 10 depend only on stage 2's catalogue and stage 1's shared components, so they could move earlier if you want something public sooner. The CLAUDE.md order puts them last deliberately; noting the option rather than acting on it.
