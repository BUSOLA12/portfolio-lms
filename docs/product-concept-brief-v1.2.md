# Product Concept Brief

**Portfolio website with integrated LMS module**
Prepared for Iyiola · Version 1.2 · Supersedes v1.1 of 27 August 2026

> **Authority.** `CLAUDE.md` at the repository root overrules this document.
> Where v1.1 disagreed with `CLAUDE.md`, this version has been corrected to
> match. Changes from v1.1 are listed in section 10.

---

## 1. Concept statement

One product serving two audiences across three surfaces. The business has two
service lines — software development and technical training — and the website
must serve both without collapsing them into a single journey.

| Surface | Audience | Purpose |
|---|---|---|
| Marketing site (public) | Clients and prospective learners | Portfolio, service overview, course catalogue, calls to action |
| Learner app (authenticated) | Enrolled learners and their guardians | Cohort schedule, class sessions, resources, assignments, payment status |
| Admin surface | The business owner | Course and cohort management, grading, payment exceptions, enquiries |

The admin surface is not optional. Instalment payments and manual exception
handling guarantee that some reconciliation work will always be needed, and it
requires a home.

---

## 2. Delivery and commercial model

| Decision | Choice |
|---|---|
| Course delivery | Hybrid — scheduled live classes plus recorded material |
| Learning platform | LMS module built in-house, not a third-party integration |
| Payment model | Instalments / part payment per cohort |
| Content release | Drip release by tranche, tied to instalments paid |
| Payment gateway | Paystack or Flutterwave, bank-transfer channel — **not yet chosen** |
| Post-completion access | All cohort recordings remain available for one month after completion, then expire |
| Late joiners | Pay full price; receive recordings of class sessions already held |
| Client services | Enquiry-led. No client accounts in version 1 |
| Preferred stack language | JavaScript on both frontend and backend |

---

## 3. Working terminology

These are the terms to use consistently in specifications, code, and prompts to
Claude Code. Precision here prevents ambiguity later.

| Term | Meaning |
|---|---|
| Design tokens | The named values — colours, spacing, type scale, radii — stored as CSS custom properties. |
| Primitive | A raw token value, and nothing else. Never the component layer. |
| Elements | The shared component layer: Button, Input, Select, Field, Card, Badge, Modal, Table, Toast, Rail. |
| Design system | Tokens plus elements, patterns, and usage rules. |
| Class session | A scheduled live class within a cohort. Never `session` unqualified. |
| Auth session | A login session. Never `session` unqualified. |
| Payment-gated | Access conditional on payment. Preferred over "paid fully". |
| Enrollment | A learner joined to a specific cohort. Distinct from account creation. |
| Entitlement | The access right granted by a payment. Never a property of the account. |
| Rail | The vertical stepped motif. Each unit on it is a **knot**. |
| PaymentRail | The composite rendering a payment schedule on the rail. |
| Drip content | Material released progressively rather than all at once. |
| Tranche | One block of class sessions unlocked by one instalment. |
| Dunning sequence | The scheduled series of payment reminders before and after a due date. |
| Grace period | The window after a missed due date before suspension takes effect. |
| Suspend | Temporary, reversible removal of access. Preferred over "ban" or "decline". |
| Observer role | Read-only access to another user's data. The permission shape behind the guardian. |
| Guardianship | The relationship record linking a guardian account to a learner account. |
| Conditional fields | Form fields shown or hidden based on an earlier selection. |
| Stub account | An unclaimed account created on someone's behalf, pending activation. |
| Invitation token | A single-use, expiring credential in an invitation email. |
| Webhook | The gateway's server-to-server callback confirming a verified transaction. |
| Interest list | Prospective learners awaiting the next cohort. Replaces "waitlist" entirely. |
| Stack vs framework | A framework (Next.js, Express) is one component of a stack. Not interchangeable. |

**Retired terms.** "Stepper", "step", "node", "connector", "waitlist",
"module", "lesson". None of these appear in this project.

---

## 4. Domain model

| Entity | Definition and notes |
|---|---|
| Course | The curriculum. Stable across time; does not carry dates. |
| Cohort | A dated run of a course, with schedule and capacity. Learners enroll into cohorts, never directly into courses. |
| Class session | A scheduled live class within a cohort: date, time, meeting link, and recording added afterwards. |
| Resource | Material attached to a class session — slides, code, recordings, reading. |
| Tranche | A block of class sessions unlocked by one instalment payment. |
| Purchase | Links a learner to a course and owns the payment plan. Survives a change of cohort, so payments are never orphaned by a deferral. |
| Enrollment | Links a learner to a cohort and references a purchase. |
| Payment plan | The instalment schedule generated at purchase, with due dates. |
| Transaction | A single payment against a plan, recording amount, reference, and paid_by. |
| Assignment | Work attached to a class session. |
| Submission | A learner's response to an assignment. |
| Grade | A score against a submission; aggregated into the gradebook. |
| Guardianship | A many-to-many link between guardian and learner accounts. |
| Lead | A client enquiry on the software services side. |
| Interest list | Prospective learners awaiting the next cohort of a course. |

### Status values

| Entity | Values |
|---|---|
| Enrollment | `pending` → `enrolled` → `suspended` → `completed` → `expired`, or `deferred` |
| User | `pending` · `enabled` · `suspended` |
| Cohort | `draft` · `open` · `running` · `completed` |
| Instalment (stored) | `unpaid` · `paid` · `cancelled` |
| Class session | `scheduled` → `live` → `completed` |
| Assignment | `draft` → `published` → `open` → `closed` |
| Submission | `submitted` → `graded` → `returned` |
| Attendance | `present` · `absent` · `late` |
| Lead | `new` → `contacted` → `proposing` → `won` / `lost` |
| Resource kind | `recording` · `slides` · `code` · `reading` |

**`enrolled`, never `active`.** The word `active` belongs to the design
system's visual state vocabulary and means something different. v1.1 used
`active` throughout; it was wrong.

**Instalment status is deliberately narrow.** `due`, `upcoming` and `overdue`
are derived from `due_on` against `now()`, never stored. A stored value would
need a cron job to stay honest, and would lie between runs.

**Critical constraint.** Access must never be modelled as a boolean on the
account. Tying access to an "active account" makes it impossible to sell a
second course independently. Registration creates the account; payment creates
the enrollment and its entitlements.

---

## 5. Roles and permissions

| Role | Rights |
|---|---|
| Learner | Access unlocked tranches, submit assignments, view own grades and progress, view and pay own instalments. |
| Guardian | Read-only view of a linked learner's progress, submissions, and grades. Shared access to the payment page. Receives the weekly guardian summary. |
| Admin | Full management of courses, cohorts, class sessions, tranches, resources, grading, payment exceptions, suspensions, appeals, and enquiries. |

Permissions are relationship-scoped, not purely role-based. A guardian is not an
observer globally — they are an observer of one specific learner. Every guardian
read must be checked against an existing guardianship record. Without this, one
guardian can see another learner's data.

Payment rights are likewise enrollment-scoped rather than a separate "payer"
role. Both the learner and their guardian reach the same payment page; the
transaction simply records who paid.

There is no role enum on users. The same person may be a learner in one course
and a guardian for their child. `is_admin` is a boolean; learner and guardian
standing are derived from the existence of enrollments and guardianships.

---

## 6. Key flows

### 6.1 Registration and guardianship

- Learner registers and selects a relationship value: self or guardian.
- Selecting guardian reveals conditional fields for the guardian's name, email, and contact details.
- A stub account is created for the guardian and an invitation email is sent, carrying a single-use, expiring invitation token.
- The guardian claims the account by setting a password. Until then the account remains `pending`.
- A pending guardian account must not block enrollment or payment.

### 6.2 Enrollment and payment

- Learner enrolls into a cohort; a payment plan with dated instalments is generated.
- The payment page shows the **PaymentRail** — a vertical rail with one knot per instalment. Each knot carries a visual state: `done`, `active`, `locked`, or `overdue`.
- State is server-derived. The browser performs no date arithmetic.
- Clicking a knot opens the payment view for that instalment.
- Payment is made by bank transfer through the gateway's transfer channel. The gateway confirms via webhook with a transaction reference, and the corresponding tranche unlocks automatically.
- Manual confirmation by the admin is retained only as a fallback for off-platform transfers.

### 6.3 Content release

- Each instalment unlocks one tranche of class sessions and their resources.
- Instalment position maps one-to-one to tranche position. Instalment 2 unlocks tranche 2.
- Class sessions beyond a paid tranche appear locked and greyed, not hidden, so learners can see what remains.
- Cohort pacing should align tranche boundaries with payment due dates.

### 6.4 Reminders and lapsed payment

- A dunning sequence sends reminders at 7, 3 and 1 days before the due date, and on the due date, stating clearly that continued access depends on payment.
- Reminder emails deep-link to the payment page.
- After the due date a grace period applies; on expiry the enrollment moves to `suspended`.
- Suspension is reversible: payment restores access without re-enrollment.
- **A suspended learner who later settles receives the remainder of the original access window, not a fresh month.** This was open in v1.1; `CLAUDE.md` decides it.

### 6.5 Fraud and appeals

- Gateway webhook verification removes most fraud exposure by confirming funds before access is granted.
- Where a payment is disputed or falsified, the admin suspends the enrollment rather than deleting it.
- The learner is notified with a reason and may submit an appeal, which the admin reviews and either upholds or reverses.

### 6.6 Cohort completion and access expiry

- Completion requires both conditions: the final class session has passed and all instalments are paid.
- If class sessions are finished but payment is outstanding, the enrollment moves to `suspended`, not `completed`.
- On completion the learner retains access to all cohort recordings and resources for one month.
- Every entitlement carries an `expires_at` value, set at completion.
- Expiry notices are sent at 7 days and 1 day before access ends. These double as the prompt to enrol in a further course.
- After expiry the enrollment moves to `expired`. The record and grades are retained; only content access is withdrawn.

### 6.7 Late joiners, deferrals and interest lists

- Tranches unlock on payment, not on date. A learner joining mid-cohort pays the first instalment and immediately receives the recordings of class sessions already held.
- Late joiners pay the full cohort price; recordings substitute for the live class sessions missed.
- A deferral closes the current enrollment as `deferred` and creates a new enrollment in the next cohort, both referencing the same purchase. Payments made carry across intact.
- Cohorts carry a capacity. Capacity-full is computed from the enrollment count, never stored as a flag. When full, prospective learners join the course interest list.

### 6.8 Client enquiry (software services)

- A structured enquiry form captures project type, scope summary, budget range, timeline, and contact details.
- The budget range field filters unserious enquiries before they consume a call.
- Submission creates a Lead and notifies the admin by email.
- Leads are progressed through the admin enquiry inbox.
- No client accounts in version 1. Correspondence continues by email or messaging; call booking links to an external scheduler.

### 6.9 Class session and assignment lifecycle

- Class session status: `scheduled` → `live` → `completed`. Reminders at 24 hours and 1 hour beforehand.
- The join link is visible only to learners with an active entitlement covering that class session.
- Uploading a recording marks the class session as having material available and notifies the cohort.
- Attendance is recorded manually by the admin in version 1 and surfaced in the guardian dashboard.
- Schedule changes and cancellations notify the whole cohort — learners and guardians both.
- Assignment status: `draft` → `published` → `open` → `closed`. Submission status: `submitted` → `graded` → `returned`.
- Resubmission is permitted until the due date passes, and updates the submission row in place.
- Late submissions are accepted and marked with an `is_late` flag rather than blocked.

---

## 7. Visual state vocabulary

Four states, and only four. They attach at two levels.

| Level | State | Meaning |
|---|---|---|
| Tranche | `locked` | Instalment not paid |
| Tranche | `overdue` | Instalment past due, or enrollment suspended |
| Tranche | `active` | Paid, and the cohort is currently inside it |
| Tranche | `done` | Paid, and every class session in it has been held |
| Class session | `done` | Entitled, and the class has been held |
| Class session | `active` | Entitled, and it is live or next up |
| Class session | `locked` | In an unpaid tranche |

A paid, future class session that is not next up carries **no badge** — a date
and a title only. That is the absence of a state, not a fifth one.

Visual state never derives from watch progress.

---

## 8. Version 1 feature list

**Marketing site (public)**
- Portfolio: services, past work, about
- Course catalogue with cohort dates, capacity, and instalment breakdown
- Interest list sign-up for courses with no open cohort
- Call to action to registration; separate call to action for client enquiries

**Registration and accounts**
- Learner registration with relationship field (self / guardian)
- Conditional guardian fields; stub account creation and invitation email
- Guardian claim flow
- Email verification and password reset

**Enrollment and payments**
- Purchase record owning the payment plan, separable from the cohort enrollment
- Enrollment into a cohort with the full status lifecycle
- Instalment schedule generated at purchase
- PaymentRail with per-knot states
- Paystack or Flutterwave integration using the bank-transfer channel
- Webhook handling for automatic confirmation and tranche unlock
- Transaction history recording paid_by
- Dunning sequence: reminders at 7/3/1 days and on the due date, grace period, automatic suspension

**Learning**
- Cohort schedule with class sessions
- Class session resources and recordings, drip-released by tranche
- Locked class sessions shown greyed rather than hidden
- Assignments with resubmission before the due date and late submissions flagged
- Submissions, grades, and gradebook
- Manual attendance marking
- Class session reminders at 24 hours and 1 hour; schedule-change notifications
- One-month post-completion access window with expiry notices at 7 days and 1 day
- Progress tracking

**Guardian**
- Read-only dashboard: progress, submissions, scores
- Shared access to the payment page
- Weekly guardian summary email

**Admin**
- Create and manage courses, cohorts, class sessions, and tranches
- Upload resources; grade submissions
- Manual payment confirmation (fallback only)
- Suspend and reinstate enrollments; process deferrals; handle appeals
- Mark attendance
- Lead pipeline in the enquiry inbox

**Client services (public)**
- Structured enquiry form including budget range and timeline
- Admin notification on submission
- Outbound link to an external scheduler for calls

**Deferred to version 2**
Certificates, automated attendance capture, client accounts and portal, in-app
call booking, refunds, multi-instructor support, mobile application, in-platform
discussion and Q&A.

---

## 9. Open items

Resolved since v1.1: the suspension and expiry interaction, guardian visibility
of payments, the learner question channel (WhatsApp, external), and every enum
value in section 4.

Still open:

| Item | Note |
|---|---|
| Unverified guardian email | A minor may enter any address. The four entitlement conditions do not currently gate tranche unlock on guardian claim. Confirm that is intended. |
| Instalment plan shape | Where the ₦150,000 / ₦100,000 split is stored — a template table, or columns on the cohort. |
| Price of record | Which of `courses.base_price_kobo`, `cohorts.price_kobo` and `purchases.total_kobo` a purchase copies from, and what happens on deferral into a differently priced cohort. |
| Partial payment | Whether a partly-paid instalment counts as paid for the entitlement check. |
| Cohort capacity | No number set. |
| Payment gateway | Paystack or Flutterwave. |
| Email provider | Resend or Postmark. |
| Enquiry option lists | `project_type`, `budget_range`, `timeline` values. |
| Scheduler URL | For the outbound call-booking link. |
| Submission file storage | No document specifies where uploaded files live. |
| Tranche boundaries | Cohort pacing must be designed so unlocked content ends at a payment point, not mid-topic. |

---

## 10. Changes from v1.1

1. **`active` → `enrolled`** as the enrollment status, throughout. v1.1 contradicted `CLAUDE.md`.
2. **Horizontal stepper → vertical PaymentRail.** "Stepper", "step", "node" and "connector" retired.
3. **"Session" split into class session and auth session** everywhere.
4. **"Waitlist" removed**; interest list is the only term.
5. **"Module" and "lesson" removed**; tranche and class session are the domain terms.
6. **"Primitive" reserved for token values**; the component layer is `elements`.
7. **Suspension/expiry resolved** — remainder of the original window.
8. **All enum values specified** in section 4, including the narrowed instalment status.
9. **Section 7 added** — the visual state vocabulary and how it attaches.
10. **Capacity-full and tranche unlock stated as computed**, never stored.
