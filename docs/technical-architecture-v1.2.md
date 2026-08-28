# Technical Architecture

**Frontend and backend specification — portfolio website with LMS module**
Prepared for Iyiola · Version 1.2 · Companion to the Product Concept Brief v1.2
Supersedes v1.1 of 27 August 2026

> **Authority.** `CLAUDE.md` at the repository root overrules this document.
> Changes from v1.1 are listed in section 9.

---

## 1. System overview

Two deployable applications sharing one PostgreSQL database, in one repository
with npm workspaces. The frontend is a Next.js application serving three route
groups; the backend is a standalone Express API. Both are JavaScript, both
deploy to Railway.

```
Browser
 |
 |--> Next.js app  @platform/web   (marketing / learner app / admin)
 |      |
 |      '--> Express API  @platform/api  ----> PostgreSQL
 |             |            |                    |
 |             |            |                    '--- node-cron scheduler
 |             |            '--- Resend / Postmark (email)
 |             '--- Paystack / Flutterwave (webhooks)
 |
 '--> YouTube IFrame Player (recordings, unlisted)
```

`@platform/schemas` holds Zod schemas imported by both tiers, so validation
cannot drift between a form and the endpoint it posts to.

**Why a separate API rather than Next.js route handlers.** Scheduled work is
central to this product — dunning reminders, grace-period expiry, automatic
suspension, and access-expiry notices all require a persistent process running
cron. A standalone Express service provides that directly. It also means the
version 2 mobile application has an API to consume without extracting logic
from the web layer first.

---

## 2. Frontend architecture

### 2.1 Decisions

| Concern | Decision |
|---|---|
| Framework | Next.js, App Router, single codebase |
| Structure | Route groups: `(marketing)`, `(app)`, `(admin)`, each with its own layout |
| Styling | CSS Modules consuming `tokens.css`. CSS custom properties remain the single source of truth. |
| Server state | TanStack Query — caching, refetching, revalidation after payment webhooks |
| Client state | React Context. Zustand only if it outgrows context. |
| Auth transport | httpOnly session cookie. No tokens in localStorage. |
| Forms | React Hook Form with schema validation shared with the API |
| Video | YouTube IFrame Player API, enabling watch-progress tracking |
| Component layers | tokens → **elements** → composites → features |

### 2.2 Route groups and rendering

| Route group | Contents | Rendering |
|---|---|---|
| `(marketing)` | Portfolio, about, services, course catalogue, client enquiry form, interest list sign-up | Static; catalogue uses revalidated static generation because cohort dates change |
| `(app)` | Learner dashboard, cohort schedule, class sessions, resources, assignments, gradebook, PaymentRail, guardian views | Server-rendered behind an authenticated session |
| `(admin)` | Course and cohort management, resource upload, grading, attendance, payment exceptions, lead pipeline | Client-rendered only. No SEO requirement. |

SEO matters only for the marketing group. Course pages must be indexable;
nothing behind authentication needs indexing.

### 2.3 Component layers

| Layer | Examples | Location |
|---|---|---|
| Tokens | Colours, spacing, type scale, radii — the CSS custom properties | `apps/web/styles/tokens.css` |
| Elements | Button, Input, Select, Field, Card, Badge, Modal, Table, Toast, Rail | `components/elements/` |
| Composites | PaymentRail, ClassSessionCard, TrancheGroup, GradeRow, AssignmentPanel, LearnerSwitcher | by feature |
| Features | LearnerDashboard, GuardianDashboard, CohortSchedule, AdminGradebook, LeadInbox | by feature |

**"Primitive" means a raw token value and nothing else.** v1.1 used it for the
Button/Input layer, colliding with the design system's rule that components
never reference a primitive. That layer is `elements`.

Elements live in one shared directory. Everything above them lives with the
feature it serves: `components/payments/`, `components/lms/`,
`components/guardian/`, `components/marketing/`, `components/admin/`.

`Rail` is an element, not a composite — it carries the motif and no domain
knowledge, and three unrelated features consume it: tranche progress, the
portfolio project timeline, and the payment schedule.

### 2.4 The PaymentRail

- A vertical stepped rail. Each instalment is a **knot**; the line between knots is a rendering detail of the rail and is not separately named.
- Knot states: `done`, `active`, `locked`, `overdue`.
- Clicking a knot opens the payment view for that instalment.
- **State is server-derived, never computed in the browser.** After a webhook lands, the query is invalidated and the rail refetches.
- Reminder emails deep-link directly to this page.
- Overdue knots use `--state-overdue-rail`, added to `tokens.css` in v1.2.

### 2.5 The client-side security rule

Locked content is greyed in the interface, but **the payload must contain no
resource identifiers for it.** The server decides entitlement and omits video
identifiers, resource URLs, and meeting links for any class session the learner
has not paid for. A component that receives the identifier and merely hides it
exposes the entire course to anyone who opens developer tools.

Practically, this means one serialiser that takes the entitlement result and
*builds* the response, never a full serialisation that a later step strips.

### 2.6 Performance constraints

- Learners are predominantly on Android phones over metered mobile data. Mobile-first layouts throughout.
- Aggressive code splitting between the marketing and application bundles — a visitor reading the portfolio should never download the dashboard.
- No video autoplay. Playback must be user-initiated.
- Optimise and size all imagery; set a bundle budget and check it before each deploy.
- A stylelint rule refuses primitive custom properties inside component directories. `tokens.css` is exempt.

---

## 3. Backend architecture

### 3.1 Decisions

| Concern | Decision |
|---|---|
| Runtime | Node.js with Express, deployed as a standalone persistent service |
| Structure | routes → controllers → services → repositories → database |
| Database | PostgreSQL |
| ORM | Prisma |
| Money | Integers in kobo. Never floating point. |
| Auth sessions | Database-backed session tokens, not JWTs |
| Validation | Zod schemas at the route boundary, shared via `@platform/schemas` |
| Scheduling | node-cron in the API process |
| Email | Resend or Postmark, with SPF and DKIM configured — **not yet chosen** |
| Media | YouTube unlisted, behind a provider abstraction |

### 3.2 The EntitlementService

One service answers a single question: can this user access this resource right
now? Every content endpoint and every video-identifier lookup calls it. If this
logic is duplicated across controllers, one of them will eventually diverge and
leak.

```
canAccess(user, classSession) ->
  1. an enrollment exists linking user to classSession.cohort
  2. enrollment.status is 'enrolled' or 'completed'
  3. now() < enrollment.expires_at
  4. classSession.tranche is covered by instalments paid

  all four true -> return resource identifiers
  any one false -> return metadata only, locked: true
```

Condition 2 said `active` in v1.1. That was wrong.

### 3.3 Authentication and authorisation

- Database auth sessions, not JWTs. A JWT remains valid until it expires, so a learner suspended for fraud would keep access until the token lapsed. Database-backed tokens are revocable immediately.
- Token stored in an httpOnly, secure, SameSite cookie. Only the hash is stored at rest.
- Roles resolve per request: learner, guardian, admin.
- Guardian access is relationship-scoped, not role-scoped. Every guardian read verifies that a guardianship row links the requester to the subject.
- Rate-limit authentication, registration, and payment endpoints.

### 3.4 Payment webhooks

Three rules, all mandatory:

- **Verify the signature.** Both Paystack and Flutterwave sign webhook payloads. Reject anything unsigned or mismatched.
- **Be idempotent.** Gateways retry on failure. A unique constraint on the gateway transaction reference prevents a replayed webhook crediting the same instalment twice.
- **Never trust the browser callback.** The post-payment redirect is a user-interface hint only. Confirm by webhook, and re-verify server-to-server against the gateway before unlocking a tranche.

Record a payment and unlock its tranche inside a single database transaction.
Maintain an append-only payment audit log capturing who paid, when, the gateway
reference, and who confirmed or reversed it — the fraud and appeals flow depends
on this record.

### 3.5 Scheduled jobs

| Job | Frequency | Action |
|---|---|---|
| Instalment reminders | Daily | Find instalments 7, 3 or 1 days from due, or due today; send notices |
| Overdue sweep | Daily | Find instalments past the grace period; move enrollment to `suspended` and notify |
| Expiry warnings | Daily | Find entitlements expiring in 7 days or 1 day; send notice and prompt the next cohort |
| Completion | Daily | Where the final class session has passed and all instalments are paid, move to `completed` and set `expires_at` |
| Expiry sweep | Daily | Move enrollments past `expires_at` to `expired`; retain records and grades |
| Class session reminders | Hourly | Notify cohorts of class sessions starting in 24 hours or 1 hour |
| Guardian summary | Weekly | Digest of a linked learner's progress, submissions and payment position |

Every job checks `email_log` before sending. node-cron inside the API process is
sufficient at this scale; introduce BullMQ with Redis only when job volume or
retry semantics demand it.

**Reinstatement.** A suspended learner who settles is restored to `enrolled`
with the **remainder** of the original access window. `expires_at` is not reset.

### 3.6 Media handling

- Recordings are uploaded to YouTube as unlisted videos for version 1.
- The Resource entity carries `provider` (`youtube` / `r2` / `vimeo`) and `external_ref`. This abstraction makes a future migration a data change plus one provider handler.
- **Unlisted is not private.** The URL is the only barrier. A learner who saves a link retains it beyond expiry and can share it. Accepted version 1 tradeoff.
- Risk is bounded because recordings are per-cohort.
- Ads may appear on embedded videos even on a non-monetised channel.
- Keep master recordings backed up off-platform.
- Migrate to Vimeo or Cloudflare Stream when evergreen self-paced courses are sold. Domain-level privacy is the specific feature being purchased.

---

## 4. Database plan

PostgreSQL through Prisma. The data is relational and financial, and
transactional integrity is required when a webhook must record a payment and
unlock a tranche as one atomic operation.

### 4.1 Identity

| Table | Columns |
|---|---|
| `users` | id, email, phone, full_name, password_hash, email_verified_at, status, is_admin, created_at |
| `auth_sessions` | id, user_id, token_hash, expires_at, revoked_at, user_agent, created_at |
| `guardianships` | id, guardian_id, learner_id, relationship, created_at — unique on (guardian_id, learner_id) |
| `one_time_tokens` | id, user_id, purpose, token_hash, expires_at, consumed_at, created_at — unique on token_hash |

`users.status`: `pending` · `enabled` · `suspended`. Email verification is not a
status; `email_verified_at` carries it.

`one_time_tokens.purpose`: `guardian_invitation` · `email_verification` ·
`password_reset`. One table rather than three near-identical mechanisms that
would diverge on the fourth.

### 4.2 Catalogue

| Table | Columns |
|---|---|
| `courses` | id, slug, title, summary, description, base_price_kobo, is_published, created_at |
| `cohorts` | id, course_id, name, starts_on, ends_on, capacity, price_kobo, status, whatsapp_url |
| `tranches` | id, cohort_id, position, title |
| `class_sessions` | id, cohort_id, tranche_id, position, title, scheduled_at, duration_minutes, meeting_url, status |
| `resources` | id, class_session_id, title, kind, provider, external_ref, position |

`cohorts.status`: `draft` · `open` · `running` · `completed`.
`resources.kind`: `recording` · `slides` · `code` · `reading`.

### 4.3 Commerce

| Table | Columns |
|---|---|
| `purchases` | id, user_id, course_id, total_kobo, currency, created_at |
| `instalments` | id, purchase_id, position, amount_kobo, due_on, status, paid_at |
| `transactions` | id, instalment_id, gateway, gateway_reference (unique), amount_kobo, status, paid_by_user_id, raw_payload, created_at |
| `payment_audit_log` | id, actor_id, entity, entity_id, action, notes, created_at — append-only |

`instalments.status`: `unpaid` · `paid` · `cancelled`. Nothing else is stored —
see 4.7.

### 4.4 Enrollment

| Table | Columns |
|---|---|
| `enrollments` | id, user_id, cohort_id, purchase_id, status, enrolled_at, completed_at, expires_at — unique on (user_id, cohort_id) |

### 4.5 Learning

| Table | Columns |
|---|---|
| `assignments` | id, class_session_id, title, brief, opens_at, due_at, max_score, status |
| `submissions` | id, assignment_id, user_id, content, file_ref, submitted_at, is_late, score, feedback, graded_by, graded_at — unique on (assignment_id, user_id) |
| `attendance` | id, class_session_id, user_id, status, marked_by, marked_at |
| `class_session_progress` | id, user_id, class_session_id, watched_seconds, completed_at |

`attendance.status`: `present` · `absent` · `late`. An unmarked class session
has no row, so there is no `unmarked` value.

The unique constraint on `submissions` reflects the decision that resubmission
updates in place. If attempt history is later wanted, an attempts table is an
additive migration.

### 4.6 Marketing and operations

| Table | Columns |
|---|---|
| `leads` | id, name, email, phone, project_type, budget_range, timeline, message, status, created_at |
| `interest_list` | id, course_id, email, name, phone, created_at |
| `email_log` | id, user_id, type, entity_ref, sent_at |

### 4.7 Design decisions

- **Name the session collision away.** `auth_sessions` and `class_sessions` from the first migration. Renaming later touches every query. Nothing is ever named `session` unqualified.
- **Tranche unlock is computed, never stored.** No `is_unlocked` column. A tranche at position N is open when the learner has N instalments paid.
- **Instalment status stores only the payment fact.** `due`, `upcoming` and `overdue` are derived from `due_on` against `now()`. Storing them would require a cron job to flip them, and the column would lie between runs. This is the tranche-unlock argument one table over.
- **Capacity-full is computed.** `count(enrollments) >= cohorts.capacity`. A stored flag drifts the moment someone defers out.
- **Completion is a stored fact; progress is derived.** `class_session_progress.watched_seconds` accumulates; a class session counts as watched at 90% of `duration_minutes`. `completed_at` is stamped once and never unset.
- **Instalment position maps one-to-one to tranche position.** Instalment 2 unlocks tranche 2.
- **`email_log` is not optional.** Without a record of what has been sent, a learner receives the same seven-day expiry warning every day for a week.
- **Money as integers in kobo.** Retain a currency column even while only NGN is supported.
- **All timestamps as `timestamptz`.** Cohort schedules are West Africa Time; cron comparisons against naive timestamps will be wrong.
- **Public identifiers are UUIDs, preferably v7.** Sequential integers allow URL enumeration.
- **Financial rows are never hard-deleted.** A cancellation sets a status.
- **No role enum on users.** `is_admin` boolean; learner and guardian standing derived from enrollments and guardianships.

### 4.8 Indexes

| Index | Purpose |
|---|---|
| `enrollments (user_id, cohort_id)` unique | Entitlement lookups; prevents duplicate enrollment |
| `instalments (purchase_id, position)` | Tranche unlock computation |
| `instalments (due_on, status)` | Daily dunning and overdue sweeps over `unpaid` rows |
| `transactions (gateway_reference)` unique | Webhook idempotency |
| `class_sessions (cohort_id, position)` | Schedule rendering |
| `guardianships (guardian_id)` and `(learner_id)` | Relationship-scoped permission checks |
| `submissions (assignment_id, user_id)` unique | One live submission per learner per assignment |
| `enrollments (expires_at, status)` | Daily expiry warning and expiry sweeps |
| `email_log (user_id, type, entity_ref)` | Duplicate-send prevention |
| `one_time_tokens (token_hash)` unique | Token redemption |

### 4.9 Migration approach

- Prisma Migrate, every change committed as a migration file. No manual schema edits.
- Migrations follow the build order in section 8.
- Seed data: one course, one cohort with three tranches, a sample learner, guardian and admin.
- Enable automated backups on the Railway database before the first real payment.
- **Alpine/musl note.** Development happens in Acode's Alpine Linux terminal. Prisma ships different query engines for musl and glibc; `binaryTargets` must list both the musl ARM64 target and the Railway glibc target, or the client builds and then fails at runtime.

---

## 5. Hosting

Railway, chosen for speed to launch. Managed PostgreSQL, persistent processes so
cron runs normally, and deploys from a git push.

| Component | Placement |
|---|---|
| Next.js frontend | Railway service |
| Express API | Railway service |
| PostgreSQL | Railway managed database |
| Recordings | YouTube (external) |
| Transactional email | Resend or Postmark (external) |
| Learner questions | WhatsApp (external, section 7) |

**Workspace cost.** This is a workspace root, not a bare Node app, so Railway
cannot infer either service. Each keeps its root directory at the repository
root and targets its workspace through the build and start commands.

**Alternatives considered.** Fly.io offers a Johannesburg region but is not a
managed-Postgres region, and egress outside North America and Europe is markedly
more expensive. Hetzner with Coolify is cheapest at scale but transfers all host
maintenance and backup responsibility to you. Both remain reasonable migration
targets once revenue justifies the operational cost.

**Cost note.** Hosting is billed in dollars while revenue arrives in naira.
Track this as a foreign-exchange exposure that grows with usage.

---

## 6. Development environment

Development happens from an Android phone using Acode with its built-in Alpine
Linux terminal (proot). Consequences that affect architecture:

- Package manager is `apk`, not `apt` or `pkg`.
- The repository lives inside the Alpine home. Android shared storage cannot hold symlinks, and npm workspaces are symlinks.
- Prisma needs a musl binary target alongside the glibc one.
- Local PostgreSQL is `apk add postgresql`; pointing at the Railway database is the fallback if it proves troublesome on-device.

---

## 7. Learner question channel

WhatsApp, external to the platform. No discussion or comment feature in version
1. Each cohort has a group; the cohort page links to it, and
`cohorts.whatsapp_url` is served only to learners who pass the entitlement
check.

- Removes moderation, notification, and threading work from version 1 entirely.
- Matches where Nigerian learners already communicate.
- Accepted cost: questions are not archived against class sessions, so each cohort re-asks the same questions.
- Revisit when repetition becomes noticeable — a per-class-session comment thread is the natural successor.

---

## 8. Build order

| Stage | Scope |
|---|---|
| 0 | Foundation — workspace, API skeleton, Prisma init, Next.js skeleton, Railway deploy |
| 1 | Authentication and accounts — registration, relationship field, guardian stub accounts and invitation flow, email verification |
| 2 | Courses, cohorts, class sessions, tranches — admin management surface |
| 3 | Purchase and payment plan — instalment schedule generation, enrollment creation |
| 4 | Payment webhooks and tranche unlock — signature verification, idempotency, audit log |
| 5 | Content delivery through EntitlementService — locked and unlocked rendering |
| 6 | Assignments, submissions, grades, gradebook, attendance |
| 7 | Guardian dashboard and shared payment access |
| 8 | Scheduled jobs — dunning, expiry, class session reminders |
| 9 | Marketing site and course catalogue |
| 10 | Client enquiry form and lead pipeline |

Stage 0 is not in the original build order but everything depends on it.

Payments precede content deliberately. It is the area most likely to expose a
wrong assumption, and every downstream stage depends on the entitlement model it
establishes.

`docs/build-plan.md` breaks these into 58 numbered steps with files, tables,
done-when conditions and dependencies.

---

## 9. Changes from v1.1

1. **Condition 2 of `canAccess` reads `enrolled`, not `active`.**
2. **The horizontal stepper is now the vertical PaymentRail.** The `PaymentStepper` component name is retired along with step, node and connector.
3. **The component layer is `elements`**, freeing "primitive" for token values only.
4. **`sessions` renamed `class_sessions`** in prose as well as schema; `session_progress` became `class_session_progress`.
5. **`one_time_tokens` added** — v1.1 had no home for invitation, verification or reset tokens.
6. **All enum values specified**, and `instalments.status` narrowed to stored facts.
7. **Completion and guardian summary jobs added** to 3.5; v1.1 listed neither.
8. **`cohorts.whatsapp_url` added** — section 6 of v1.1 required the link but no column held it.
9. **Reinstatement rule stated** — remainder of the original window.
10. **Section 6 added** — the Android/Alpine development environment and its architectural consequences.
11. **Monorepo layout and its Railway cost** recorded in 1 and 5.
12. **Open items resolved**: suspension/expiry, resubmission storage, watch-progress granularity. Remaining open items are listed in the concept brief section 9.
