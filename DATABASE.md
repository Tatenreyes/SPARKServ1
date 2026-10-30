# SPARKServ — Database

## Where the schema lives

| File | Role |
| --- | --- |
| `supabase/schema.sql` | Canonical install: extensions, enums, tables, indexes, RLS policies, triggers, storage buckets. **Not self-contained** — it assumes Supabase's `auth`/`storage` schemas and the `anon`/`authenticated`/`service_role` roles exist. |
| `supabase/migration_sync_live_schema.sql` | Brings an older live project up to the pre-queue shape (idempotent). |
| `supabase/migration_flow_hardening.sql` | Flow hardening (idempotent). |
| `supabase/migration_queue_redesign.sql` | **Queue model v2.** Adds the queue columns/tables/functions/policies/grants described in `QUEUE-SYSTEM.md`. Idempotent: re-running it is a no-op, which `npm run test:queue-sql` proves by loading it twice. |
| `supabase/migration_profile_name_address.sql` | Splits the profile name into first/last/middle initial and adds the address. |
| `supabase/migration_service_location.sql` | Service location on `service_requests` (coordinates, range/pairing constraints, the location-privacy policy) plus `technician_pending_offers()`. |
| `supabase/migration_troubleshooting.sql` | Identified issue (`issue_id`) and the customer-reported troubleshooting outcome. |
| `supabase/migration_offer_lifecycle.sql` | Offer lifecycle: cancelling releases the live offer, a closed request is never accepted or re-offered, a lapsed offer cannot freeze the rotation. |
| `supabase/migration_estimate_status.sql` | **Estimate workflow, step 1 of 2** — the three status values the workflow needs. |
| `supabase/migration_estimate_workflow.sql` | **Estimate workflow, step 2 of 2** — itemized costs, version history, `submit_estimate()` / `decide_estimate()`, the booking guard. |
| `supabase/migration_legacy_columns.sql` | Retires the legacy NOT NULL `service_requests.issue_description`. Independent of the chain — apply it whenever it is missing. |
| `supabase/migration_service_request_photos_bucket.sql` | The repair-request photo bucket behind `/api/service-requests/photos`. Independent of the chain. |
| `supabase/migration_appliance_columns.sql` | `appliances.warranty_type` / `warranty_proof_url` — the two columns `migration_appliance_centric_flow.sql` never adds to an already-appliance-centric database. Independent of the chain. |
| `supabase/migration_booking_payment_status.sql` | **Batch 1, step 1 of 2.** `booking_status` gains `awaiting_payment`: the state between a confirmed inspection and a verified payment. |
| `supabase/migration_rls_workflow_enforcement.sql` | **Batch 1, step 2 of 2.** The workflow rules RLS did not enforce: booking creation gated on the approved estimate, the booking transition matrix, payment submission pinned to `pending_verification`, estimates scoped to the assigned technician, the split `service_requests` policies, and `confirm_payment()` as the only writer of a completed repair. |
| `supabase/migration_atomic_booking.sql` | **Batch 2 (step 15).** Atomic booking creation, one live booking per request, no overlapping appointment per technician, and the direct-insert path withdrawn. |
| `supabase/migration_reject_payment.sql` | **Batch 3 (step 16).** Database-enforced payment rejection: `reject_payment()`, the rejection metadata, the decision trigger and the narrowed `payments` privileges. |
| `supabase/migration_booking_eligibility.sql` | **Step 17.** A booking requires an assigned technician who is still QUALIFIED for the request's appliance type: `technician_qualification_failure()`, `appliance_has_qualified_technician()`, and the re-declared `create_booking_atomic()` / `technician_eligibility_failure()`. |
| `supabase/migration_cancel_release.sql` | **Step 18.** A cancellation releases the technician's slot and refreshes their operational status in the same transaction, for every writer: the `release_slot_after_booking_cancel` AFTER UPDATE trigger on `bookings`, plus the `booking_status_holds_slot()` predicate. |
| `supabase/migration_technician_queue.sql` | Historical, superseded by `schema.sql` + the redesign. Do not apply it on top of them. |
| `migration_appliances_tickets.sql`, `migration_appliance_centric_flow.sql`, `migration_notifications.sql`, `migration_profile_photos.sql`, `migration_security_hardening.sql`, `migration_system_settings.sql`, `migration_visits_payments.sql`, `migration_fix_technician_signup.sql` | Pre-queue history: applied on the live project already, and folded into `schema.sql` for fresh installs. Not part of the upgrade path below. |

### Apply order

There is no DDL channel from this repo to the project (no `psql`, no Supabase CLI,
no management token), so migrations are applied by hand. In the Supabase SQL
Editor, in this order:

```
1. supabase/migration_sync_live_schema.sql
2. supabase/migration_flow_hardening.sql
3. supabase/migration_queue_redesign.sql
4. supabase/migration_profile_name_address.sql
5. supabase/migration_service_location.sql
6. supabase/migration_troubleshooting.sql
7. supabase/migration_offer_lifecycle.sql
8. supabase/migration_estimate_status.sql
9. supabase/migration_estimate_workflow.sql
```

Steps 13 and 14 continue the chain and are ORDERED — 13 adds the enum value, 14
uses it in a policy predicate, and PostgreSQL refuses to use an enum value in the
same transaction that adds it:

```
13. supabase/migration_booking_payment_status.sql
14. supabase/migration_rls_workflow_enforcement.sql
```

Step 15 is Batch 2 and **is applied**. It must come after 14: the booking transaction
writes the request statuses 14's matrix allows and relies on 14's
`reopen_request_after_booking_cancel` trigger to return a request to `quoted`:

```
15. supabase/migration_atomic_booking.sql
```

It opens with a preflight that **fails without changing anything** if the live data
already violates either new invariant, naming the offending rows. Read them with the
`select` it prints, resolve them by hand, then run the file again — the file does not
clean up after you, deliberately: deciding which of two duplicate bookings is the
real one is a business decision, not a migration decision.

Step 16 is Batch 3 and **is applied**. It had to come after 14: it
extends the payment decision model that file established (`confirm_payment()`, the
`pending_verification` rule and the `customer submits own payment` policy, which this
file recreates). It is independent of step 15 — different table:

```
16. supabase/migration_reject_payment.sql
```

It opens with the same kind of preflight: a confirmed payment with no confirmation
metadata refuses the migration (the `CHECK` constraint could not be created), and a
rejected row that the old route recorded as verified is reported as a notice and left
exactly as it is. Neither case is cleaned up automatically.

Step 17 is the booking eligibility invariant and **is applied** — `npm run db:check`
reports all 18. It had to come after 3 (it re-declares `technician_eligibility_failure()`,
which the queue engine creates) and after 15 (it re-declares `create_booking_atomic()`).

Step 18 is the atomic cancellation release and **is applied**. It only
creates functions and a trigger, so it needed no preflight. It had to come after 15 (it calls
`release_technician_slot()`) and after 3 (it calls
`refresh_technician_operational_status()`):

```
18. supabase/migration_cancel_release.sql
```

**The matching code is written but not yet deployed.** The trigger makes the release
automatic, so a route that also released the slot itself would decrement twice for every
cancellation. Nothing in `src/` calls `release_technician_slot()` any more — but the last
committed revision still decrements `technicians.active_job_load` by hand after the status
change, so any build of a committed revision double-decrements on every cancellation.

It needs no preflight: it only replaces functions, so it cannot fail on existing data.
What it leaves behind is a question rather than an error — requests whose accepted
technician is no longer qualified for their appliance type. The file ends with a
read-only sweep that lists them, and changes nothing for you. See *Booking eligibility*
below.

It also closes the **concurrency** half of the same defect: the eligibility check is a
read, so the transaction locks each row the decision reads — `FOR SHARE` on `users` and
`technician_queue_state` (which it only reads) and `FOR NO KEY UPDATE` on `technicians`
(which it writes a moment later for the job-load counter, so nothing has to be upgraded).
A qualification change — a specialization edit, an approval change, a suspension, a
deactivation, an administrative queue removal — now waits for the booking transaction to
end instead of committing between the check and the commit. Because one connection cannot
demonstrate blocking, the migration's section 5 carries the exact two-session test (staging
data only — it edits `specializations` and one variant commits a probe booking), and
`TESTING.md` §1 has it again with the invariant to check afterwards.

**Pasting a comment-free copy.** The paste path used for this project drops lines that
begin with `--`. That is harmless, and it was checked rather than assumed: the
comment-free copy was loaded into the test harness, where it produced byte-identical
index, trigger, policy and grant definitions, identical function bodies once comment
text is ignored, and passed the whole queue suite. To put a copy on the clipboard
without a stray comment (swap the filename for whichever migration you are applying):

```powershell
(Get-Content supabase\migration_reject_payment.sql) |
  Where-Object { $_ -notmatch '^\s*--' -and $_.Trim() -ne '' } | Set-Clipboard
```

Then confirm with `npm run verify:queue` — it refuses to run until step 3 is
applied (it checks for `technician_queue_state.queue_position`).

**`npm run db:check` is the preflight for this list**, and it prints the same
numbers. Two things about its output are deliberate:

* **Steps 8, 10 and 11 can never be confirmed.** An enum value, a dropped NOT
  NULL and a storage bucket are all invisible to PostgREST, so the check reports
  them as *"nothing to probe: cannot be confirmed through the API"* instead of
  claiming they are applied. Step 8 is nevertheless printed in the PENDING list
  whenever step 9 is pending, because 9 uses those enum values in index
  predicates: applying 9 without 8 fails with `invalid input value for enum
  estimate_status: draft`. To confirm 8 by hand, check that
  `select unnest(enum_range(null::estimate_status));` returns `draft`,
  `revision_requested` and `superseded`; `migration_legacy_columns.sql` ends with
  the equivalent verification query for step 10.
* **Steps 10–12 are independent of the ordered chain** — nothing later depends on
  them. Steps 10 and 11 are never listed as pending (they cannot be probed and
  nothing needs them); step 12 is, because its columns are probeable and are
  genuinely absent until it runs. Apply 10 when a customer-submitted request fails
  with 23502, 11 when a photo upload finds no bucket, and 12 whenever the appliance
  form reports a missing `warranty_type`.

**Why step 12 exists — the appliance-column trap.** `appliances` was extended by
three different files, and one of them cannot reach a database that is already
appliance-centric:

* `migration_appliances_tickets.sql` created it (`name`, `appliance_type`, `brand`,
  `model`, `purchase_date`, `notes`);
* `migration_sync_live_schema.sql` (step 1) added exactly four more
  (`model_number`, `serial_number`, `warranty_status`, `warranty_expiry_date`);
* `migration_appliance_centric_flow.sql` adds the rest — but it **returns early**
  when `service_requests.problem_description` already exists, which is *before* it
  touches `appliances`.

So on every already-appliance-centric database, `warranty_type` and
`warranty_proof_url` were never created, while `schema.sql` (fresh installs) has
both — which is why the app's types, the UI and every test kept passing. Re-running
the flow migration is not a fix (it skips again, and removing its guard would drop
the foreign keys held by `estimates`, `bookings` and `technician_offer_history`);
`migration_appliance_columns.sql` adds just those two columns.

**Symptom of a skipped step.** A deployment that is ahead of its database does not
fail with a generic 500 on the main customer flow: `POST /api/service-requests`
inserts `issue_id` and `troubleshooting_outcome` (step 6) and `location`,
`latitude`, `longitude` (step 5), so with either file unapplied the route answers

```
503  { "code": "SERVICE_SETUP_REQUIRED",
       "error": "Repair requests are temporarily unavailable while the system is being updated..." }
```

In development the body also carries `detail.message` (the database's own wording,
e.g. `Could not find the 'issue_id' column of 'service_requests' in the schema
cache`), `detail.code` and `detail.next_step`; production keeps the opaque
sentence, because the caller there is a customer rather than whoever can run the
migrations. The browser shows the detail when it is present, so a schema drift
reads as the missing column instead of an unexplained failure — and
`npm run db:check` names the file to apply.

A fresh install runs `schema.sql` first and then the same ordered chain; the
harness `scripts/test-queue-sql.mjs` loads exactly that sequence (steps 1–3 and
5–9 — step 4 only adds profile columns an already-live project is missing, and the
harness fixtures never set them), which is how the fresh-install and live-upgrade
paths are kept equivalent.

## Queue tables

### `technician_queue_state` — one row per (technician, appliance type)

| Column | Notes |
| --- | --- |
| `id` | pk |
| `technician_id` | → `users(id)` |
| `appliance_type` | normalized slug (`normalize_appliance_type()`) |
| `queue_position` | 1-based turn order within this appliance queue |
| `is_active` | false when removed from the rotation (suspension, specialization removed) |
| `turn_count` | how many turns this technician has consumed |
| `last_assigned_at` | kept for ordering tie-breaks and reporting |
| `joined_at`, `updated_at` | audit timestamps |

Constraints: **unique `(technician_id, appliance_type)`** — duplicate memberships
are impossible; positions are compacted by `compact_queue_positions(appliance)`
(1..n, no holes, no ties).

### `technician_queue_events` — the queue audit trail

`technician_id`, `appliance_type`, `repair_request_id`, `action`, `old_position`,
`new_position`, `reason`, `actor_id`, `created_at`. Written only by SECURITY
DEFINER functions. Actions are listed in `QUEUE-SYSTEM.md`.

### `technician_offer_history`

One row per offer: `service_request_id`, `technician_id`, `status` (`offered` /
`accepted` / `rejected`), `reason`, `created_at`. It doubles as the "already
offered this request to this technician" guard, so a re-walk can never re-offer to
the same person.

### `technician_availability`, `technician_time_off`, `technician_service_areas`

Declared weekly availability, approved time off and area coverage. **Absence of
rows means "no restriction", not "unavailable"**: with no availability rows a
technician is governed only by their actual bookings, which is what makes the
"future booking ≠ unavailable" rule workable.

### `system_settings`

Key/value config read through `queue_setting()`, `queue_setting_int()` and
`queue_setting_bool()`. Queue keys are listed in `QUEUE-SYSTEM.md`.

## Columns added to existing tables

| Table | Column | Purpose |
| --- | --- | --- |
| `technicians` | `operational_status`, `status_updated_at` | operational state, separate from queue membership |
| `technicians` | `max_daily_hours`, `max_concurrent_jobs`, `max_jobs_per_day` | capacity limits |
| `technicians` | `default_job_minutes` | assumed duration when none is given |
| `service_requests` | `requested_window_start`, `requested_window_end`, `requested_duration_minutes` | the requested time, which every availability check is made against |
| `bookings` | `duration_minutes` | how long an appointment occupies the technician; drives conflict and daily-hours maths |
| `payments` | `rejected_by`, `rejected_at`, `rejection_reason` | the rejection decision, recorded separately from `confirmed_by`/`confirmed_at` (Batch 3) |

Indexes added: `idx_bookings_technician_window (technician_id, scheduled_at)` and
a partial `idx_service_requests_requested_window (requested_window_start)`.

## Service location (map pin)

The customer's chosen repair location lives on `service_requests` — reused, not
duplicated: `location` (the written address), `latitude`, `longitude`. They are
written by `POST /api/service-requests` from the confirmed map pin.

| Guard | Where |
| --- | --- |
| `latitude` in `-90..90`, `longitude` in `-180..180` | `service_requests_latitude_range_check` / `..._longitude_range_check` |
| coordinates stored as a **pair** (a lone latitude cannot place a marker) | `service_requests_coordinates_paired_check` |
| same range check before the value leaves the browser, and again in the route handler | `src/lib/geo.ts` (`toServiceCoordinates`) |
| addresses: control characters stripped, length capped, blank → `NULL` | `sanitizeAddress()` in `src/lib/geo.ts` |

Applying `supabase/migration_service_location.sql` is required: it adds the
columns to a database that predates them, adds those constraints (after clearing
any value that is provably unusable — out of range, or half a pair), tightens the
technician policy below, and creates `technician_pending_offers()`.
`npm run db:check` reports whether it has been applied.

### Who may read the precise location

| Caller | Precise location (address + coordinates) |
| --- | --- |
| the owning customer | yes — their own request |
| a technician the request is **offered** to but who has not accepted | **no** — not through the UI, not through PostgREST, not through Realtime |
| the technician who **accepted** (or who holds an estimate/booking on it) | yes |
| admin / super_admin | yes, within their existing responsibilities |

`assigned_technician_id` is set while a request is still `offered`, so the old
policy (`assigned_technician_id = auth.uid()`) disclosed the address to a
technician who had merely been offered the job. The policy is now keyed on the
**confirmed** state:

```sql
create policy "technicians can view assigned requests"
  on public.service_requests for select
  using (
    (assignment_status = 'accepted' and assigned_technician_id = auth.uid())
    or public.technician_linked_to_request(id)
  );
```

The offer screens still need to render, so they read through
`technician_pending_offers()` — a SECURITY DEFINER function that returns the
caller's own offers with only the fields needed to decide (appliance, problem,
photos, requested window, expiry). It never returns `location`, `latitude`,
`longitude` or the customer's identity, and it refuses any caller that is not an
authenticated technician. The assignment state machine, queue rotation, offer
expiry, eligibility and capacity rules are untouched.

## Troubleshooting: identified issue and reported outcome

Two additive columns on `service_requests` (see
`supabase/migration_troubleshooting.sql`; `npm run db:check` reports whether it
has been applied):

| Column | Meaning |
| --- | --- |
| `issue_id` | the canonical issue the customer **identified**, as a stable catalogue id (`not-cooling`) — chosen from the appliance's list, or a detected suggestion they confirmed |
| `troubleshooting_outcome` | what the customer **reported** after the optional checks: `resolved` / `unresolved` / `skipped`, or `NULL` when they never reached them |

Both are NULLABLE on purpose: a request is valid without an identified issue (the
customer's wording may not be in the reviewed mappings), and no outcome is
required. `NULL` means "not identified" / "not reported" — never "no problem".

Guards:

* `service_requests_troubleshooting_outcome_check` restricts the vocabulary to
  those three values, so no client can store an outcome the app cannot read.
* `issue_category` keeps the human label, and `POST /api/service-requests`
  derives it from the catalogue rather than trusting the request body — a client
  cannot persist an issue that does not belong to the selected appliance, nor a
  label that disagrees with the id.
* `chatbot_resolved` (the pre-existing boolean) is kept in step with the outcome
  by the API, so readers that already use it keep working; the outcome column is
  the detailed source of truth.
* An outcome never changes `status`, a booking or a visit. "It worked" is the
  customer's report, not a professional repair result.

**Matching is not stored and not a diagnosis.** The detected suggestion lives only
in the form; only a confirmed or explicitly selected issue is persisted, and the
customer's `problem_description` is stored exactly as typed.

### The matching catalogue

| Concern | Where |
| --- | --- |
| Canonical appliance → issue catalogue (ids + labels) | `src/lib/appliance-issues.ts` |
| Reviewed English / Tagalog / Bisaya / mixed synonyms + the matcher | `src/lib/issue-matching.ts` |
| Preliminary checks keyed by appliance + issue | `src/lib/troubleshooting.ts` |
| Inline UI for the match, confirmation, guide and outcome | `src/components/TroubleshootingPanel.tsx` |

Matching is deterministic and local: normalise → match approved phrases on word
boundaries → reject negated occurrences → scope to the selected appliance's issue
list → prefer the most specific phrase. No AI model, no translation API, and no
database round trip.

## Offer lifecycle (`migration_offer_lifecycle.sql`)

| Object | Purpose |
| --- | --- |
| `lapse_offer(request, reason, new_status)` | the ONE way to release a live offer: history row marked rejected, `EXPIRED` audit event, assignment cleared, `offers_expires_at` nulled. Never re-offers; server-only (`service_role`). |
| `lapse_offer_on_cancel()` trigger on `service_requests` | when a request becomes `cancelled` with a live offer, the offer is released immediately instead of waiting for the TTL. Re-entrancy is impossible: the second pass sees `old.status` already `cancelled`. |
| `respond_to_offer()` (replaced) | refuses to process an offer on a `cancelled`/`completed` request: releases the offer and answers `outcome = 'cancelled'`. Previously an accept left `assignment_status = 'accepted'` **and** `status = 'cancelled'` — a state `/api/estimates` refuses. |
| `assign_technician_to_request()` (replaced) | (a) never offers a `cancelled`/`completed` request (`outcome: 'unchanged'`, `reason: 'request_closed'`); (b) releases offers whose TTL has already passed **before** the walk, so a dead offer cannot freeze the rotation when the sweep has not run. Those requests become `waiting` (re-matchable), never `matching`. |

Both replaced functions are the tested engine with those additions only — SQL
suite groups 3–18 (100 assertions) cover the walk, the skips, the claim, the
waiting fallback, accept/decline/expiry, the concurrency guards and the new
lifecycle rules.

## Estimate workflow (`migration_estimate_status.sql` + `migration_estimate_workflow.sql`)

Applying both files is required, **in this order** (`npm run db:check` reports
whether they are applied):

| File | Adds |
| --- | --- |
| `supabase/migration_estimate_status.sql` | the three status values the workflow needs (`draft`, `revision_requested`, `superseded`). Separate on purpose: PostgreSQL refuses to *use* an enum value in the same transaction that adds it, and the next file references them in index predicates and policy checks. |
| `supabase/migration_estimate_workflow.sql` | the itemized cost columns, version history, the decision record, the two integrity indexes, `submit_estimate()` / `decide_estimate()`, the tightened estimate policies and the booking guard. |

The estimate is the customer's approval gate: no booking is built on anything but
the **currently approved** version, and a revised quote never overwrites the
version the customer reviewed.

| Object | Purpose |
| --- | --- |
| `estimate_status` (+`draft`, `revision_requested`, `superseded`) | `pending` still means "awaiting the customer's decision", `accepted` the approval, `rejected` the decline. |
| `estimates` itemization (`scope`, `labor_cost`, `parts_cost`, `other_cost`, `other_description`) | the quote a customer can read line by line. `parts_cost = 0` is normal — plenty of repairs need no parts. |
| `estimates_amounts_check` | `estimated_cost = round(labor + parts + other, 2)` — the stored total can never disagree with the lines it claims to sum, whatever a browser sends. |
| `estimates_other_description_check` | an additional charge above 0 must say what it is for. |
| version history (`version`, `supersedes_id`, `superseded_by`) | a revision is a NEW row; the replaced row keeps its amounts, scope and timestamps. |
| decision record (`submitted_at`, `decided_at`, `decided_by`, `approved_at`, `decision_note`, `revision_reason`, `revision_requested_at`) | who decided what, and when. `approved_at` is set once and never cleared, so an approval that a later revision superseded stays on the record. |
| `uniq_live_estimate_per_request` / `uniq_approved_estimate_per_request` | at most one working version and one current approval per request. Superseded rows are history and are deliberately unconstrained. |
| `submit_estimate(...)` | the ONLY writer of estimate rows. Locks the request, re-checks the assignment against the data, computes the total, supersedes the version the customer has seen, and answers `draft_saved` / `submitted` / `revised` (or `not_assigned` / `request_closed`). Server-only (`service_role`). |
| `decide_estimate(estimate, actor, decision, reason)` | approve / decline / request a revision on the EXACT version awaiting a decision. The `status = 'pending'` guard is the concurrency control: a retry or a second tab gets `outcome: 'not_pending'` and changes nothing. It re-reads the actor's role from `public.users`, never from a client claim. Server-only. |
| `require_approved_estimate_for_booking` trigger on `bookings` | a booking that names an estimate must name the current approved one; a booking with **no** estimate (administrative/legacy scheduling) is untouched. |

An estimate decision writes one row and nothing else: no booking, no queue event,
no re-assignment, no payment. Booking, capacity, scheduling and payment
verification remain separate states with separate vocabularies.

## Workflow enforcement: RLS + triggers (`migration_booking_payment_status.sql` + `migration_rls_workflow_enforcement.sql`)

The audit found the API routes consistently stricter than the Row Level Security
policies underneath them, so a client holding the anon key and a valid JWT could
call PostgREST directly and bypass a rule the UI enforced. These two files move the
boundary into the database. **No new table and no second status system**: the
completion step reuses `booking_status`.

### The booking lifecycle, now enforced in three places

```
pending → in_progress → awaiting_inspection → awaiting_payment → completed
  ↑ technician/staff      ↑ technician           ↑ CUSTOMER confirms   ↑ ADMIN verifies
  └→ cancelled (customer while pending; staff any time before completed)
       └→ the request returns from `booked` to `quoted`, so the customer can book
          again with the estimate they already approved
```

| Object | What it enforces |
| --- | --- |
| `booking_status` (+`awaiting_payment`) | the state between a confirmed inspection and a verified payment. One vocabulary, no parallel column. |
| policy `customer creates booking from own request` | the row must be `status = 'pending'`, must name an `estimate_id`, and `booking_creation_allowed()` must confirm that estimate is the CURRENT APPROVED version for the request actually assigned to that technician. Previously `estimate_id` could be null and `status` could be `'completed'`. |
| policy `admin creates bookings` | staff keep the documented administrative-scheduling path (a booking with no estimate). |
| policy `participants update their bookings` | still decides which row; the trigger below decides what may change. |
| trigger `enforce_booking_update_rules()` | the transition matrix per role, plus immutability of `customer_id`, `service_request_id`, `technician_id`, `estimate_id`, `scheduled_at` and `duration_minutes`. A technician may start a job and send it for inspection; the customer may cancel while `pending` or confirm their inspection **with a written note**; staff may drive the repair forward and cancel, but may not attest the customer's inspection and may not complete. `final_cost` is technician/staff-only, and `inspection_confirmed_at` is set by the database, never by the caller. Nothing reaches `completed` here. |
| policy `customer submits own payment` | `status = 'pending_verification'`, `confirmed_by`/`confirmed_at` null, `amount = bookings.final_cost`, and the booking must be at `awaiting_payment` (or already `completed` with no confirmed payment — the pre-policy path). Self-verification is impossible, and a payment can no longer be attached to somebody else's booking. |
| policy `technician creates own estimates` | the technician must be the request's `assigned_technician_id` with `assignment_status = 'accepted'`. This also closes an **address disclosure**: `technician_linked_to_request()` returns true for a technician with any estimate on the request, so an estimate inserted for an arbitrary request used to unlock the customer's address and coordinates. |
| policies `customer creates/reads/updates own service requests` | replaces the `for all` grant. `enforce_service_request_customer_update()` pins `assignment_status`, `assigned_technician_id`, `offers_expires_at` and `customer_id` to the assignment engine, makes a closed request final, and limits the status vocabulary a customer may use to `cancelled`, or `booked` when a live booking exists. |
| trigger `reopen_request_after_booking_cancel()` | keeps the two rows consistent when an appointment is cancelled: once the **last** live booking for a request is cancelled, the request goes `booked → quoted`. `POST /api/bookings` accepts only `quoted`/`open`, so without this a request would be stranded at `booked` with a cancelled booking and the customer could never book again. The technician's accepted assignment, the approved estimate and the cancelled booking row are all left alone — no queue turn is re-spent, the price the customer approved still stands, and the cancellation stays in the record. |
| `confirm_payment(payment_id, actor)` | **the only writer of a completed repair.** One transaction: re-reads the actor's role from `public.users` (an administrator, never a claim), verifies the payment, closes the booking, archives `service_history`, closes the request and frees the technician's slot. The booking is validated **before** anything is written, so an outcome that does not close a repair leaves the payment untouched. Idempotent — a second call returns `outcome: 'not_pending'` and changes nothing. `confirmed_legacy` covers a booking already completed before this policy (the reference is still verified, history is not rewritten); `booking_cancelled` covers an appointment cancelled while the reference was waiting (the payment stays pending for the administrator to reject). Server-only (`service_role`). |

Both triggers treat a **direct database session** (the SQL editor, psql, a migration,
the PGlite harness) as trusted, and `service_role` as trusted. That is not an HTTP
hole: PostgREST always sets the role claim from the JWT, so a browser request always
arrives with it set (`anon` / `authenticated`) and can never reach that branch.

`supabase/schema.sql` carries the same enum value, policies, helper functions and
triggers, so a fresh install and an upgraded project end in the same shape.

## Atomic booking (`migration_atomic_booking.sql`)

Batch 1 made the *rules* explicit; Batch 2 makes the *write* indivisible. Before it,
`POST /api/bookings` was three statements — insert the booking, update the request to
`booked`, increment the technician's `active_job_load` — and it read the schedule
before writing with nothing holding still in between. Two customers could therefore
each be told they had the same technician at the same time, a crash between the
writes left a booking with the request still `quoted`, and a request could collect
two live bookings.

Three invariants now live in the database, not in the route:

| Invariant | Object | Why it is here |
| --- | --- | --- |
| **One live booking per repair request** | partial unique index `uniq_active_booking_per_request` on `bookings (service_request_id) where status <> 'cancelled'` | A cancelled row stays as history and must not block rebooking (the Batch 1 flow), while a `completed` booking still occupies its request. |
| **No overlapping appointment for one technician** | trigger `trg_booking_no_overlap` → `enforce_booking_no_overlap()` | The blocking set is the same one `technician_schedule_conflict()` uses — `pending`, `in_progress`, `awaiting_inspection` — and the two must stay in step. Intervals are half-open: a 10:00–12:00 job and a 12:00–13:00 job do not clash. |
| **Booking creation is one transaction** | `create_booking_atomic()` | Lock order: the request row `FOR UPDATE`, then the account / technician / appliance-membership rows (step 17), then a per-technician advisory lock. Every check and every write happens inside it. |
| **The assigned technician is still qualified for the appliance** | `create_booking_atomic()` step 5 → `technician_qualification_failure()` (step 17) | An `accepted` assignment is a claim about the past. A specialization can be edited (by the technician), an account suspended or deactivated, and an administrator can take somebody out of one rotation — none of which releases the request they already accepted. The queue engine's own qualification rule is re-applied at the moment the booking is written. The check also locks each row it reads, so a concurrent qualification change cannot commit between the check and the booking: the writer waits until the booking transaction ends, and then only two orders are possible — change first (booking refused) or booking first (made while the technician was still eligible). Strength per row: `FOR SHARE` on `users` and `technician_queue_state`, which this transaction only reads, and `FOR NO KEY UPDATE` on `technicians`, which it writes later (the counter) — a share lock there would have to be upgraded, and an upgrade cannot jump a writer already queued behind it. |

| **A cancellation releases the slot in the same transaction** | trigger `release_slot_after_booking_cancel` (step 18) → `release_technician_slot()` + `refresh_technician_operational_status()` | Fires on the transition into `cancelled` from a slot-holding status (`booking_status_holds_slot()`), for every writer — the API, an administrator, a service-role script. A failure in either call aborts the cancellation with it, so a cancelled booking can never leave the counter inflated. Idempotent per booking: a repeat write, or an `updated_at` touch on an already-cancelled row, releases nothing. `confirm_payment()` keeps its own decrement for completion, and `completed` holds no slot, so the two can never both fire. |

### Why a trigger rather than an `EXCLUDE` constraint

The textbook answer is `EXCLUDE USING gist (technician_id WITH =, tstzrange(...) WITH &&)`.
`btree_gist` is not available in the PGlite build the test suite runs on, so the
constraint could not be tested before shipping — an untestable guard is worse than a
tested one. The trigger takes
`pg_advisory_xact_lock(hashtext('booking_technician:' || technician_id))`, which
serializes concurrent writers for the same technician for the length of their
transaction, and raises SQLSTATE **`23P01`** (the same code a real exclusion
constraint uses) so a caller can treat the two identically.

The trigger is deliberately named `trg_booking_no_overlap` so that it fires **after**
`require_approved_estimate_for_booking` (Postgres fires `BEFORE` triggers in
alphabetical order). An estimate problem therefore still reports the estimate
message rather than a scheduling one.

### `create_booking_atomic(p_request_id, p_estimate_id, p_actor, p_scheduled_at, p_duration_minutes, p_notes)`

Returns `jsonb`. `outcome` is one of:

`booked` · `already_booked` (idempotent retry; carries the existing `booking_id`) ·
`request_not_found` · `forbidden` · `request_not_bookable` (`reason`: `not_assigned`,
`status_*`) · `technician_not_eligible` (`reason`: `not_in_queue`, `not_available`,
`suspended`; step 17 — the assignment is stale, nothing is written) ·
`estimate_invalid` (`reason`: `wrong_request`, `wrong_technician`, `superseded`,
`not_approved`) · `invalid_schedule` · `invalid_input` ·
`outside_availability_window` · `schedule_conflict` · `capacity_concurrent_job` ·
`capacity_daily_jobs` · `capacity_daily_hours`.

The scheduling and capacity outcomes carry a `message` from `queue_reason_message()`,
so the wording the customer sees and the wording the queue screens show come from one
place. The one-live-booking check runs **before** the request-state rules: a retry of
an attempt that already succeeded must answer "you already have a booking", not "this
request is not bookable", which is what the request's own `booked` status would
otherwise report.

It reuses the queue migration's helpers unchanged —
`technician_within_availability()`, `technician_schedule_conflict()`,
`technician_capacity_failure()`, `queue_reason_message()` — plus (step 17)
`technician_qualification_failure()` for the appliance-type half of eligibility, and
finishes with `refresh_technician_operational_status()` so the technician's cached
status is right immediately.

### A cancellation gives the slot back atomically

A booking holds a technician's slot from the moment `create_booking_atomic()` writes it
until it is given back. There are exactly two ways out, and both are database-side:

| Event | Writer | What happens |
| --- | --- | --- |
| the appointment is cancelled | trigger `release_slot_after_booking_cancel` (AFTER UPDATE on `bookings`, step 18) | calls `release_technician_slot()` **and** `refresh_technician_operational_status()` in the same transaction as the status change |
| the repair is completed | `confirm_payment()` | frees the slot together with `jobs_completed`, the archive row and the request status, in one transaction |

Until step 18 the release was a second call from `PATCH /api/bookings/:id`, *after* the
status change had already committed. A failed call left the booking cancelled and the
counter inflated for good, and a cancellation written anywhere else — an administrator,
a service-role script — released nothing at all. `release_technician_slot(p_technician_id)`
remains the shared primitive: one statement, `greatest(0, …)` so the counter cannot go
negative, and the reason two cancellations for one technician cannot undo each other. The
route no longer calls it, and no application code does.

`booking_status_holds_slot()` names the statuses that hold a slot (`pending`,
`in_progress`, `awaiting_inspection`, `awaiting_payment`); `completed` and `cancelled`
hold none. That is what makes a repeat cancellation — or a `completed → cancelled` write —
release nothing.

**The counter is a write-only ledger today, and that is worth stating.** Nothing reads
`technicians.active_job_load`: not `technician_capacity_failure()` (it counts live
`bookings` rows for the concurrency and daily limits), not `compute_technician_status()`
(derived from booking rows), not `technician_queue_snapshot()`, and not the UI. An
inflated counter changes no decision and no screen *yet* — the invariant is maintained
because the column is part of the documented contract, and the next reader of it
(load-aware capacity, a "current load" view, scoring) would otherwise inherit silently
corrupt data. Anything that starts reading it should record that here.

The request side of a cancellation stays where Batch 1 put it: the trigger
`reopen_request_after_booking_cancel()` returns the request from `booked` to `quoted`
once its last live booking is gone, whichever writer cancelled it.

### The direct-insert path is gone

Both `bookings` INSERT policies are dropped, and `create_booking_atomic()` /
`release_technician_slot()` are revoked from `public`, `anon` and `authenticated` and
granted to `service_role` only — the same shape as `submit_estimate`,
`decide_estimate`, `respond_to_offer` and `confirm_payment`. With no INSERT policy,
RLS denies every direct insert for `authenticated`, so the atomic path is the only
path. The unique index and the trigger stay in place as defence in depth for the
service role itself.

`POST /api/bookings` maps the outcome to a status code: `201` booked, `409` for
`already_booked`, `schedule_conflict`, `outside_availability_window`, the `capacity_*`
outcomes, `estimate_invalid`, `technician_not_eligible` and `request_not_bookable`;
`400` for `invalid_schedule` and malformed input; `403` for `forbidden`; `404` for
`request_not_found`. A conflict is never reported as a `500`, and an unrecognised
outcome is never reported as success. If the function is missing (deployment ahead of
database) the route answers `503 BOOKING_SETUP_REQUIRED` naming the file — it never
falls back to writing the booking by hand.

### Verifying it on a live project

`npm run db:check` covers the two functions. The index, the trigger and the dropped
policies are invisible to PostgREST, so run these in the SQL editor:

```sql
select indexdef from pg_indexes
 where schemaname = 'public' and indexname = 'uniq_active_booking_per_request';

select t.tgname, pg_get_triggerdef(t.oid)
  from pg_trigger t join pg_class c on c.oid = t.tgrelid
 where c.relname = 'bookings' and not t.tgisinternal;

select policyname, cmd from pg_policies
 where schemaname = 'public' and tablename = 'bookings' and cmd = 'INSERT';  -- expect zero rows

-- Batch 1's companion trigger, which db:check cannot see either:
select tgname from pg_trigger where tgname = 'reopen_request_after_booking_cancel';
```

## Booking eligibility (`migration_booking_eligibility.sql`)

### The defect it closes

`create_booking_atomic()` validated the request's **workflow state** — the assignment
had to be `accepted`, and the estimate had to be the current approved version of the
same request written by the same technician — but it never re-checked that the
technician is still **qualified for the request's appliance type**.

Qualification *is* enforced when an offer is sent: `technician_eligibility_failure()`
requires an active membership of the appliance's queue, and membership mirrors
`technicians.specializations`. It was never enforced when the booking is *written*, and
an accepted assignment goes stale in between:

* a technician removes an appliance from their own specializations (the profile form
  writes `technicians.specializations` directly) — `sync_queue_membership()` deactivates
  their membership, the request they already accepted is untouched;
* an administrator unapproves, suspends or deactivates the account: same sync, same
  untouched request;
* `admin_queue_override(…, 'remove')` takes a technician out of one rotation, which is a
  documented administrative action.

In every one of those the request stayed `accepted` + `quoted` with an approved
estimate, so the customer could confirm the appointment: a booking row was written for a
technician the platform's own rules forbid from taking that work, the request flipped to
`booked` and `active_job_load` moved. Where that technician was the last member of the
queue, the same path let a customer book an appliance type the platform cannot service at
all. Group 23 of the SQL suite encoded exactly this as *expected* behaviour: its fixtures
assigned requests to a technician with no specializations, and every booking succeeded.

### What it changes

| Object | Role |
| --- | --- |
| `technician_qualification_failure(technician, appliance_type)` | The qualification half of the eligibility gate — account active, technician approved, not suspended, and an **active** membership of the appliance's queue. Returns `NULL` when qualified, otherwise `not_available` / `suspended` / `not_in_queue`. |
| `technician_eligibility_failure(…)` | Re-declared to *delegate* its first four checks to the predicate above, with the same signature, the same reason strings and the same order. One definition, two callers (the queue walk and the booking transaction), so they cannot disagree about who may take an appliance. |
| `appliance_has_qualified_technician(appliance_type)` | Read-only: does **anybody** currently qualify for this appliance type? It exists so the API can choose the honest message — "nobody covers this appliance" vs "the technician assigned to you is no longer qualified" — without exposing the queue. |
| `create_booking_atomic(…)` | One new check (step 5, before the estimate is examined) and one new outcome, `technician_not_eligible`. |

A refused attempt mutates **nothing**: the check sits before the technician's advisory
lock and before every write, so there is no booking row, the request keeps its status and
its assignment, `active_job_load` is untouched and the queue rotation does not move.

### Customer-facing behaviour

`POST /api/bookings` answers `409` with a message chosen from the outcome: if nobody
covers the appliance type at all it says so and explains that the request stays in line;
if the assigned technician lost the qualification it says that and points at support. The
estimate card replaces its "Confirm booking" form with the shared
`customerAssignmentCopy()` wording whenever the request has no accepted technician, so a
button that could only fail is never offered.

### What it deliberately does not do

It does not release the stale assignment, and it does not re-offer the request. That is a
workflow decision rather than a guard, it would change rows on a path the customer did
not ask for, and it needs its own migration plus the admin surface that triggers it. Until
then the request stays where it is, the customer is told the truth, and no false booking
is written. The read-only sweep at the end of the migration lists the requests already in
that state:

```sql
select r.id, r.appliance_type, r.assigned_technician_id,
       public.technician_qualification_failure(r.assigned_technician_id, r.appliance_type) as reason,
       public.appliance_has_qualified_technician(r.appliance_type) as somebody_else_can_take_it
  from public.service_requests r
 where r.assignment_status = 'accepted'
   and r.status in ('quoted', 'open')
   and public.technician_qualification_failure(r.assigned_technician_id, r.appliance_type) is not null;
```

## Payment decision (`migration_reject_payment.sql`)

Batch 1 made `confirm_payment()` the only writer of a completed repair. Batch 3 gives
the *other* decision — refusing a reference — the same shape, because the audit found
it was the last one living in a route:

* `PATCH /api/payments/:id` performed a raw service-role `update` of `payments`, so
  nothing in the database enforced that only an administrator may reject;
* it wrote `confirmed_by` and `confirmed_at`, so a rejection was recorded as a
  verification and "who verified this" became indistinguishable from "who rejected
  this";
* the customer was never told, so the resubmission the administrator was promised
  never reached them.

### The two decisions are separate, on purpose

| Decision | Function | Columns written | Effect on the repair |
| --- | --- | --- | --- |
| Verify a reference | `confirm_payment(p_payment_id, p_actor)` | `status='confirmed'`, `confirmed_by`, `confirmed_at` | completes the repair (booking, history, request, slot) in the same transaction |
| Refuse a reference | `reject_payment(p_payment_id, p_actor, p_reason)` | `status='rejected'`, `rejected_by`, `rejected_at`, `rejection_reason` | **none** — the repair stays where it is and the customer can submit a new reference |

`reject_payment()` returns `jsonb` with `outcome`:

| outcome | when |
| --- | --- |
| `rejected` | success; carries the updated `payment` row, the reason and the booking status |
| `forbidden` | the actor's role, re-read from `public.users`, is not `admin`/`super_admin` |
| `invalid_input` | `missing_reason` (empty or whitespace-only after trimming) or `reason_too_long` (over 500 characters) |
| `not_found` | no such payment |
| `not_pending` | the payment was already confirmed or already rejected — idempotent, so a retry changes nothing |

Every expected condition is an outcome rather than a raised exception, unlike
`confirm_payment()` (which raises for a non-administrator). That is deliberate: the
route can answer 403/400/404/409 with a readable message, and a decision that loses a
race reads as a conflict rather than a 500. The role check, the row lock and the
transition are all still the database's.

### Rejecting never touches the repair

A rejection writes **one row**. It does not change the booking, the service request,
the technician's `active_job_load`, or `service_history`, and it does not re-open a
closed request — there is no refund, fee or penalty in SPARKServ, and this file does
not invent one. The customer submits a new reference against the same repair (the
submission policy excludes `rejected` rows from its "already paid" reasoning, and the
customer's booking page re-opens the payment form).

Rejecting a pending reference whose booking is already `completed` — a repair closed
under the pre-policy path — is allowed for the same reason: only the payment row is
involved, so the completed booking and its archived history stay exactly as they were.

### The guards

| Object | What it enforces |
| --- | --- |
| `payments_decision_metadata_check` | the row's metadata matches its status: pending carries neither decision, `confirmed` carries both confirmation columns and no rejection columns, `rejected` carries `rejected_by`/`rejected_at` and a reason of 1–500 non-whitespace characters and **no** confirmation columns |
| `enforce_payment_decision_rules()` + `enforce_payment_decision_rules` trigger (BEFORE UPDATE) | `pending → confirmed\|rejected` once, then the row is **frozen**: its status and all five decision-metadata columns (`confirmed_by`, `confirmed_at`, `rejected_by`, `rejected_at`, `rejection_reason`) become immutable, so a reason, a verifier or a timestamp can never be rewritten after the fact while the row still reads `confirmed`/`rejected`. The **recorded actor must be an administrator** (`admin`/`super_admin` in `public.users`) — the RPCs re-read the *caller's* role, but a direct writer could otherwise name a customer or a technician as the person who decided the money. `booking_id`/`customer_id`/`payment_method`/`gcash_reference`/`amount` are immutable from the start. `confirm_payment()` and `reject_payment()` are unaffected: both only ever write a row that is still `pending_verification`. |
| policy `customer submits own payment` (recreated) | the Batch 1 rule with three added predicates: a submission cannot carry `rejected_by`, `rejected_at` or `rejection_reason` either. Without that, a customer could pre-load junk rejection metadata and the trigger above would then refuse the verification of their own row, stranding the repair at the payment step |

Both guards hold for **any** writer, including the service role — which is the writer
the old route used. `confirm_payment()` was not modified: every one of its four exit
paths already satisfies the trigger.

One subtlety worth keeping: `btrim(x)` in PostgreSQL removes **spaces only**. A
whitespace-only reason (tabs, newlines, a vertical tab) would otherwise pass as an
explanation and reach the customer as a blank reason, so the function, the constraint
and the trigger all trim with an explicit character set:

```sql
btrim(x, E' \t\n\r\f' || chr(11))
```

`chr(11)` is the vertical tab, written out rather than as `E'\v'` so the set never
depends on how a PostgreSQL build reads that escape. An unrecognised escape would be
taken literally and silently add the letter `v` to the set — which would trim the
leading `v` off a reason like *"voucher not received"* while leaving a vertical tab in
place. The set covers space, tab, LF, CR, FF and VT; `\f` and `\t` are standard
PostgreSQL escapes, so they are safe to write directly.

### Who may write a payment: the RPCs, and nobody else

A payment row is written by exactly two SECURITY DEFINER functions — `confirm_payment()`
and `reject_payment()` — and by nothing else. The table privileges are narrowed to what
each role actually does:

| Role | Table privileges on `payments` | Why |
| --- | --- | --- |
| `postgres` (owner) | all | owns the table, both decision functions and the decision trigger |
| `service_role` (the application's server key) | **`SELECT` only** | the routes read payments with the service-role client (the row returned after a decision, and the "already processed" check). They never write: a decision is the RPC's job |
| `authenticated` (a signed-in customer or admin) | **`SELECT`, `INSERT`** | the customer workflow: read your own payment records, and submit a reference. The `INSERT` is pinned by the policy below to `pending_verification`, the customer's own booking, the exact recorded cost and no decision metadata |
| `anon` (no session) | **none** | every path that touches a payment row goes through `getCurrentUser()` (or the service-role client behind it), so an unauthenticated caller never reaches this table |

**Why the privileges are narrowed rather than left to RLS.** Supabase's default
privileges grant **all** on a new public table to `anon`, `authenticated` and
`service_role`, and RLS is then left to decide the *rows*. Three of those privileges are
not row-scoped at all — `TRUNCATE` ignores RLS completely, and no policy can restrict
`REFERENCES` or `TRIGGER` — so for this table each role is revoked down to the operations
it uses. The **policies are unchanged**: this narrows the privileges, not the row rules,
and the two are enforced independently. A privilege the role does not hold is refused
before RLS is ever consulted (`42501`), while `SELECT` and `INSERT` still go through the
policies (`customer_id = auth.uid()` to read your own records; the submission rule
above).

The revoke is safe because SECURITY DEFINER functions run with the **owner's**
privileges, not the caller's: the caller only needs `EXECUTE` on the function, which is
granted to `service_role` alone. Verified in the test suite, which asserts the effective
privileges for every table privilege by name (`SELECT`, `INSERT`, `UPDATE`, `DELETE`,
`TRUNCATE`, `REFERENCES`, `TRIGGER`) for all three roles, the ACL bits, `prosecdef`/owner
for both functions, and that a direct `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE` as the
service role fails with SQLSTATE **42501** while both RPCs still succeed and
`confirm_payment()` still completes a repair.

To confirm it on a live project (privileges are invisible to PostgREST, so this is a
manual check):

```sql
select grantee, privilege_type from information_schema.role_table_grants
 where table_schema = 'public' and table_name = 'payments'
 order by grantee, privilege_type;
-- expect authenticated: INSERT, SELECT
--        service_role:  SELECT
--        anon:          no rows at all
-- and no UPDATE, DELETE, TRUNCATE, REFERENCES or TRIGGER for any of them
```

## Functions

See the RPC table in `QUEUE-SYSTEM.md`. The architectural point:

- **Read** functions (`technician_queue_snapshot`, `technician_pending_offers`)
  are callable by authenticated technicians/admins and return only
  non-sensitive fields.
- **Mutation** functions (`assign_technician_to_request`, `respond_to_offer`,
  `expire_stale_offers`, `consume_queue_turn`, `submit_estimate`,
  `decide_estimate`, `confirm_payment`, `create_booking_atomic`,
  `release_technician_slot`, `reject_payment`) are revoked from `anon` and
  `authenticated` and granted to `service_role` only. They take a row lock on the
  request plus an advisory lock per request, which is what makes concurrent
  assignment safe.
- **Eligibility predicates** (`technician_eligibility_failure`,
  `technician_qualification_failure`, `technician_capacity_failure`,
  `technician_within_availability`, `technician_schedule_conflict`,
  `appliance_has_qualified_technician`) are server-only for the same reason: they
  reveal who is qualified for what, which is queue information a customer must
  never read. They are called from SECURITY DEFINER functions, never from the
  browser.

## Row Level Security

| Table | Who can read | Who can write |
| --- | --- | --- |
| `technician_queue_state` | technicians (their own queues), admins | nobody through the API — only SECURITY DEFINER functions, plus admins through `admin_queue_override` |
| `technician_queue_events` | the technician the row is about, admins | only SECURITY DEFINER functions (no client insert path) |
| `technician_availability`, `technician_time_off`, `technician_service_areas` | owner + admins | owner + admins |
| `technician_offer_history` | owner + admins | admins / service role via RPC |
| `service_requests`, `bookings` | a customer owns theirs; a technician sees a request only once the assignment is **accepted** (or via an estimate/booking), and reads unaccepted offers through `technician_pending_offers()`; admins see all | unchanged |
| `estimates` | the assigned technician sees their own versions; a customer sees every version sent to them for their own request — **never a `draft`**, which is the technician's working copy; admins see all | a technician may insert and update their own rows, but the `WITH CHECK` only allows `status in ('draft','pending')`: preparing and submitting, never deciding. Approval/decline/revision run through `decide_estimate()` (`service_role`), so an approval cannot be forged from a browser. |
| `payments` | the customer who submitted it, and admins | **insert only**, by the customer who owns the booking, pinned to `pending_verification` with no decision metadata of any kind. There is deliberately **no UPDATE policy** (and no DELETE policy), and the table privileges are narrowed to match — `authenticated` holds `SELECT`/`INSERT`, `anon` nothing, `service_role` `SELECT` only — so a client write is refused by the **privilege** before RLS is consulted, and `SELECT` still returns only the caller's own rows. A decision is never a client write: both `confirm_payment()` and `reject_payment()` run as `service_role` and re-read the actor's role, so the two RPCs are the only writers. |

`is_technician()` and `is_admin()` back those policies; both derive from
`public.users.role` through `current_role()`, which reads `auth.uid()`.

## Triggers

| Trigger | Effect |
| --- | --- |
| `sync_queue_membership_trigger` (technicians) | an approved technician's specializations are synced into `technician_queue_state` — joining a queue at the end, leaving it on removal |
| `sync_queue_membership_user_trigger` (users) | deactivating an account removes it from the rotations (`REMOVED`) |
| `on_auth_user_created` (auth.users) | creates `public.users` (+ a `technicians` row for the technician role) from signup metadata |
| `require_approved_estimate_for_booking` (bookings, BEFORE INSERT) | refuses a booking that names an estimate which is not the current approved version |
| `trg_booking_no_overlap` (bookings, BEFORE INSERT/UPDATE) | refuses an appointment that overlaps another live appointment for the same technician, and serializes concurrent writers for that technician on an advisory lock (raises `23P01`). Named so it fires after the estimate check above. |
| `enforce_booking_update_rules` (bookings, BEFORE UPDATE) | the transition matrix per role, plus immutability of the booking's identifying columns (Batch 1) |
| `reopen_request_after_booking_cancel` (bookings, AFTER UPDATE) | returns a request from `booked` to `quoted` once its last live booking is cancelled (Batch 1) |
| `enforce_payment_decision_rules` (payments, BEFORE UPDATE) | `pending → confirmed\|rejected` once, then the whole decision is frozen — status and all five metadata columns — so a rejection reason, a verifier or a timestamp can never be rewritten after the fact; a rejection can never carry confirmation metadata (or the reverse), and the payment's identifying columns are immutable (Batch 3) |

## Known state worth flagging

- **`appliances.model_number` and `.serial_number` are unbounded `text`, and the 50-character
  cap is not in the database.** Both screens write those columns straight through the RLS
  client, so the limit lives in the field (`maxLength`), in the payload builder
  (`cleanCode()` in `src/lib/appliance-fields.ts`) and in the suite — but a direct PostgREST
  write can still store more, because a check constraint is the only real enforcement and it
  needs a migration. Deliberately not taken here: migration 19 is reserved for
  `withdraw_service_request()`. The same applies to `purchase_date` — the picker refuses a
  future date, while the column itself would accept one.

- **Every migration in the upgrade path is applied — steps 1–18.**
  `npm run db:check` exits 0 and reports all 18 applied (76 checks passed), with
  `create_booking_atomic()` and `release_technician_slot()` (step 15),
  `reject_payment()` (step 16), `technician_qualification_failure()` and
  `appliance_has_qualified_technician()` (step 17) and `booking_status_holds_slot()`
  (step 18) all exposed to `service_role` and confirmed live.
  `supabase/migration_reject_payment.sql` (step 16) and
  `supabase/migration_booking_eligibility.sql` (step 17) are mirrored in `schema.sql`
  and covered by groups 24 and 26 of the SQL suite.

  **Order mattered between 16 and 17:** they are independent files (different
  objects), but 17 had to come after 15 and after 3, because it re-declares
  `technician_eligibility_failure()` and calls `normalize_appliance_type()`.

  The step-17 defect is therefore closed **in the database**: a request whose accepted
  technician has lost the qualification (or an appliance type with nobody in its queue)
  can no longer be booked. It is closed only for code that calls
  `create_booking_atomic()` — the last committed revision writes the booking itself, so
  it bypasses the guard entirely and is refused by RLS instead (step 15 withdrew the
  INSERT policies). The read-only sweep in *Booking eligibility* above still lists any
  request that is ALREADY in the stale state; it changes nothing.

  Two things to know about step 16, now that it is applied:

  * **The window is closed, and it closed in the safe order.** The release's route calls
    `reject_payment()` rather than writing the decision itself, and answers
    `503 PAYMENT_SETUP_REQUIRED` naming the file if the function is ever missing. The
    *committed* route is the broken case: its raw write sets `confirmed_at` on a rejected
    row, which step 16's CHECK constraint refuses, so an administrator gets a 500 until
    the release is deployed. There is no fallback write path in the new route, deliberately.
  * **Step 16 also narrows the table privileges on `payments`**: `service_role` is
    revoked to `SELECT`, and `anon`/`authenticated` are revoked to nothing with
    `SELECT`/`INSERT` granted back to `authenticated` alone. Nothing in the application
    needs more — the only writers are the two SECURITY DEFINER functions, and an
    unauthenticated caller never reaches this table — but a project that added its own
    service-role payment script, or an anon-key integration that read payments, would
    break: check with the verification query above before applying. Both statements are
    idempotent, so re-running the file is harmless.
  * **The Batch 2 and Batch 3 guards are not probeable through PostgREST** (a partial
    unique index, and triggers), so `db:check` proves the *functions* exist, not the
    guards. Confirm them with the verify block at the end of each migration. The same
    blind spot covers `reopen_request_after_booking_cancel` (Batch 1) and
    `enforce_payment_decision_rules` (Batch 3).

- **Still owed on the live project** (documented, not yet executed): the two-session
  concurrency test for Batch 2 (`TESTING.md`, "What group 23 cannot prove"),
  `npm run verify:queue` (it creates and cleans up fixtures, so it is a live write and
  is run deliberately), the manual UI walkthrough, and observing the cron fire.

- **Closed by step 18: the technician-slot release is no longer a route responsibility.**
  `create_booking_atomic()` moved `active_job_load` inside the database, but the release
  used to be a second call from `PATCH /api/bookings/:id` that logged and continued if it
  failed, and any cancellation that did not go through that route decremented nothing.
  `supabase/migration_cancel_release.sql` (step 18) makes an AFTER UPDATE trigger on
  `bookings` authoritative — the same shape as the request half
  (`reopen_request_after_booking_cancel`) — and the route's `handleCancellation()` is
  gone, so the two can never both decrement. Group 27 of the SQL suite covers it.

- **Still open, tracked separately: `completed → cancelled` for a TRUSTED writer.**
  An earlier draft of this note claimed the transition matrix permits it for staff.
  Re-reading the function, that is wrong: `if old.status = 'completed' then raise
  exception 'A completed repair is final and cannot be edited'` sits **before** every role
  branch, so the customer, the technician, an administrator and a super admin are all
  refused (group 27 asserts it with an administrator's session). What the staff branch
  allows is `any OTHER status → cancelled`, which is the documented staff power. The only
  writer that can still cancel a completed booking is a **trusted** one — the service role
  or a direct database session — because the matrix returns early for both by design
  ("Trusted server paths keep full control"). No application path does that. It is
  harmless to the counter (`completed` holds no slot, so nothing is released twice), and
  the residual question — should `completed` be terminal even for a trusted writer — is a
  transition-policy decision, tracked separately rather than bundled into step 18.
- `supabase/schema.sql` now also carries `bookings.duration_minutes`,
  `service_requests.requested_window_start` / `requested_window_end` /
  `requested_duration_minutes` and their check constraint. The queue migration adds
  them with `add column if not exists`, so both paths stay equivalent; the columns
  are repeated in the table definitions because the harness loads `schema.sql`
  *before* the migrations, and the Batch 2 functions in that file reference them.

- `supabase/schema.sql` still contains the **model-v1** inline definition of
  `technician_queue_state` (no `queue_position`/`is_active`); the redesign
  migration upgrades it in place with `add column if not exists` instead of
  duplicating a table. That keeps one table and one owner of its definition, with
  no duplicate queue tables — but it does mean `schema.sql` alone is **not** a
  complete queue install. The three migrations above are mandatory.
- `schema.sql` is also not self-contained in one further sense: it calls
  `public.is_admin()` before that helper is defined later in the same file. The SQL
  harness works around this by extracting the helper block and running it first
  (`scripts/test-queue-sql.mjs`). Reordering `schema.sql` is a worthwhile
  follow-up.

