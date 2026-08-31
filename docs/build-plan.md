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

**D15. `guardianships.relationship` is optional free text on the form,
defaulting to `guardian` when blank.** The column stays `NOT NULL`. The default
is applied at the service layer, not as a database default, so the stored value
is always something the user or the service chose deliberately rather than
something the schema supplied silently.

No fixed option list. How a guardian relates to a learner varies too widely to
enumerate before seeing real data — parent, aunt, elder sibling, employer,
sponsor — and guessing at the list would bake a wrong taxonomy into the one
column that records the relationship. Narrowing it later, once the data says
what the values actually are, is an additive migration. This confirms the
free-text call made at 1.1 rather than reopening it.

Registration therefore carries a fourth guardian field: optional, free text,
labelled as the guardian's relationship to the learner. Added to the shared
schema at 1.3; rendered by the form at 1.11; consumed by the insert at 1.4,
which applies the default.

**D16. Password policy is NIST 800-63B shaped: 8 character minimum, 128
character maximum, no composition rules.** No mixed case, no digit requirement,
no symbol requirement.

Composition rules produce weaker passwords in practice — they push people
toward predictable substitutions and a small set of shapes that satisfy the
checker, which is why NIST dropped them. Length is the property that matters.
The upper bound is not a security limit but an operational one: an unbounded
string should never reach the key derivation.

This settles what 1.3 implemented as a marked default. It is now the project's
policy, and the same numbers govern the guardian claim at 1.7 and the password
reset at 1.8.

**D18. Claiming a guardian invitation stamps `email_verified_at`.**

Redeeming a single-use token sent to an address is proof of control over that
address, which is exactly what email verification asserts. The claim already
carries that proof; not recording it would discard evidence the flow has
already collected.

No guardian verification email exists in the plan, and none should be added. It
would send a second message to prove what the first already proved, and it would
leave every guardian permanently unverified in the meantime — a column that
nothing could ever set for half the accounts in the table.

The stamp is written inside the existing claim transaction at 1.7, with the same
timestamp that burns the token, so the two agree. This does not change D5:
verification remains a timestamp rather than a status, and `status` still moves
`pending` to `enabled` on its own account.

**D19. A pending guardian whose invitation expired can request a fresh one.**

Until this, that account had no route in at all. Claiming needs a live token,
and the password reset at 1.8 serves only `enabled` accounts, so a guardian who
leaves the email a week was locked out permanently — which is what real parents
will do.

`POST /auth/invitation/resend` takes an address and issues a new
`guardian_invitation` token for it, sending the same email 1.6 already writes.
It serves only a `pending` account that holds at least one guardianship: an
`enabled` account has the reset, a `suspended` one should not be handed a way
back in, and a pending account with no guardianship is not a guardian stub and
has no learner to name in the message.

One link suffices however many learners the guardian is named for. Claiming
activates the account, and every guardianship they hold then works.

It answers identically whether or not the address exists or is eligible, exactly
as the reset does. A response that distinguished them would be a way to test
which addresses are registered, and worse here than at 1.8 — it would also say
which of those belong to accounts nobody has claimed yet.

The resend is logged under its own `email_log` type, `guardian_invitation_resend`,
scoped to the token rather than the learner. The original invitation stays scoped
to the learner, where its job is to stop a second automatic send for the same
child; a resend is a person asking, and must never be suppressed as a duplicate.
Keeping the two types apart also lets the log say which messages the system sent
and which were requested.

**This endpoint depends on step 1.9.** Unthrottled it will post mail to any
address a caller names, as fast as they can ask. Rate limiting is 1.9's work and
is not built here; 1.9 must cover this route alongside login and registration.

**D20. Security flags default to safe and require an explicit opt-out.**

`secure: process.env.NODE_ENV === 'production'` was backwards. A flag that is
off unless something is set means forgetting a variable produces an unprotected
cookie on a public HTTPS host — which is exactly what happened. `NODE_ENV` was
set on the `web` service but not on `api`, so the deployed API issued session
cookies with no `Secure` flag, and nothing failed loudly: the cookie worked, it
simply was not protected. Railway's HTTPS redirect does not help, because the
browser has already sent the cookie by the time the redirect arrives.

Inverted. The cookie is `Secure` unless `AUTH_COOKIE_SECURE` explicitly opts
out, and only the literal string `false` does — unset, empty, or misspelt all
leave it on. Forgetting a variable now yields a cookie that is too strict rather
than one sent in clear text. The opt-out exists for local http development and
nothing else.

**This applies to any future security flag, not only this one.** A flag whose
absence weakens a guarantee is written the wrong way round. `httpOnly` and
`SameSite` already follow the rule — neither is conditional — and anything added
later must too.

The Secure flag no longer reads `NODE_ENV`. That variable still governs whether
`db/client.js` parks the Prisma client on `globalThis`, which is a development
convenience rather than a security property, and it is set on the `api` service
separately.

**D21. The email-verification token had nothing to redeem it, and the API has
no CORS. Both are step 1.12.**

Two omissions, found when 1.11 was read against what the API actually exposes.

**Nothing consumes an `email_verification` token.** Step 1.6 issues one on every
registration and emails a link to `/verify`, and 1.6's done-when — both emails
sent and recorded — is satisfied by that alone. But no step was ever assigned
the other end. 1.7 built the guardian claim, 1.8 built login and password reset,
and the verification purpose from D8 was left minted, emailed, and unredeemable.
`users.email_verified_at` is therefore reachable only through D18's guardian
claim: a learner cannot verify at all, and has not been able to since 1.6.

**The API sets no CORS headers.** The web app and the API are different origins
in both environments — `greenatetech.com` calling `api.greenatetech.com`, and
`localhost:3000` calling `localhost:4000`. The cookie itself is fine: those are
the same registrable domain, so `SameSite=lax` permits it. CORS is a separate
gate, and without an explicit `Access-Control-Allow-Origin` plus
`Access-Control-Allow-Credentials`, a browser will neither send the session
cookie nor let script read the response. Every screen in 1.11 would fail at its
first request. `*` is not an option here — it is invalid with credentials — so
the allowed origin must be named, which is what `WEB_ORIGIN` is for.

Both are API work and 1.11 is entirely web work, so they become their own step
rather than doubling 1.11's file list. **1.12 is numbered after 1.11 but built
before it**, and 1.11's dependencies say so. The numbering is kept rather than
renumbering the stage, because entries elsewhere already reference 1.11 by
number.

Recorded as a decision rather than fixed quietly because the gap is worth
knowing about: a done-when can be honestly met and still leave a flow with no
other end, when the step that would have closed it does not exist.

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

### 1.1 Identity schema — **DONE**

- **Builds:** the three identity tables and their indexes.
- **Files:** `apps/api/prisma/schema.prisma` (the `UserStatus` enum plus the `User`, `AuthSession` and `Guardianship` models, and the header comment recording the storage conventions every later model follows), `apps/api/prisma/migrations/20260829150000_identity_schema/migration.sql`. Also changed `.prettierignore` (added `.railway/`) — unrelated to the schema, carried in the same commit.
- **Tables:** `users`, `auth_sessions`, `guardianships` (unique on `guardian_id, learner_id`; indexes on `guardian_id` and on `learner_id`). Drops `scratch_probe`, the transitional table step 0.3 recorded this step as removing.
- **Done when:** the migration applies and the three tables exist with the columns from architecture §4.1.
- **Depends on:** 0.3.
- **Per D5:** `users.status` is `pending · enabled · suspended`.
- **Verified against the Railway `development` Postgres**, retrospectively, at step 1.2. `prisma validate` passes; `prisma migrate status` reports "Database schema is up to date!" with 2 migrations found and applied; `prisma migrate diff` between the datamodel and the live datasource reports "No difference detected", so schema and database have not drifted. All three tables exist with exactly the architecture §4.1 columns in order — `users` (id, email, phone, full_name, password_hash, email_verified_at, status, is_admin, created_at), `auth_sessions` (id, user_id, token_hash, expires_at, revoked_at, user_agent, created_at), `guardianships` (id, guardian_id, learner_id, relationship, created_at) — with no extra columns and none missing. Every `id` is `uuid` defaulting to `uuid_generate_v7()` and every timestamp is `timestamp with time zone`, per CLAUDE.md rule 10. The `user_status` enum carries `pending`, `enabled`, `suspended` in that order and nothing else. Indexes present: `users_email_key` unique; `auth_sessions_token_hash_key` unique and `auth_sessions_user_id_idx`; `guardianships_guardian_id_learner_id_key` unique plus separate `guardian_id` and `learner_id` indexes. `scratch_probe` no longer exists (`to_regclass` returns null). Step 1.2 then exercised the tables through Prisma — creating, reading, updating and cascade-deleting rows against all three — so the schema is proven in use, not only in DDL. `npm run lint` exits 0; `npm run format:check` reports only the pre-existing `docs/*` files.
- **Decided during the step — `guardianships.relationship` is free text, not an enum.** No document in the project specifies the permitted values, and an option list is a business decision rather than an engineering call. Narrowing it later is an additive migration. Recorded in the model's doc comment.
- **Decided during the step — `one_time_tokens` is not built here.** Architecture §4.1 groups it under Identity, but the build plan assigns it to 1.4, which owns the invitation flow that needs it. The migration's header records the divergence so the two documents do not look accidentally out of step.
- **Decided during the step — `auth_sessions.token_hash` is unique.** §4.1 marks the constraint on `one_time_tokens.token_hash` but not on this one. A presented token must resolve to at most one auth session, and 1.2's resolver relies on that being a single-row lookup.
- **Decided during the step — no role column on `users`.** Per architecture §4.7, learner and guardian standing are derived from `enrollments` and `guardianships`; only `is_admin` is stored.

### 1.2 Auth core services — **DONE**

- **Builds:** password hashing, auth-session token generation and hashing, cookie serialisation (httpOnly, secure, SameSite), token verification, revocation.
- **Files:** `apps/api/src/services/passwordService.js`, `apps/api/src/services/authSessionService.js`, `apps/api/src/repositories/authSessionRepository.js`, `apps/api/src/middleware/requireAuth.js`. Also `apps/api/test/authSession.test.js` — not in the original Files list, but the done-when is a unit test, so it is the deliverable rather than an extra. Changed `apps/api/package.json` (added a `test` script) and `apps/api/.env.example` (added `AUTH_SESSION_TTL_DAYS` and `AUTH_COOKIE_SAMESITE`, the two variables the new code reads). The untracked local `apps/api/.env` had its empty `AUTH_SESSION_SECRET` filled with a generated value so the tests can run. No migration, no new dependency. `src/services/` and `src/repositories/` are created here — 0.2 deliberately left them until their first real file.
- **Tables:** `auth_sessions`, `users`.
- **Done when:** a unit test creates an auth session, resolves it from a cookie value, revokes it, and confirms the revoked token no longer resolves. The raw token never appears in the database.
- **Depends on:** 1.1.
- **Verified:** `npm test` runs 13 tests across 3 suites, **13 pass, 0 fail**. The done-when is one test end to end: issue an auth session, hand the token to `setAuthCookie`, serialise what it wrote into a `Cookie` header, parse it back with `readAuthCookie`, resolve that value, revoke, and confirm the same cookie value no longer resolves — the token is never passed straight to the resolver. A second test proves the storage claim: `token_hash` is a 64-character hex digest unequal to the token, `JSON.stringify(row)` does not contain it, and a raw `SELECT count(*) FROM auth_sessions WHERE token_hash = <token>` returns 0. Further tests cover an expired auth session, a `suspended` account being refused on the very next resolution, bulk revocation, cookie clearing with the attributes it was set with, absent and unrelated cookie headers, `requireAuth` admitting a live session and attaching `req.user` / `req.authSession`, and `requireAuth` returning 401 for a revoked session and for no cookie at all. Password tests confirm verification round-trips, a wrong password fails, two hashes of one password differ, the plaintext does not appear in the stored string, and a null or empty stored hash returns false rather than throwing. `npm run lint` exits 0 with no errors and no warnings. `npm run format:check` fails on 5 pre-existing `docs/*` files — `design-system.html`, `product-concept-brief-v1.2.md`, `technical-architecture-v1.2.md`, `tokens.css`, `tokens.json` — confirmed pre-existing by stashing this step's changes and re-running against clean `HEAD`; every file this step touched passes. Earlier entries record six such files; `docs/build-plan.md` now passes, leaving five.
- **Tests run against the Railway `development` Postgres**, because no local Postgres exists in this environment and the behaviour under test is a database read on every request. Each test creates its own user at `step-1-2-authsession+<uuid>@example.invalid` and deletes it in an `after` hook, auth session rows following on cascade. Confirmed clean afterwards: zero leftover test users, zero `auth_sessions` rows.
- **Decided during the step — scrypt from `node:crypto`, not bcrypt or argon2.** Both alternatives are native addons that must compile in Railway's build image; scrypt is memory-hard, ships with Node, and adds nothing to the dependency tree the deploy has to resolve. Parameters N=2^15, r=8, p=1, 32-byte key, 16-byte salt, with `maxmem` raised to 64 MiB because the 32 MiB working set sits exactly on Node's default ceiling and would be refused at the boundary. The stored value is `scrypt$N$r$p$salt$key`, self-describing, so raising the cost later does not invalidate hashes written today. Passwords are NFKC-normalised on both sides.
- **Decided during the step — the stored token hash is keyed, not a bare digest.** HMAC-SHA256 under `AUTH_SESSION_SECRET`, which 0.1 had already reserved in `.env.example`. The token is 32 random bytes and not guessable, so this is not defending against brute force: it means a leaked database is not a set of directly replayable cookies. The service throws a named error if the secret is absent rather than silently hashing under an empty key.
- **Decided during the step — validity policy lives in the service, not the repository.** The repository returns the row and its user; `resolveAuthSession` decides whether it is live. Keeping the split there is what lets the same row be tested in both states, and keeps the repository free of business rules. `findAuthSessionByTokenHash` includes the user in the same query, because rule 5 means every request needs the account status in the same breath.
- **Decided during the step — resolution failures are indistinguishable.** Unknown, revoked, expired, and not-`enabled` all return `null`. The caller has no use for the difference and a specific message would tell an attacker which one a token is. The `status === 'enabled'` check is what makes rule 5 pay: an admin sets `suspended` and the next request is refused, with nothing waiting to expire. `requireAuth` performs no caching, deliberately — a cached decision is the JWT problem wearing a different hat.
- **Decided during the step — the cookie is parsed in `authSessionService`, not by middleware.** `cookie-parser` was not added and `app.js` was not touched, so the cookie's name, attributes and encoding are defined in exactly one module alongside the code that writes it. `authCookieOptions()` serves both `setAuthCookie` and `clearAuthCookie`, because a cleared cookie whose attributes differ from the one that was set is a second cookie and the original stays in the browser.
- **Decided during the step — revocation is a timestamp, written with `updateMany`.** Nothing is deleted, so logout and forced revocation stay auditable. The `revokedAt: null` guard makes revoking twice a no-op and leaves the first timestamp standing. `revokeAllAuthSessionsForUser` was added alongside single revocation, slightly beyond the step's wording, because suspension under rule 5 has no other way to close existing logins. `req.user` is stripped of `passwordHash` before it travels any further into the request.
- **Decided during the step — `node:test`, no test framework.** Node 22+ ships the runner and the assertion library, so the first tests in the project cost no dependency. `npm test` in `apps/api` runs `node --test --env-file-if-exists=.env 'test/**/*.test.js'`.
- **Decided during the step — session lifetime defaults to 30 days.** No document specifies one. It is an engineering default, overridable with `AUTH_SESSION_TTL_DAYS`, and worth a second look before launch.
- **Per D20, corrected after the step — the Secure flag defaults to on.** This step shipped `secure: process.env.NODE_ENV === 'production'`, which is off unless something is set. `NODE_ENV` was set on the `web` service but not on `api`, so the deployed API issued session cookies with no `Secure` flag on a public HTTPS host and nothing failed loudly. It now reads `AUTH_COOKIE_SECURE`, where only the literal `false` opts out and unset, empty or misspelt all stay secure. Two tests pin the direction, including one asserting the flag no longer follows `NODE_ENV` at all.
- **Not decided, deliberately — `SameSite` and cookie domain.** Whether the API sits on a subdomain of the web app or a separate domain is still open, and it decides both. Neither is chosen here: `AUTH_COOKIE_SAMESITE` defaults to `lax` for same-site local development and `AUTH_COOKIE_DOMAIN` stays empty, each commented with what a separate domain would require — `none`, which browsers honour only over HTTPS, plus matching CORS credentials. `secure` is set from `NODE_ENV === 'production'`.
- **Open: `npm run format:check` is red on documents nobody should reformat.** The five `docs/*` files are verbatim reference copies; `.prettierignore` already exempts `apps/web/styles/tokens.css` for exactly that reason and simply missed the `docs/` originals. Left untouched as outside this step's scope, but until it is settled the format gate stays red for every later step.

### 1.3 Registration with the relationship field — **DONE**

- **Builds:** the registration endpoint accepting `relationship: self | guardian`, with the guardian branch validated conditionally; Zod schema shared with the web app.
- **Files:** `packages/schemas/registration.js`, `apps/api/src/routes/auth.js`, `apps/api/src/controllers/authController.js`, `apps/api/src/services/registrationService.js`. Also `apps/api/test/registration.test.js`, since the done-when is a claim about behaviour. Changed `apps/api/src/routes/index.js` (mounts the auth router at `/auth` — unmounted, the endpoint is unreachable and the done-when cannot be checked), `packages/schemas/index.js` (re-exports the schema, which that file's own comment already prescribed), `packages/schemas/package.json` (added `zod`), `apps/api/package.json` (added `@platform/schemas`) and `package-lock.json`. `src/controllers/` is created here — 0.2 deliberately left it until its first real file. No migration.
- **Tables:** `users`.
- **Done when:** posting a `self` registration creates one user; posting a `guardian` registration without guardian fields is rejected with field-level errors.
- **Depends on:** 1.2.
- **Verified:** `npm test` runs 25 tests across 6 suites, **25 pass, 0 fail** — 12 new here, driven through the assembled Express app over a real socket, so route, controller, schema and service are exercised together rather than in isolation. Both done-when clauses are direct assertions. The `self` clause: `POST /auth/register` returns 201, exactly one row exists for that address, `isAdmin` is false, and the stored hash verifies against the submitted password. The `guardian` clause: a registration with no `guardian` object returns 422 whose `error.fields` keys are exactly `guardian.fullName`, `guardian.email`, `guardian.phone`, and no user row is written. Further tests cover a partially supplied guardian reporting only the fields actually missing, a guardian sharing the learner's address being refused, a complete guardian registration creating the learner and **no** stub, email lowercasing and name trimming reaching the database, an optional learner phone storing null, a duplicate address returning 409 with a field-level message and leaving one row, an unknown `relationship` value, a short password with an invalid address reporting both, an empty body, and — added when D15 landed — a stated guardian relationship being trimmed and stored, a blank one being treated as absent, and the optional fourth field never appearing among the required-field errors. Every row is deleted afterwards; the `users` table was confirmed back to zero. `npm run lint` exits 0 with no errors or warnings. `npm run format:check` reports **all matched files use Prettier code style** — the `docs/*` files flagged as open at 1.2 were added to `.prettierignore` between the steps, so the format gate is green again.
- **Decided during the step — `relationship` is the discriminant, not a flag.** `z.discriminatedUnion('relationship', ...)` makes the guardian fields conditionally required by the schema's shape, so neither tier writes an `if` that the other could drift away from. The schema file opens by warning about the terminology collision: this `relationship` answers "who is registering" and is a fixed pair, while the `guardianships.relationship` column answers "how is the guardian related to this learner" and is free text per 1.1. Different questions, same word.
- **Decided during the step — the guardian object uses `prefault({})`, not `optional()`.** With the object absent, an optional field yields one opaque error on the parent; the done-when asks for _field-level_ errors and a form renders three inputs, each needing its own message. `prefault` still validates the empty default, so all three report separately. Verified in both directions: absent object gives three errors, partial object gives only the two missing.
- **Decided during the step — validation is answered from the controller, not thrown.** A 422 carries `{ error: { status, message, fields } }`, and the shared envelope in `middleware/error.js` has no room for the field map. That file is not in this step, so it was left alone. If a later form step wants the same shape everywhere, hoisting `fields` into the shared error handler is the move — noted in the controller.
- **Decided during the step — a registered learner is `enabled`, per D5.** Not the column's `pending` default: the learner has just set a password, and `pending` means an unclaimed stub with none. `email_verified_at` stays null; verification is not a status, and 1.6 fills it in.
- **Decided during the step — the guardian branch stops at a marked seam.** A complete guardian registration validates the details and creates the **learner only**. The stub account, the `guardianships` row and the invitation token are 1.4's work, and this step's "creates one user" reads as deliberate against 1.4's "produces a pending stub user, a guardianship row, and a token". The seam is a named comment in `registrationService.js`, and a test asserts the stub does not exist yet, so building 1.4 cannot silently duplicate it.
- **Decided during the step — a guardian may not share the learner's email address.** Caught in the schema rather than at the database, where it would surface at 1.4 as a unique-constraint violation while creating the stub.
- **Decided during the step — normalisation lives in the schema.** Addresses are trimmed and lowercased and names trimmed before they leave validation, so the value the form checks is the value stored and the unique index on `users.email` sees one casing. The learner's `phone` is optional, matching the nullable column; the guardian's is required, because brief §6.1 names "the guardian's name, email, and contact details" as the revealed fields.
- **Decided during the step — a duplicate address is a 409, not a 500.** Prisma's `P2002` is caught in the service and rethrown as a `RegistrationConflictError` carrying a field-level message on `email`, so the form can render it beside the input like any other error.
- **Decided during the step — `zod@^4.5.4`, exported through the package index.** Added to `@platform/schemas` and reached from the API as `@platform/schemas`, following the re-export convention `index.js` already documented, rather than widening the package's `exports` map with a subpath.
- **Settled after the step, as D16.** The 8-character floor, 128-character ceiling and absence of composition rules were implemented here as a marked default; D16 confirms them as the project policy. The comment in `registration.js` now cites D16 rather than asking for a decision.
- **Amended after the step, per D15 — a fourth guardian field.** The gap this entry originally raised (the column is `NOT NULL` from 1.1, but brief §6.1 names only name, email and contact details) is closed. `guardian.relationship` was added to `packages/schemas/registration.js`: optional free text, capped at 60 characters, trimmed, with blank normalising to `undefined` rather than to an empty string so the service applying the `guardian` default sees one absent value and not two. The default itself is **not** applied here — per D15 it belongs to the service that writes the column, which is 1.4's; the seam comment in `registrationService.js` says so. Nothing renders the field yet: the registration form is step 1.11, and because the schema is shared it will pick the field up without a second definition.

### 1.4 Guardian stub accounts and invitation tokens — **DONE**

- **Builds:** stub user creation for the named guardian, a `guardianships` row linking them, and a single-use expiring invitation token.
- **Files:** `apps/api/src/services/guardianshipService.js`, `apps/api/src/services/invitationService.js`, `apps/api/src/repositories/guardianshipRepository.js`, `apps/api/prisma/migrations/20260829213819_one_time_tokens/migration.sql`. Also `apps/api/src/repositories/oneTimeTokenRepository.js` — not listed, but the project's routes → controllers → services → repositories layering has no room for `invitationService` calling Prisma directly — and `apps/api/test/guardianship.test.js`. Changed `apps/api/prisma/schema.prisma` (the `OneTimeToken` model, the `OneTimeTokenPurpose` enum, the back-relation on `User`), `apps/api/src/services/registrationService.js` (the seam 1.3 left, now a transaction), `apps/api/src/controllers/authController.js` (one line, for the new return shape), `apps/api/test/registration.test.js` (1.3's seam guard, inverted — see below) and `apps/api/.env.example` (`ONE_TIME_TOKEN_SECRET`, `GUARDIAN_INVITATION_TTL_DAYS`). The untracked local `.env` got a generated secret. `migration_lock.toml` shows a one-character comma change rewritten by the newer Prisma CLI — not a real change, and it will reappear on any future migration.
- **Tables:** `users`, `guardianships`, `one_time_tokens` (per D8 — one table, `purpose` = `guardian_invitation`).
- **Done when:** a guardian registration produces a pending stub user, a guardianship row, and a token that expires and cannot be reused.
- **Depends on:** 1.3.
- **Verified:** `npm test` runs 38 tests across 9 suites, **38 pass, 0 fail** — 13 new here. Every clause of the done-when is a direct assertion, driven through the HTTP endpoint because "a guardian registration produces" is a claim about the whole flow rather than about services in isolation. The stub: `status` is `pending` and `password_hash` is null, per D5, with the submitted name and phone. The link: a `guardianships` row on the `(guardian_id, learner_id)` pair, carrying the stated relationship, or `guardian` when blank per D15. The token: exactly one row with `purpose = guardian_invitation`, unconsumed, expiring in the future — and it **expires** (refused past its window, both by resolution and redemption, including a row stored already-expired) and **cannot be reused** (a second redemption returns null, `consumed_at` is stamped rather than the row deleted, and under two simultaneous redemptions exactly one wins). Further tests cover the raw token being absent from the table and from the response body, the purpose scoping making a token issued for one flow unusable in another, an existing account being reused rather than duplicated, an already-`enabled` guardian receiving no token, and two rollback cases — one through `registerLearner`, one through `linkGuardianToLearner` inside a caller's transaction — each confirming nothing at all survives a failure. `prisma migrate status` reports "Database schema is up to date!" with 3 migrations; the live table carries exactly D8's seven columns, the unique index on `token_hash` from architecture §4.8, and the enum's three values. All rows are deleted afterwards; `users`, `guardianships`, `one_time_tokens` and `auth_sessions` were confirmed back to zero. `npm run lint` exits 0 with no errors or warnings; `npm run format:check` reports all matched files clean.
- **Decided during the step — one-time tokens get their own secret.** `ONE_TIME_TOKEN_SECRET`, not a reuse of `AUTH_SESSION_SECRET`: different lifetimes and a different blast radius if either leaks. It is required, with no fallback, and the service throws a named error when it is absent rather than hashing under an empty key. The purpose is folded into the hashed message (`purpose:token`), so a token issued for one of D8's three flows cannot be presented to another even if its raw value leaked — the hashes simply do not match. The unique constraint is on the hash alone, so this also keeps the three flows from colliding in one table.
- **Decided during the step — the service is written against `purpose`, not against invitations.** D8's whole argument is that three near-identical mechanisms built separately diverge on the fourth, so `invitationService` exposes issue, resolve and redeem parameterised by purpose. Steps 1.6 and 1.8 reuse it with no second mechanism and no further migration; only the `guardian_invitation` purpose is issued here.
- **Decided during the step — the learner, the stub, the link and the token are one transaction.** A learner whose guardianship row failed to write would be a half registration nothing downstream could detect: rule 6's permission check would find no row and deny access silently, looking exactly like a guardian who was never named. Both repositories therefore take an optional `client` defaulting to the shared one, so the same functions work inside a transaction and outside it. `authSessionRepository` from 1.2 does not yet take one; it has no transactional caller.
- **Decided during the step — single-use is enforced by a conditional update, not a check.** `updateMany` guarded on `consumed_at IS NULL` returns a count, and the redemption succeeds only on a count of 1. Reading the column and then writing would let two simultaneous redemptions both through. Tested with two concurrent redemptions of one token: exactly one winner.
- **Decided during the step — an existing account is reused, never duplicated.** A guardian email that already belongs to a user is linked rather than re-created. `users.email` is unique, so the alternative is a crash the moment a parent registers a second child — and the brief explicitly allows one person to be a learner on one course and a guardian for their child.
- **Decided during the step — an already-`enabled` guardian receives no token.** An invitation is a claim link, and there is nothing to claim on an account that already has a password. Only a `pending` account is unclaimed under D5, so only that case mints one. The guardianship row is still written, so the link works immediately.
- **Decided during the step — the raw token never enters a response body.** `registerLearner` returns it to its caller once, for step 1.6 to put in an email; the controller destructures the learner out and echoes only that. Whoever fills in the registration form is not necessarily the guardian, and a token in the 201 body would hand the learner their guardian's claim link.
- **Decided during the step — `one_time_tokens` gets a `user_id` index.** Architecture §4.8 names only the unique index on `token_hash`. The second is added for the reason 1.1 added one to `auth_sessions`: listing a user's tokens is a real query at 1.6 and 1.7, and the cascade needs it.
- **1.3's seam guard fired, and was inverted.** The registration test asserting "no guardian stub yet — that is step 1.4" failed on this step's first run, which is exactly what it was written to do. It now asserts the stub _is_ created, with a comment recording that the guard fired rather than that the assertion was always this way. The stub is covered in depth by `guardianship.test.js`; the registration test keeps only the shallow check.
- **Two unused repository functions were written and then removed.** `findGuardianshipsForGuardian` and `findGuardianshipsForLearner` are step 7.2's reads, not this step's, and nothing here called them.
- **Open: `ONE_TIME_TOKEN_SECRET` is not set in Railway.** Unset, a guardian registration throws in production. It needs setting for both environments before deploying this step. `.railway/railway.ts` was not touched — that is 0.5's file and outside this step — so adding it there, alongside the `preserve()` already used for `AUTH_SESSION_SECRET`, is a separate change.
- **Confirmed after the step — the invitation lifetime is seven days.** Long enough to survive a weekend and an unchecked inbox, short enough that a forwarded email stops working. No document specified one, so it was implemented as a marked default and then confirmed as the policy rather than left open. Overridable with `GUARDIAN_INVITATION_TTL_DAYS`.

### 1.5 Email provider abstraction and `email_log` — **DONE**

- **Builds:** one send interface behind a provider handler, templates directory, and the duplicate-send guard every later job depends on.
- **Files:** `apps/api/src/services/emailService.js`, `apps/api/src/services/providers/emailProvider.js`, `apps/api/src/emails/templates/README.md`, `apps/api/src/repositories/emailLogRepository.js`, `apps/api/prisma/migrations/20260830065321_email_log/migration.sql`. Also `apps/api/test/email.test.js`. Changed `apps/api/prisma/schema.prisma` (the `EmailLog` model and its back-relation on `User`) and the email block of `apps/api/.env.example`. The templates directory is carried by a README rather than a `.gitkeep`: it defines the contract `emailService` consumes, which this step owns, while the templates themselves are 1.6's.
- **Tables:** `email_log` (index on `user_id, type, entity_ref`).
- **Done when:** a test send writes an `email_log` row, and a second send of the same type for the same entity is refused by the guard rather than by the provider.
- **Depends on:** 1.1. **Was blocked on choosing Resend or Postmark; you chose Resend during this step.** The provider was not picked here — CLAUDE.md puts that choice outside an engineering call, so the step stopped and asked before any of it was written.
- **Verified:** `npm test` runs 49 tests across 11 suites, **49 pass, 0 fail** — 11 new here. Both halves of the done-when are direct assertions against a recording provider, which is not a convenience but the only instrument that can show the second half: the first send reaches the transport once and writes the row; the second returns `already_sent`, carries the id of the row that already existed, and leaves the transport's message count at one. That count is what distinguishes "refused by the guard" from "refused by the provider". Rule 9's real scenario is tested directly — seven calls across a seven-day expiry window produce one email and one row. Also covered: a second entity of the same type is not suppressed by the first, a second type for the same entity is not either, account-level mail with a null `entity_ref` still dedupes, a transport failure records nothing so tomorrow's sweep can retry, a missing `EMAIL_FROM` refuses to send, and `getEmailProvider` resolves `resend` and `console` by name while throwing on an unknown or unset value. `prisma migrate status` reports the migration applied; the live table carries architecture §4.6's five columns and §4.8's index, non-unique as intended. All rows deleted afterwards; `users`, `email_log`, `one_time_tokens` and `guardianships` confirmed back to zero. `npm run lint` exits 0 with no errors or warnings; `npm run format:check` reports all matched files clean.
- **Decided during the step — Resend is reached over its REST API with `fetch`, not its SDK.** This codebase has held a dependency-free line wherever the platform already provides the primitive — no dotenv, no morgan, no cookie-parser, no test framework — and one POST with a bearer token does not need a package. The response body is read whatever the status, because Resend reports failures as JSON and swallowing that would leave a bounced dunning reminder indistinguishable from a delivered one.
- **Decided during the step — `email_log.type` is a plain string, not an enum.** Every later step adds its own kinds of mail: invitation, verification, five dunning points, two expiry notices, class session reminders, the guardian summary. No document enumerates them, and an enum would mean a migration each time one is added, for a column nothing joins on. The same reasoning 1.1 applied to `guardianships.relationship`.
- **Decided during the step — the index is deliberately not unique.** Architecture §4.8 names it without `unique`, and that is right: `entity_ref` is nullable, Postgres treats every NULL as distinct, and a unique index would therefore stop guarding exactly the account-level mail that has no entity. The guard is a read in the service, per rule 9, not a constraint. A concurrent double-send is possible in principle and is bounded by the cron being a single daily process.
- **Decided during the step — send first, record second.** The reverse order marks a reminder as sent when the transport refused it, and the guard then suppresses every retry, so a learner is silently never warned about an instalment. A crash between the two costs one duplicate, which is the cheaper failure of the two. Tested: a refusing provider leaves no row.
- **Decided during the step — the guard returns a status rather than throwing.** A repeat is the expected outcome on most days of a dunning window, not an error, and a sweep should not catch an exception per learner it correctly skips. `sendEmail` returns `sent` or `already_sent` with the row either way.
- **Decided during the step — `getEmailProvider` throws rather than defaulting.** An unset `EMAIL_PROVIDER` quietly resolving to a no-op would mean a deploy that logs every dunning reminder and sends none. The `console` transport exists for local work without credentials, but it has to be asked for by name.
- **Decided during the step — the provider is injectable into `sendEmail`.** Defaulting to the configured one, overridable per call. This is what makes the done-when checkable at all, and it keeps the test suite from ever reaching a real transport.
- **Decided during the step — a template is a plain function returning `{ subject, html, text }`.** Three rules, recorded in `src/emails/templates/README.md`: a template never sends, always returns `text` alongside `html` because a plain-text-only client rendering a blank reminder is a reminder that did not arrive, and takes values rather than records so a raw token cannot reach one by accident.
- **Credentials verified in Railway after the step.** All eight variables are set on the `api` service in `development`: `EMAIL_PROVIDER` is exactly `resend` (checked for case, since the handler's lookup is case-sensitive and `Resend` would throw at the first send), `EMAIL_API_KEY` carries the `re_` prefix at 36 characters, `EMAIL_FROM` is `noreply@greenatetech.com`, and `AUTH_SESSION_SECRET` and `ONE_TIME_TOKEN_SECRET` are both 64 hex characters. `.railway/railway.ts` now declares all eight with `preserve()`, closing the drift this step surfaced. They were not visible on the first two checks because the dashboard changes had been staged and not yet deployed; a later `railway variables --kv` confirmed all eight live. Worth knowing for next time: `preserve()` reads rather than creates, so declaring a variable in the IaC file never sets it, and a staged dashboard edit is not live until it is deployed.
- **Observed during the step, not recorded as decided.** `AUTH_COOKIE_DOMAIN` is set to `.greenatetech.com`, and the IaC domains are `api.greenatetech.com` and `greenatetech.com` — one registrable domain. That is the same-site arrangement, which makes 1.2's `lax` default correct and its `AUTH_COOKIE_SAMESITE` question moot in practice. The API subdomain question is still listed under "Still open"; confirming it there is yours, and this entry only reports what the deployment shows.
- **Open: `production` holds no variables at all.** Not a regression — 0.5 recorded that production carries only the Postgres, with no `api` or `web` service — but it will need its own copies, with different secrets from development, before anything deploys there.
- **Open: the sending domain's verification in Resend is unconfirmed.** `EMAIL_FROM` is on `greenatetech.com`, which must be verified in Resend with SPF and DKIM. That lives in the Resend dashboard and cannot be checked from here. If it is not verified, 1.6 fails on every send despite correct configuration.
- **Open: `railway config plan` cannot run.** The pinned `railway` npm package at 3.11.0 asserts it needs CLI 5.42.1 or newer and does not recognise the installed 5.45.10, so the IaC file cannot be evaluated and an apply's effect cannot be previewed. Surfaced here, but it belongs to 0.5's tooling; worth fixing before the next deploy so plan output is trustworthy again.

### 1.6 Invitation and verification emails — **DONE**

- **Builds:** the guardian invitation email and the learner email-verification email, both deep-linking into the web app.
- **Files:** `apps/api/src/emails/templates/guardianInvitation.js`, `apps/api/src/emails/templates/emailVerification.js`, and the wiring in `apps/api/src/services/registrationService.js`. Also `apps/api/src/emails/templates/shell.js` — not listed, but two templates would have duplicated the layout and stage 8 adds eight more — and `apps/api/test/registrationEmails.test.js`. Changed `apps/api/src/services/invitationService.js` (the `email_verification` purpose and its issuer, D8's second flow on the same table, no migration), `apps/api/.env.example` (`EMAIL_VERIFICATION_TTL_DAYS`), and three existing suites: `test/guardianship.test.js` (one assertion scoped, see below), `test/registration.test.js` and `test/email.test.js`. Two further files came from the follow-up work in the same session: `apps/api/test/setup.js` and `apps/api/scripts/checkEmailDelivery.js`, with `apps/api/package.json` gaining `--import ./test/setup.js`.
- **Tables:** `email_log`, `users`.
- **Done when:** registering as a guardian-linked learner sends both emails, each recorded in `email_log`.
- **Depends on:** 1.4, 1.5.
- **Verified:** `npm test` runs 58 tests across 14 suites, **58 pass, 0 fail** — 9 new here. The done-when is asserted through the HTTP endpoint: a guardian-linked registration produces exactly two `email_log` rows, one `email_verification` against the learner with a null `entity_ref` and one `guardian_invitation` against the guardian scoped to the learner's id; a self registration produces only the first. Separately proven with a recording provider: both links carry tokens that actually redeem and then refuse a second use, so they are deep links rather than decorative URLs; both messages carry a plain-text half containing no markup; a learner name of `Ada <script>alert(1)</script>` arrives escaped; the stated expiry matches the token's real lifetime; no invitation is posted when the named guardian already has an account; and a provider outage still returns a registered account while writing no `email_log` row. `npm run lint` exits 0 with no errors or warnings; `npm run format:check` reports all matched files clean.
- **Verified against Resend, for real.** `apps/api/scripts/checkEmailDelivery.js` registered a learner with a live guardian address and both messages were accepted — `22f9363d-dbc6-4b70-9571-c4354df69b68` for the verification email and `c288a0b6-deb0-4b40-b2ba-fde0c3dff422` for the invitation — with two matching `email_log` rows, then deleted everything it created. This closes 1.5's open item: `greenatetech.com` is verified in Resend with a working key and sender. Note the limit of the claim: Resend accepting a message is not Gmail delivering it, and the final hop was not machine-checked.
- **Decided during the step — the copy was drafted and approved, not invented.** CLAUDE.md puts copy outside an engineering call, so both emails were drafted, shown, and approved before anything was written. One necessary deviation from the approved draft: the invitation no longer names a course. Registration happens before any enrolment exists — purchases and cohorts are stage 3 — so at the moment this sends there is no cohort to refer to, and the clause was dropped rather than filled with a guess.
- **Decided during the step — sending happens strictly after the commit.** Inside the transaction, a database lock would be held open for as long as the provider takes, and a message sent inside a transaction that then rolled back cannot be recalled. Both tokens are issued inside; both messages are posted after.
- **Decided during the step — a send failure does not fail the registration.** The account is committed by the time sending is attempted, and turning a provider outage into a 500 would send the learner back to a form that now rejects their address as taken. Failures are logged and swallowed. Because 1.5 records only sends that succeeded, a missing `email_log` row is exactly the signal a future resend would look for — the failure mode leaves the door open rather than locking it.
- **Decided during the step — the invitation's `entity_ref` is the learner's id, not null.** One guardian may be invited for two children (1.4 reuses the account and issues a second token). With a null entity, 1.5's guard would suppress the second invitation as a duplicate of the first, and the second child's guardian would never be asked to claim.
- **Decided during the step — the stated expiry is passed into the template.** The emails say "expires in 7 days" and read that number from the same constant the token's lifetime uses, so the words cannot drift from the mechanism. `EMAIL_VERIFICATION_TTL_DAYS` matches the confirmed seven days from 1.4.
- **Decided during the step — one shared shell, with escaping in it.** Every value a template interpolates into its `html` half is escaped: a learner's full name is user-supplied and would otherwise reach a guardian's inbox inside a markup rendering context. The shell is plain HTML with literal colours and one style block — `tokens.css` has no jurisdiction in email, where custom properties and external stylesheets are unreliable — single column, 44px tap target, sized for a phone.
- **Decided during the step — the deep link paths are fixed here.** `${WEB_ORIGIN}/claim?token=…` and `${WEB_ORIGIN}/verify?token=…`, matching the pages step 1.11 lists. The email has to name a URL now, so the paths are settled by this step and 1.11 must honour them.
- **A pre-existing test caught a real behaviour change.** `guardianship.test.js` asserted that an enabled guardian holds zero one-time tokens. That guardian now legitimately holds an `email_verification` token from their own registration, so the assertion was scoped to `purpose: GUARDIAN_INVITATION`, which is what it always meant.
- **A live-email hazard was introduced and then closed.** Because `registerLearner` now sends, the older suites began attempting delivery, and with real credentials in `.env` a test run would have posted live mail to invented addresses; it only failed safe because `EMAIL_FROM` happened to be empty. `test/setup.js` now pins every suite — present and future — via `--import`: the transport is forced to `console`, and the API key is replaced with a value that cannot authenticate, so even a suite deliberately selecting `resend` fails at Resend's door. Both locks **overwrite rather than delete**, because importing Prisma re-reads `.env` into `process.env` to find `DATABASE_URL` and resurrects anything deleted, while leaving already-set variables alone. A test asserts both locks are in force.
- **`scripts/checkEmailDelivery.js` is deliberately outside `test/`.** The test guard makes real delivery impossible, which is right for suites and wrong for confirming delivery works at all; this is the other half, run by hand. It wraps the real transport to capture the response, since registration swallows send failures by design. `railway run` alone is not enough: Railway injects the private database host, unreachable from a developer machine, so the header documents overriding `DATABASE_URL` with the public proxy.
- **Open: `production` still holds no variables.** Unchanged from 1.5, and now with more to copy — the email trio as well as the two secrets. Deploying there needs its own values, with different secrets from development.

### 1.7 Guardian claim flow — **DONE**

- **Builds:** token redemption endpoint that sets a password, activates the stub user, and burns the token.
- **Files:** `packages/schemas/claim.js`, `apps/api/src/services/invitationService.js` (the claim transaction, plus a `client` parameter on token resolution so it can run inside one), `apps/api/src/routes/auth.js` (`POST /auth/claim`, and later `POST /auth/invitation/resend`). D19 added `packages/schemas/invitation.js` and `resendGuardianInvitation` in `apps/api/src/services/guardianshipService.js`. Also `apps/api/test/claim.test.js`. Not listed but needed: `packages/schemas/password.js` — D16 extracted so the policy is defined once — with `packages/schemas/registration.js` now consuming it and `packages/schemas/index.js` re-exporting both, and the handler in `apps/api/src/controllers/authController.js`, since routes do not hold request handling in this codebase. No migration.
- **Tables:** `users`, invitation tokens.
- **Done when:** the invitation link lets the guardian set a password once; replaying it fails; an expired token fails.
- **Depends on:** 1.6.
- **Per D18:** the claim stamps `email_verified_at` inside the same transaction that burns the token, with the same timestamp. Redeeming a single-use link sent to that address is the proof verification asserts, and no guardian verification email exists or should be added.
- **Per D19, added after the step:** `POST /auth/invitation/resend` issues a fresh `guardian_invitation` token for a `pending` account holding at least one guardianship, and sends the same email. Without it that account had no route in — claiming needs a live token and the reset at 1.8 serves only `enabled` accounts. It answers identically whatever the address, and logs under its own type, `guardian_invitation_resend`, scoped to the token so a repeat request is never suppressed as a duplicate. **It depends on 1.9:** unthrottled it posts mail to any address a caller names, and rate limiting is not built here.
- **Verified:** `npm test` runs 94 tests across 23 suites, **94 pass, 0 fail** — 18 from this step, 12 for the claim itself and 6 added with D19. The token under test is pulled out of the invitation email's own link rather than read from the database, so what is exercised is the link a guardian actually receives. Each clause of the done-when is a direct assertion. **Once:** the claim returns 200, `status` moves `pending` to `enabled`, the stored hash verifies against the chosen password, and two simultaneous claims produce exactly one winner. **Replaying fails:** 422 with a field-level error on `token`, and the first password still stands while the second does not — with the row burned rather than deleted, `consumed_at` stamped per D8. **An expired token fails:** 422, and the stub is left `pending` with a null password hash. Also covered: an unknown token is refused without being named as unknown, a password below D16's floor is rejected, a missing token and missing password each report per field, a rejected password does **not** burn the token, and D18's stamp equals the token's `consumed_at` to the millisecond rather than merely being present. D19 is covered end to end: an invitation is expired in place, the original link is confirmed dead, a resend issues a working one, and claiming through it still activates the account and stamps `email_verified_at` per D18. Also covered: two resends both send and log under distinct entity references while the original automatic invitation stays a separate row; nothing is sent or minted for an `enabled` account or for a `pending` account with no guardianship; and the endpoint answers byte-identically for a pending, an enabled and an unknown address. All rows deleted afterwards; `users`, `one_time_tokens` and `email_log` confirmed back to zero. `npm run lint` exits 0 with no errors or warnings; `npm run format:check` reports all matched files clean.
- **Decided during the step — only a `pending` account can be claimed.** This is not defensive padding. A guardian named for two learners before claiming holds two live tokens, because 1.4 issues one per learner. After the first claim the second is still unconsumed and unexpired, and without this check presenting it would set a new password on an active account from a week-old email link, with no old password required — a password reset wearing an invitation's clothes, and resets belong to 1.8. Tested as its own case: two learners, two tokens, the second refused once the first has been used.
- **Decided during the step — D16 moved into `packages/schemas/password.js`.** Three flows set a password: registration at 1.3, this claim, and the reset at 1.8. A policy written out three times is a policy that will differ in one of them, so the field is defined once and imported. `registration.js` was changed to consume it, which is a refactor rather than a behaviour change — its existing tests pass untouched.
- **Decided during the step — the key derivation happens before the transaction opens.** scrypt is deliberately slow, and holding a database transaction across it would hold its locks for the whole derivation. The hash is computed first; the transaction then resolves, checks eligibility, burns and updates.
- **Decided during the step — token resolution takes an optional transaction client.** `resolveOneTimeToken` and `redeemOneTimeToken` now accept one, defaulting to the shared client, so the burn and the password write commit together. A claim that failed halfway would otherwise leave the token spent and the guardian locked out of an account they now own.
- **Decided during the step — one message for every way a token can fail.** Unknown, expired, already consumed, account no longer eligible: all return the same field-level error. The distinction is of no use to the person holding the link, and naming it would tell a stranger which of those they have. The same reasoning `resolveAuthSession` follows at 1.2.
- **Decided during the step — a rejected password does not burn the token.** Validation runs before the transaction, so a mistyped or too-short password cannot cost the guardian their one chance to claim. Tested by failing a claim and then succeeding with the same link.
- **Decided during the step — no auth session is issued on claim.** Logging in is 1.8's, and the claim page sends the guardian to sign in with the password they have just set.
- **Note on numbering: there is no D17.** The decisions section runs D1 to D16, then D18 and D19, both taken against this step after it was built. The gap is deliberate only in the sense that it was not filled; worth renumbering or filling before it looks like a lost decision.

### 1.8 Login, logout, current user, password reset — **DONE**

- **Builds:** login issuing an auth session cookie, logout revoking it, a `/me` endpoint resolving role standing, and the password-reset request and completion pair.
- **Files:** `apps/api/src/routes/auth.js`, `apps/api/src/controllers/authController.js`, `apps/api/src/services/passwordResetService.js`, `apps/api/src/emails/templates/passwordReset.js`. Also `apps/api/test/session.test.js`. Not listed but needed: `apps/api/src/services/authService.js`, holding credential verification and standing derivation so the controller does not reach into Prisma; `packages/schemas/login.js` and `packages/schemas/passwordReset.js`, since 1.11's forms bind to the same definitions the boundary validates; and `packages/schemas/index.js` re-exporting them. Changed `apps/api/src/services/invitationService.js` (D8's third purpose, `password_reset`, and the shared issuer generalised from days to milliseconds so an hour-scale lifetime is expressible), `apps/api/src/repositories/authSessionRepository.js` and `apps/api/src/services/authSessionService.js` (an optional transaction client on revocation), and `apps/api/.env.example` (`PASSWORD_RESET_TTL_HOURS`). No migration.
- **Tables:** `users`, `auth_sessions`, `email_log`.
- **Done when:** login sets the cookie; `/me` returns the user with `is_admin` and derived learner/guardian standing; logout makes the cookie useless immediately.
- **Depends on:** 1.7.
- **Verified:** `npm test` runs 94 tests across 24 suites, **94 pass, 0 fail** — 18 of them from this step. Driven over HTTP with the `Set-Cookie` header fed back in, so what is exercised is the cookie a browser would actually hold. **Login sets the cookie:** the response carries `HttpOnly`, `SameSite=Lax` and `Path=/`, the cookie value is the raw token while `auth_sessions` holds only its hash, and the body omits the password hash. **`/me` returns the user with `is_admin` and derived standing:** an admin reads `isAdmin: true`, and `standing.guardian` is derived from a real `guardianships` row — with the learner on the other side of that row correctly reading `false`, which is rule 6 in miniature. **Logout makes the cookie useless immediately:** 204, and the same cookie is refused on the very next request, with the row revoked rather than deleted. Also covered: a wrong password and an unknown address return byte-identical 401s and no cookie; `suspended` and `pending` accounts are refused; the reset pair answers identically for known and unknown addresses, sets the new password, burns the link, kills every pre-existing session, refuses an expired link, sends nothing for an account that is not `enabled`, records each request separately so a second can be asked for, and does not burn the link when the new password fails D16. All rows deleted afterwards; `users`, `one_time_tokens` and `email_log` confirmed back to zero on a clean-then-run check. `npm run lint` exits 0 with no errors or warnings; `npm run format:check` reports all matched files clean.
- **Decided during the step — login answers identically for a wrong password and an unknown address, and costs the same either way.** One 401, one message. A missing account also runs a real scrypt derivation against a constant hash nobody holds, because otherwise "no such user" returns in microseconds while a wrong password takes around a hundred milliseconds, and that gap turns the endpoint into a register of who has an account here.
- **Decided during the step — completing a reset revokes every live auth session.** A reset is what someone does when they believe their password is known to somebody else; leaving existing sessions alive would leave that somebody logged in. CLAUDE.md rule 5 is what makes this possible at all — under JWTs those sessions would outlive the reset. The revocation runs inside the same transaction that writes the password.
- **Decided during the step — each reset request logs against its own token, not a null entity.** A learner who loses the first email must be able to ask again, and a null `entity_ref` would let 1.5's duplicate-send guard suppress every request after the first, permanently. Tested: two requests, two sends, two distinct entity references.
- **Decided during the step — only an `enabled` account can reset**, checked when the link is issued and again when it is redeemed, so an account suspended in the hour between cannot use one already sent. A `pending` stub has an invitation to claim instead, and a `suspended` account should not be handed a way back in.
- **Decided during the step — logout is not behind `requireAuth`, and answers 204 always.** Presenting a cookie that has already lapsed should still clear it rather than answer 401: the caller's intent is satisfied either way. No session is issued on completing a reset either, since that would hand a fresh session to whoever holds the link, immediately undoing the revocation above it.
- **Decided during the step — the login schema checks the password's presence, not D16's rules.** Login verifies a password that already exists. Applying the policy there would reject a correct password if the policy ever tightened, telling the holder their password is wrong when it is the rules that changed. The reset schema does apply D16, because that is a password being set.
- **Decided during the step — the reset link lasts one hour**, against the invitation's seven days. A reset changes the credentials of an account that already works, where an invitation only opens one that never has. Implemented as a marked default with `PASSWORD_RESET_TTL_HOURS`; no document sets one.
- **Reported before building, and unresolved by this step: `standing.learner` has nothing to derive from.** The done-when asks for derived learner and guardian standing, and architecture §4.7 derives both from `enrollments` and `guardianships`. `guardianships` exists, so guardian standing is real. `enrollments` does not exist until step 3.1, which sits behind all of stage 2. The field is therefore structurally present and always `false`, produced by a single named function in `authService.js` with the enrollment count as its one commented seam, and a test pins the current value so 3.1 has to change it deliberately. The alternative — omitting the field until 3.1 — would have failed this step's done-when as written and changed `/me`'s shape under 1.11 later.
- **A unit bug was introduced and caught by existing tests.** Generalising the shared token issuer from days to milliseconds, one call site kept passing `7`, so every email-verification token expired seven milliseconds after issue. Two tests from 1.6 and 1.7 failed on it. A `token lifetimes` suite now pins all three purposes to their real windows, so a unit mismatch fails as itself rather than as a puzzling expiry somewhere downstream.
- **Three test suites were made idempotent.** The expired-token cases used constant token strings, which hash to constant values under a unique index — so a single row left by any failed run broke the next. Now suffixed per run. Separately, 19 rows once seen surviving a green run turned out to come from a background run killed mid-flight rather than from faulty teardown; confirmed by cleaning, re-running the full suite, and finding zero.
- **Closed by D19: the pending-stub dead end.** This step's reset serves only `enabled` accounts, which left a guardian whose invitation had expired with no route in at all. D19 added the resend endpoint against 1.7 and closes it.
- **Open: `production` still holds no variables.** Unchanged since 1.5, and this step adds `PASSWORD_RESET_TTL_HOURS` to what a production deploy will need.

### 1.9 Rate limiting — **DONE**

- **Builds:** rate limits on registration, login, password reset, the guardian claim, the invitation resend (`POST /auth/invitation/resend`), and later the payment endpoints.
- **Files:** `apps/api/src/middleware/rateLimit.js` (the limiter, plus the five configured instances), applied in `apps/api/src/routes/auth.js`. Also `apps/api/test/rateLimit.test.js`. Not listed but needed: `apps/api/src/app.js`, for `trust proxy` — behind Railway's edge the client address only reaches the app through `X-Forwarded-For`, and untrusted every request appears to come from the proxy, so the first limiter to fire would lock out every learner at once. `apps/api/.env.example` gained `TRUST_PROXY` and the window and maximum for each limiter, and `apps/api/test/setup.js` raises the maxima out of the way for every other suite. No migration.
- **Tables:** none. The store is in memory.
- **Done when:** repeated login attempts from one address are refused with 429 and the limit resets on schedule.
- **Depends on:** 1.8.
- **Added after D19:** the resend endpoint is not in this step's original scope because it did not exist when the step was written. It needs a limit more than most of this list: it is unauthenticated and it sends email, so without one it will post mail to any address a caller names, as fast as they can ask.
- **Verified:** `npm test` runs 102 tests across 27 suites, **102 pass, 0 fail** — 8 new here. The done-when is one test end to end: three login attempts reach the credential check and fail 401, the fourth returns 429 carrying `Retry-After`, the shared error envelope and a `retryAfter` in the body — and then a **correct** password is refused too, with no cookie set, which is what makes this a limit rather than a slow failure. After the window lapses the same account logs in and receives a cookie. Also covered: a second account on the same address is unaffected while the first is locked out; `RateLimit-Limit` and `RateLimit-Remaining` report the budget on every response; the per-recipient bucket is shared between password reset and the invitation resend, so rotating the endpoint does not lift it, while a different recipient is unaffected. Four unit cases pin the limiter's own arithmetic against a stub response: exactly the configured number passes, separate keys hold separate budgets, a window starts fresh once the old one lapses, and a null key skips the request rather than silently collapsing everything into one bucket. All rows deleted afterwards; `users` confirmed back to zero. `npm run lint` exits 0 with no errors or warnings; `npm run format:check` reports all matched files clean.
- **Decided during the step — written rather than installed.** `express-rate-limit` is the obvious reach, but a fixed window is a counter and an expiry, and this codebase has held a dependency-free line wherever the platform already provides the primitive: no dotenv, no morgan, no cookie-parser, no test framework, no Resend SDK.
- **Decided during the step — two layers, because two different risks share this router.** Login and the claim are guessing attacks, where the limit protects one account. Password reset, the invitation resend and registration send email to an address the caller supplies, where the limit protects the recipient and the sending reputation. A generous per-address limit sits under the whole router to stop bulk abuse; the sensitive routes carry a tighter targeted limit on top. One limiter tuned for either would be wrong for the other.
- **Decided during the step — login is keyed on the address **and** the email.** Nigerian mobile networks put whole cohorts behind one carrier-grade NAT address. A per-address login limit would mean one learner mistyping a password locks out everyone else on the same carrier, and it would look exactly like an outage rather than a limit. The per-address layer is deliberately loose for the same reason; the per-account layer is what actually stops password guessing.
- **Decided during the step — the mail endpoints are keyed on the recipient, and share one bucket.** Password reset and the invitation resend post the same kind of message to the same person, so counting them together is what bounds how much mail one address can be made to receive. Keying on the target rather than the source also means rotating the caller does not lift the bound.
- **Decided during the step — `/logout` and `/me` carry only the address layer.** Both are cheap, and throttling logout would leave someone unable to end a session they want ended, which is the opposite of what a limit is for.
- **Decided during the step — `trust proxy` is a hop count, not `true`.** Trusting the whole chain lets a caller prepend any address to `X-Forwarded-For` and sidestep the limit entirely. Read from `TRUST_PROXY`, and unset locally where nothing sits in front.
- **Decided during the step — configuration is read per request, not at construction.** It costs one environment lookup and it means a test can lower a limit without re-importing the module. Each limiter also carries a `reset()` used only by tests to clear counters between cases; nothing in the application calls it.
- **Decided during the step — a null key skips the request.** A targeted limiter given a request with no target must not fall back to counting everything in one bucket, which would silently turn a per-account limit into a per-address one. Pinned by its own test.
- **A test flaw, not a limiter flaw, cost two failures.** The first window was 400ms, but each login costs a scrypt derivation plus a round trip to a remote database — roughly half a second — so the window expired between attempts and the counter never accumulated. The window is now five seconds and the reset is waited out from when it actually opened rather than for a fixed pause, so a slow round trip cannot make it flake.
- **Open: `TRUST_PROXY` must be set to `1` in Railway.** Unset in production, every request appears to come from Railway's edge and the address layer locks out all learners at once. It is documented in `.env.example`, but Railway variables are set separately — and `production` still holds none at all.
- **Open: the store is per-process and in memory.** Counters reset on every deploy, and if the API is ever scaled past one replica each instance enforces its own share of the limit. Railway runs one today. Moving the store to Postgres or Redis is a change to `rateLimit.js` alone — nothing above it knows where the counters live.
- **Open: the thresholds are engineering defaults**, all overridable by environment. The one worth a second look is `RATE_LIMIT_EMAIL_MAX`, five per hour per recipient, which also bounds how often a guardian can ask for a fresh invitation under D19.

### 1.10 First shared elements — **DONE**

- **Builds:** the element layer stages 1–10 all reuse: Button, Input, Select, Field, Card, Badge, Toast. Semantic tokens only; 44px minimum touch targets; visible focus rings.
- **Files:** `apps/web/components/elements/Button/`, `Input/`, `Select/`, `Field/`, `Card/`, `Badge/`, `Toast/`, each holding a `.js` and its `.module.css`. Also `apps/web/app/elements/page.js` and `page.module.css` — the scratch page the done-when requires, and a development surface rather than a product route. Changed `eslint.config.js`, which gained `eslint-plugin-react` for one rule (see below), plus `package.json` and `package-lock.json`. No migration.
- **Tables:** none.
- **Done when:** a scratch page renders all of them in light and dark, and the stylelint primitive guard from 0.4 passes across the whole directory.
- **Depends on:** 0.4.
- **Per D2:** this is the `elements` layer. `Rail` joins it at 3.5, when the first consumer exists.
- **Per D14 — the shape tokens these elements use.** Button, Input and Select take `--control-radius`. Card takes `--surface-radius` and `--elevation-raised`. Badge takes `--pill-radius`. Modal, when it arrives, takes `--surface-radius-lg` and `--elevation-overlay`; Toast takes `--surface-radius` and `--elevation-floating`. None of them may reach for `--radius-*` or `--shadow-*`, which the guard still refuses. Spacing and type come from `--space-*` and `--size-*` directly, per D13.
- **Verified:** `next build` compiles clean and prerenders `/elements` as static. All seven elements appear in both panels of the prerendered HTML, and the dark panel carries `data-theme="dark"` — whose override block is present in the compiled CSS, redeclaring the token layer for that subtree. The primitive guard was checked twice over, on source and on output: `npm run lint` (ESLint then stylelint) exits 0, and the compiled bundle separates cleanly — the component chunk carries 56 hashed module classes and **zero** primitive reads, while all 69 sit in the token chunk that declares `:root`, which is exactly the layering D13 describes. `npm run format:check` reports all matched files clean. The API suite is unaffected at 104 passing.
- **Not verified in a browser.** `next start` still cannot run in this environment — the sandbox denies `os.networkInterfaces()`, as recorded at 0.4 — so "renders in light and dark" rests on the prerendered HTML and the compiled CSS rather than on pixels. Worth one look on a real device, alongside the naira rendering 0.4 left in the same position.
- **Decided during the step — the reference could not be copied.** `design-system.html` is the stated reference and it reaches for primitives directly: `--green-950`, `--slate-400`, `--radius-sm`, `--shadow-sm`. That is legal in that file and banned in a component, so each was translated to the semantic token naming the same job — `--action-accent-text`, `--text-muted`, `--control-radius`, `--elevation-raised`. The visual result matches; the layer it is expressed in does not.
- **Decided during the step — Card lifts to `--elevation-floating`, not `--elevation-overlay`.** The reference lifts to `--shadow-lg` on hover, whose semantic name is the overlay level, and D14 has already spoken for that with modals. Floating is the right rung for a surface that has risen but is still in the page. Only a card marked `interactive` lifts at all: a static card that rises under the cursor promises a click that is not there.
- **Decided during the step — Field takes its control as a function, not as a prop.** It passes down `id`, `aria-describedby` and `invalid`, and the caller renders an Input, a Select, or anything else that accepts them. The wiring is the reason: a label needs `for`, an error needs announcing rather than only showing, and the ids must agree. Done by hand at twenty call sites it will be wrong at one of them, so it is done once. An error **replaces** the hint rather than joining it — two messages under one input is a choice for the reader to make at the moment they are least able to make it.
- **Decided during the step — Badge takes exactly four states, and falls back to the strictest.** CLAUDE.md permits no fifth, so an unrecognised value renders as `locked` rather than unstyled: a bad input should show less than it should, never more. The component speaks the visual vocabulary only; whatever maps an enrollment row onto it does so server-side, per D1.
- **Decided during the step — Toast adds no fifth state.** A toast reports what just happened, not where a learner has got to, so it is not a domain state at all. Its two coloured tones borrow the existing `done` and `overdue` tokens and everything else is neutral, which leaves the platform publishing exactly four. `role="alert"` is used only for a failure; `alert` preempts whatever a screen reader is saying, which is right for an error and rude for a confirmation.
- **Decided during the step — nothing is marked `'use client'`.** None of these hold state or call a hook, so each renders in a server component and inherits the client boundary of any consumer that passes a handler. The performance budget is the reason to care: a visitor reading the portfolio must not download an interactivity runtime for a Card. The consequence is that the scratch page, being a server component, cannot demonstrate Toast's optional dismiss — the element renders, its handler path does not.
- **Decided during the step — the native `<select>` stays.** A custom listbox would need its own focus management, keyboard handling and mobile behaviour, and would still be worse on an Android phone than the picker the learner already knows.
- **Decided during the step — smaller shapes, recorded so they are not re-litigated.** Button defaults `type="button"`, because a bare button inside a form submits it silently; that footgun is closed once here rather than at every call site. Button has no size prop — 44px is the floor and no case yet needs more, and guessing at a second size would put an untested shape in every screen. The outline variant uses an inset shadow rather than a border, so filled and outlined buttons are the same box and nothing shifts when one replaces the other. Card takes children rather than a title and body, because a card that prescribes its contents accretes props until it prescribes nothing. Every transition is dropped under `prefers-reduced-motion`.
- **Decided during the step — `eslint-plugin-react`, for one rule.** These are the first JSX files in the repository, and without `react/jsx-uses-vars` ESLint cannot see that `<Button />` is a reference to `Button`, so every component imported for use in JSX reports as unused. Parsing JSX and understanding it are separate things and `ecmaFeatures.jsx` only does the first. Nothing else from the plugin is enabled: its recommended set carries opinions about prop-types and React versions this project has not taken a position on.
- **Decided during the step — CSS module classes are kebab-case.** `stylelint-config-standard` enforces it, and the alternative was an override in 0.4's config to permit camelCase. Multi-word classes are read from the styles object by key rather than by property, which is slightly noisier in the JSX and keeps the shared config untouched.
- **Open: the scratch page is a development surface.** It is not linked from anywhere and carries `robots: noindex`, but it is a real route that renders. Step 9.5 excludes authenticated routes from indexing; this one should be deleted or gated when 1.11's real screens land.

### 1.11 Auth screens

- **Builds:** registration with progressive disclosure of the guardian fields, login, email verification landing, guardian claim, password reset — all in `(app)` or an `(auth)` segment.
- **Files:** `apps/web/app/(app)/register/page.js`, `login/page.js`, `verify/page.js`, `claim/page.js`, `reset/page.js`, `apps/web/lib/api.js`, `apps/web/lib/queryClient.js`.
- **Tables:** none directly.
- **Done when:** you can register on a phone as a learner with a guardian, receive both emails, claim the guardian account, verify the learner, and log in as either.
- **Depends on:** 1.9, 1.10, and **1.12**, which is numbered after this step but built before it. Per D21 the screens here call an email-verification endpoint that did not exist and require CORS that the API did not set.

### 1.12 Email verification and CORS

- **Builds:** the endpoint that redeems an `email_verification` token and stamps `email_verified_at`, and cross-origin access with credentials for the web origin.
- **Files:** `apps/api/src/services/verificationService.js`, `apps/api/src/middleware/cors.js`, `packages/schemas/verification.js`, wiring in `apps/api/src/routes/auth.js`, `apps/api/src/controllers/authController.js` and `apps/api/src/app.js`.
- **Tables:** `users`, `one_time_tokens`.
- **Done when:** a verification link stamps `email_verified_at` once and a replay fails; a browser served from `WEB_ORIGIN` can call the API with credentials and read the response, and an origin that is not `WEB_ORIGIN` cannot.
- **Depends on:** 1.6 for the token and the email, 1.8 for the pattern the redemption follows.
- **Per D21:** this step exists because 1.6 emails a verification link that nothing could redeem, and because no step had been assigned CORS. Both were found when 1.11 was read against the API's actual surface.
- **Per D8:** the third and last purpose on `one_time_tokens`. No migration — the table, its hashing and its consumed marker already serve the guardian invitation and the password reset.
- **Per D20:** the CORS allowlist is a security boundary, so it defaults closed. An unset `WEB_ORIGIN` refuses every cross-origin request rather than permitting all of them, and `*` is in any case invalid alongside credentials.
- **Follow the redemption shape 1.7 and 1.8 already set:** resolve, check eligibility, burn and write in one transaction; return one indistinguishable failure for unknown, expired and already-consumed; and do not let a rejected request burn the token.
- **Note on rate limiting:** 1.9's `claimLimiter` covers token-redemption routes and should cover this one too, keyed on address, since a verification link carries no email address to key on.

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
