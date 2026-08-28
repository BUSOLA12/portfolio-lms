# Project constraints

Portfolio website with an integrated LMS module, for a software engineer who also
runs paid training cohorts. Two audiences: **clients** (software services) and
**learners** (training). Never collapse them into one word or one journey.

Read this before writing code. The rules here are decisions, not suggestions —
several exist because the obvious approach is wrong for this product.

---

## Stack

| Layer | Choice |
|---|---|
| Frontend | Next.js, App Router, route groups `(marketing)` `(app)` `(admin)` |
| Styling | CSS Modules consuming `tokens.css`. CSS custom properties are the source of truth. |
| Server state | TanStack Query |
| Client state | React Context |
| Backend | Standalone Express API (not Next route handlers) |
| Database | PostgreSQL via Prisma |
| Scheduling | node-cron in the API process |
| Hosting | Railway |
| Video | YouTube unlisted, IFrame Player API |
| Email | Resend or Postmark |
| Payments | Paystack or Flutterwave |
| Questions | WhatsApp, external. No in-app comments in v1. |

The API is separate from Next because dunning, expiry sweeps, and reminders need
a persistent cron process, and because the v2 mobile app will consume the same API.

---

## Terminology

Use these exact words in code, comments, and commit messages.

| Term | Meaning |
|---|---|
| Course | Curriculum. Stable, carries no dates. |
| Cohort | A dated run of a course. Learners enroll into **cohorts**, never into courses. |
| Tranche | A block of sessions unlocked by one instalment. |
| Class session | A scheduled live class. Table is `class_sessions`. |
| Auth session | A login session. Table is `auth_sessions`. |
| Purchase | Links learner to course, owns the payment plan. Survives a change of cohort. |
| Enrollment | Links learner to cohort, references a purchase. |
| Entitlement | The access right a payment grants. Never a property of the account. |
| Guardianship | Many-to-many link between a guardian account and a learner account. |
| Observer | The permission shape behind the guardian role — read-only on another user's data. |
| Drip / tranche release | Content released progressively as instalments are paid. |
| Dunning | The scheduled sequence of payment reminders. |
| Lead | A client enquiry on the services side. |

**Never** name a table, variable, or route `session` unqualified.

---

## Non-negotiable rules

### 1. One EntitlementService

A single service answers: *can this user access this resource right now?*

```
canAccess(user, classSession) ->
    1. an enrollment exists linking user to classSession.cohort
    2. enrollment.status is 'enrolled' or 'completed'
    3. now() < enrollment.expires_at
    4. classSession.tranche is covered by instalments paid

  all four true -> return resource identifiers
  any one false -> return metadata only, locked: true
```

Every content endpoint and every video-identifier lookup calls it. Do not
reimplement this check inline anywhere, for any reason.

### 2. Locked content ships no identifiers

Locked sessions render greyed in the UI, but the API response must contain **no**
video IDs, resource URLs, or meeting links for them. Hiding in a component is
presentation, not access control.

### 3. Tranche unlock is computed, never stored

There is no `is_unlocked` column. Tranche at position N is open when the learner
has N instalments paid. A stored flag drifts out of sync with payments.

Instalment position maps 1:1 to tranche position. Instalment 2 unlocks tranche 2.
Do not invent a cleverer scheme.

### 4. Money is integers in kobo

`amount_kobo`, `price_kobo`, `total_kobo`. Never floats, never decimals.
₦250,000 is `25000000`. Keep a `currency` column even though only NGN exists today.

### 5. Database sessions, not JWTs

Suspension must take effect immediately. A JWT stays valid until it expires, so a
learner suspended for fraud would keep access. Use `auth_sessions` rows with a
hashed token in an httpOnly, secure, SameSite cookie.

### 6. Guardian permissions are relationship-scoped

A guardian is not an observer globally — they are an observer of one specific
learner. Every guardian read verifies a `guardianships` row links requester to
subject. Skipping this lets one guardian read another learner's grades.

### 7. Webhooks: verify, dedupe, re-verify

- Verify the gateway signature. Reject unsigned or mismatched payloads.
- Unique constraint on `gateway_reference`. Gateways retry; a replay must not
  credit an instalment twice.
- Never trust the browser redirect. Re-verify server-to-server before unlocking.
- Record the payment and unlock its tranche in one database transaction.

### 8. Financial rows are never hard-deleted

Purchases, instalments, transactions: append-and-amend only. Cancellation sets a
status. `payment_audit_log` is append-only.

### 9. Every scheduled email checks `email_log` first

Cron runs daily. Without this check a learner gets the same 7-day expiry warning
every day for a week.

### 10. Timestamps are `timestamptz`, IDs are UUID v7

Cohort schedules are West Africa Time; naive timestamps break cron comparisons.
Sequential integer IDs let anyone enumerate `/sessions/1`, `/sessions/2`.

---

## Design system rules

`tokens.css` is the single source of truth. `design-system.html` is the reference.

- **Components never reference a primitive.** Semantic tokens only
  (`--action-primary-bg`, not `--green-600`). Rebrands must touch one layer.
- **Four states, no fifth:** `done · active · locked · overdue`. If something
  doesn't fit, redesign the flow rather than adding a state.
- **One ochre element per screen region.**
- **Mono is for code and numbers.** Not for emphasis.
- **The stepped rail is the only motif.** Don't add a second. The payment
  schedule uses the rail — vertical, knots as instalments — not a separate
  horizontal stepper.
- Every interactive element: visible focus ring, 44px minimum touch target.
- Body copy stays within 68 characters per line (`--measure`).

### State mapping

| Domain concept | Visual state |
|---|---|
| Instalment paid | `done` |
| Instalment due now | `active` |
| Instalment upcoming | `locked` |
| Instalment overdue | `overdue` |
| Enrollment suspended | `overdue` |
| Session in an unpaid tranche | `locked` |

**Naming clash:** the visual state `active` and the enrollment status collide.
The database value is **`enrolled`**, not `active`. Enrollment statuses are:
`pending · enrolled · suspended · completed · expired · deferred`.

---

## Performance budget

Learners are predominantly on Android phones over metered mobile data.

- Mobile-first layouts throughout.
- Code-split marketing and app bundles. A visitor reading the portfolio must
  never download the dashboard.
- Fonts are self-hosted, Latin-subset, `font-display: swap`. The unicode-range
  includes U+20A6 (₦).
- No video autoplay. Playback is always user-initiated.

---

## Business rules currently in effect

**Mobile App Development cohort**

- ₦250,000 total (`25000000` kobo), 2 months
- 24 class sessions, 120 minutes each, 3 per week over 8 weeks
- 2 tranches of 12 sessions
- Instalment 1: ₦150,000 at enrollment, unlocks tranche 1
- Instalment 2: ₦100,000, due end of week 3, unlocks tranche 2
- Grace period runs through week 4; suspension at start of week 5
- Dunning: reminders at 7, 3, and 1 days before due, on the due date, and 2 days
  before access ends

**Access lifecycle**

- Completion requires the final session passed **and** all instalments paid.
- Sessions finished but payment outstanding → `suspended`, not `completed`.
- On completion, all cohort recordings stay available for **one month**
  (`expires_at`).
- A suspended learner who later settles receives the **remainder** of the
  original window, not a fresh month.
- Expiry notices at 7 days and 1 day.
- Late joiners pay full price and receive recordings of sessions already held.
- Deferral: close the enrollment as `deferred`, create a new one in the next
  cohort against the **same purchase**.

**Registration**

- Learner selects a relationship: `self` or `guardian`.
- Choosing `guardian` reveals conditional fields and creates a guardian **stub
  account** plus an invitation email with a single-use expiring token.
- A pending guardian account must not block enrollment or payment.
- Both learner and guardian reach the same payment page. Record `paid_by_user_id`.

---

## Build order

1. Auth and accounts — registration, relationship field, guardian invitation, verification
2. Courses, cohorts, class sessions, tranches — admin surface
3. Purchase and payment plan generation
4. Payment webhooks and tranche unlock
5. Content delivery through EntitlementService
6. Assignments, submissions, grades, gradebook
7. Guardian dashboard and shared payment access
8. Scheduled jobs — dunning, expiry, session reminders
9. Marketing site and course catalogue
10. Client enquiry form and lead pipeline

Payments precede content deliberately: it is where a wrong assumption surfaces,
and everything downstream depends on the entitlement model it establishes.

---

## Deferred to v2

Certificates, automated attendance capture, in-app discussion, client accounts
and portal, in-app call booking, refunds, multi-instructor, mobile application.

Attendance is marked manually by admin in v1.

## Still undecided

- Resubmission storage: update one row until the due date, or version attempts.
- Watch-progress granularity: completed sessions only, or percentage watched.
- Whether the API sits on a subdomain (simpler cookies) or a separate domain (CORS).
- Cohort capacity limit — not yet set.

## Working method

Authority order: this file, then `docs/build-plan.md`, then the two PDFs.
Where they disagree, the earlier one wins.

**One step at a time.** `docs/build-plan.md` breaks the build order into
numbered steps. Build only the step you are explicitly named and asked to
implement. When it is finished, stop and wait. Do not begin the next step.
Do not build ahead. Do not scaffold "while you're in there".

**Stop rather than expand.** If a step turns out larger than its description,
stop and say so before writing more. Do not widen scope to make a step work.

**The rules here are decisions, not suggestions.** If one seems wrong, say so
and wait. Do not work around it, and do not quietly implement something else.

**Report contradictions; never resolve them silently.** These documents were
written across several sessions. Where they disagree, say which documents
conflict and what each says, then ask. Where the specification is genuinely
ambiguous, ask rather than assume.

**Decisions D1 to D12 in `docs/build-plan.md` are settled.** Component naming,
the `elements` layer, `--state-overdue-rail`, class session visual state, and
every enum value listed there. Do not re-open or re-argue them.

**Never invent a value listed under "Still open" in `docs/build-plan.md.**
Prices, capacity, gateway choice, email provider, option lists, and copy are
not yours to choose. Ask.

**Verify before reporting done.** Run `npm run lint` and `npm run format:check`
and state the result. Do not describe a step as complete on the strength of
having written the files.
