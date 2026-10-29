# SPARKServ — Architecture

SPARKServ is a Next.js 14 App Router application on Supabase (Postgres + Auth +
Storage + RLS). The queue redesign did not change that shape; it changed **where
the queue decision lives**, and that is the most important thing on this page.

## Layering

```
┌──────────────────────────────────────────────────────────────────┐
│ 1. Postgres (Supabase)                                           │
│    The ONLY place that decides who gets work.                    │
│    • queue tables + audit trail      (migration_queue_redesign)  │
│    • assign / respond / expire / eligibility / capacity functions│
│    • row lock + advisory lock per request                        │
│    • RLS: clients may read the queue, never write it             │
└───────────────▲──────────────────────────────────────────────────┘
                │ typed RPC wrappers; service-role for mutations
┌───────────────┴──────────────────────────────────────────────────┐
│ 2. Server logic                                                  │
│    src/lib/assignment.ts   — RPC wrappers (assign, respond,      │
│                              expire, conflict check, status)     │
│    src/lib/queue.ts        — client-safe vocabulary + view model │
│    src/lib/service-time.ts — timezone/duration helpers           │
│    src/app/api/**          — route handlers (auth, validation)   │
└───────────────▲──────────────────────────────────────────────────┘
                │ server components read; server routes mutate
┌───────────────┴──────────────────────────────────────────────────┐
│ 3. UI                                                            │
│    Server components: dashboard, /technician/queue,              │
│                       /admin/technician-queue, request pages     │
│    Client components: offer accept/decline, override control,    │
│                       wizard steps, countdowns                   │
└──────────────────────────────────────────────────────────────────┘
```

### Rule 1 — the queue is never computed in React

`src/lib/queue.ts` contains no ordering logic. It groups the rows returned by
`technician_queue_snapshot()`, labels them and formats times. The UI therefore
cannot disagree with the assignment engine: both read the same rows in the same
order.

The previous implementation broke this rule. The technician dashboard read
`technician_queue_state` with the service-role key, sorted it by
`last_assigned_at`, and derived a position from the technician's first
specialization. Two sources of truth, one of them wrong — and it only described a
single appliance, which is why a technician saw a queue containing only
themselves.

### Rule 2 — clients cannot mutate the queue

`assign_technician_to_request`, `respond_to_offer`, `expire_stale_offers` and
`consume_queue_turn` are revoked from `anon` and `authenticated`. The only write
path from a browser is a server route that authenticates the caller and then calls
the mutation with the service-role client. `admin_queue_override` is the single
exception: it requires a written reason and writes an audit row naming the acting
administrator.

`technician_queue_events` has no client insert path at all, so history cannot be
fabricated.

### Rule 3 — the service-role key never reaches the browser

`createServiceRoleClient()` lives in `src/lib/supabase/server.ts` and is imported
only by server modules. Client components receive plain data as props.

## Rule 4 — an approval belongs to ONE version of one estimate

A price the customer agreed to must never authorise work at a different price.
That is why the estimate is versioned rather than edited:

* the technician's form writes through `submit_estimate()`, which supersedes the
  version the customer has already seen instead of overwriting it — the replaced
  row keeps its scope, amounts, timestamps and approval record;
* the customer decides through `decide_estimate()`, which only accepts a version
  that is still `pending`, so a stale tab, a double click or a retried request
  cannot decide the same version twice (`outcome: 'not_pending'`, HTTP 409);
* `POST /api/bookings` requires the **current approved** version
  (`status = 'accepted'` and `superseded_by is null`), and a database trigger
  (`require_approved_estimate_for_booking`) enforces the same rule for any writer;
* the total is derived server-side from the itemized lines and checked by
  `estimates_amounts_check`, so the stored total can never disagree with the
  breakdown the customer read.

Approving, declining or revising writes one estimate row and nothing else: no
booking, no queue event, no re-assignment, no payment. Additional chargeable work
found during a repair is proposed as a **new version** and needs its own approval.

The status vocabularies stay separate on purpose: `estimates.status`
(`draft` / `pending` / `revision_requested` / `accepted` / `rejected` /
`superseded`) is not `bookings.status` and not `payment status`, and group 19 of
the SQL suite asserts that crossing them is impossible.

## Rule 5 — a payment decision is ONE transaction, made by an administrator

A payment reference has exactly two possible decisions and they are not the same thing:

* **verification** — the administrator confirmed the GCash reference. Only
  `confirm_payment()` writes it, in one transaction that also closes the booking,
  archives the service history, closes the request and frees the technician's slot.
  This is the only path to a completed repair;
* **rejection** — the reference is not accepted. Only `reject_payment()` writes it
  (Batch 3), in one transaction that records `rejected_by`, `rejected_at` and a
  required `rejection_reason` and touches nothing else. The repair stays where it is,
  the customer is told why, and they submit a new reference.

Before Batch 3 the rejection was the exception: a raw service-role `update` in the
route, which wrote `confirmed_by`/`confirmed_at`, so a refusal was recorded as a
verification and nothing in the database enforced that only an administrator may
refuse. The two decisions now live on separate columns, both functions re-read the
actor's role from `public.users`, and a `CHECK` constraint plus a BEFORE UPDATE
trigger make the metadata match the decision for **every** writer — including the
service role, which is the writer a route uses.

The repair has two "finished" moments, and neither is the other:

* the **customer's inspection** (`awaiting_inspection` → `awaiting_payment`) is their
  attestation that the appliance works. It carries a written note, which is what
  `service_history` archives, and it opens the payment step;
* **completion** is the administrator's verification, as above.

That is why the API is not the boundary here. The booking transition matrix
(`enforce_booking_update_rules`, a BEFORE UPDATE trigger) and the RLS policies
(`supabase/migration_rls_workflow_enforcement.sql`) refuse `completed` from every
client — customer, technician and administrator alike — because RLS cannot see the
old row and a route can be bypassed with the anon key. The same pair enforces the
rest of the workflow: a booking must name the current approved estimate, a payment
is always inserted as `pending_verification` for the exact recorded cost and with no
decision metadata, a technician may only quote a request assigned to them, and a
customer may cancel their own booking only while it is still `pending`.

## Rule 6 — an appointment is created by ONE transaction, or not at all

A booking is the moment two people are committed to the same hour: the customer to
being home, the technician to being there. So the write is indivisible, and the
conflict rules are enforced where a race cannot slip through them.

Three invariants live in the database (`supabase/migration_atomic_booking.sql`):

* **one live booking per repair request** — the partial unique index
  `uniq_active_booking_per_request` (`status <> 'cancelled'`, so a cancelled row
  stays as history without blocking a rebooking);
* **no overlapping appointment for one technician** — the trigger
  `trg_booking_no_overlap`, which takes a per-technician advisory lock and raises
  `23P01`, the same code a real `EXCLUDE` constraint would raise;
* **all-or-nothing creation** — `create_booking_atomic()` locks the request, then the
  technician, re-checks the estimate, the working hours, time off, clashes and
  capacity, and writes the booking, the request status and the job-load counter in
  one transaction.

A fourth was added in step 17 (`supabase/migration_booking_eligibility.sql`), because
"assigned" turned out to be a claim about the past:

* **the assigned technician is still qualified for the request's appliance type** —
  `create_booking_atomic()` re-applies the queue engine's own rule
  (`technician_qualification_failure()`: approved, active, not suspended, and holding
  an active membership of that appliance's queue). Specializations can be edited by the
  technician, an account can be suspended, and an administrator can take somebody out
  of one rotation; none of those release a request the technician already accepted, and
  without the check the customer could book a technician the platform's own rules
  exclude — or an appliance type nobody covers at all. A refusal is inert: no booking
  row, no request change, no counter move. The check also locks each row it reads — the
  account and this appliance's membership with `FOR SHARE` (read only), the technician
  with `FOR NO KEY UPDATE` (this transaction writes the counter next, so nothing is
  upgraded) — so the same change cannot commit *between* the check and the booking: the
  writer waits for the transaction to end, which leaves only two possible orders and both
  are safe.

The route is therefore a translator, not a guard: it never reads the schedule to
"check" and then writes. A retry is idempotent (`already_booked`, HTTP 409, carrying
the existing booking id) rather than a second appointment, and every refusal is
reported as a conflict with the reason the queue itself would give — not as a 500,
and never as success.

## Rule 7 — the precise service location is a confirmed-assignment privilege

The customer's address and map pin are readable by the customer who owns the
request, by the technician who **accepted** it (or who holds an estimate/booking
on it) and by administrators. A technician who is merely *offered* the job is
not on that list: `assigned_technician_id` is already set while a request is
`offered`, so a policy keyed on that column alone leaks the address before
anyone has taken the job.

That is enforced in the database, not in React (see
`supabase/migration_service_location.sql`):

* the technician SELECT policy requires `assignment_status = 'accepted'`;
* the offer screens read `technician_pending_offers()`, which returns the
  caller's own offers with **no** address, coordinates or customer identity;
* coordinates are range- and pairing-checked by constraints, so no client can
  persist an impossible value.

The map components never decide any of this — they render what the query was
allowed to return, exactly like the queue UI renders what
`technician_queue_snapshot()` returned.

## Rule 8 — nothing is diagnosed for the customer

The problem description is matched against **reviewed synonyms**
(`src/lib/issue-matching.ts`) to *suggest* one of the issues SPARKServ already
supports (`src/lib/appliance-issues.ts`). Three things follow from that:

* the suggestion is scoped to the selected appliance's own issue list, so an
  issue from another appliance can never be returned;
* a suggestion is inert until the customer confirms it — no guidance is rendered
  and nothing is persisted from an unconfirmed candidate;
* there is no appliance-only path into the troubleshooting guides, which is why
  selecting an appliance no longer displays anything (the old rail's bug).

No AI model and no translation API is involved: the mappings are a finite,
reviewable list, and coverage is exactly the phrases in that file. The guides
themselves are preliminary checks only — `scripts/tests/troubleshooting-guides.test.mjs`
fails if a step asks the customer to open a unit, touch wiring or handle
refrigerant.

## Module map

| Concern | File |
| --- | --- |
| Queue rules, membership, audit | `supabase/migration_queue_redesign.sql` |
| Engine wrappers (server) | `src/lib/assignment.ts` |
| Queue view model (shared, presentation only) | `src/lib/queue.ts` |
| Queue UI | `src/components/QueueCard.tsx`, `src/app/technician/queue/page.tsx` |
| Admin monitor + audited override | `src/app/admin/technician-queue/page.tsx`, `src/components/QueueOverrideControl.tsx` |
| Customer-facing state copy | `src/lib/queue.ts` (`customerAssignmentCopy`), `src/components/AssignmentStatusCard.tsx` |
| Request intake | `src/app/api/service-requests/route.ts` |
| Offer response | `src/app/api/service-requests/[id]/offer-response/route.ts` |
| Scheduled sweep | `src/app/api/cron/assignment-tick/route.ts` + `vercel.json` |
| Availability settings | `src/app/api/technician-availability/route.ts`, `src/components/ProfileForm.tsx` |
| Estimate money + status rules (one module, shared by the form and the API) | `src/lib/estimate-costs.ts` |
| Itemized estimate form (technician) | `src/components/EstimateForm.tsx` |
| Customer review / approve / revise / decline | `src/components/EstimateReviewCard.tsx`, `src/app/customer/estimates/page.tsx` |
| Estimate creation + decision endpoints | `src/app/api/estimates/route.ts`, `src/app/api/estimates/[id]/decision/route.ts` |
| Booking creation / conflict handling | `src/app/api/bookings/route.ts` |
| Navigation | `src/lib/navConfig.ts` |
| Service location (map pin) rules + Google Maps URL | `src/lib/geo.ts` |
| Customer map picker (wizard step 4) | `src/components/ServiceLocationPicker.tsx` |
| SSR-safe map wrapper (skeleton, failure notice) | `src/components/ServiceLocationMap.tsx`, `src/components/LeafletLocationMap.tsx` |
| Saved location on request / job / admin views | `src/components/ServiceLocationCard.tsx` |
| Appliance → canonical issue catalogue | `src/lib/appliance-issues.ts` |
| Multilingual issue matching (reviewed synonyms) | `src/lib/issue-matching.ts` |
| Preliminary checks, keyed by appliance + issue | `src/lib/troubleshooting.ts` |
| Inline match / confirm / guide / outcome UI | `src/components/TroubleshootingPanel.tsx` |
| Issue + outcome columns and their constraint | `supabase/migration_troubleshooting.sql` |
| Offer release on cancellation + pre-walk safety net | `supabase/migration_offer_lifecycle.sql` |
| Estimate rows, versions, decisions, booking guard | `supabase/migration_estimate_status.sql` + `supabase/migration_estimate_workflow.sql` |
| Booking transitions, RLS enforcement, payment-verified completion | `supabase/migration_booking_payment_status.sql` + `supabase/migration_rls_workflow_enforcement.sql` |
| Atomic booking, one live booking per request, no overlapping appointment | `supabase/migration_atomic_booking.sql` |
| Payment decision (verify / reject) and its metadata | `src/app/api/payments/[id]/route.ts`, `supabase/migration_reject_payment.sql` |
| Local sweep runner (`npm run cron:tick`) | `scripts/run-assignment-tick.mjs` |
| Location columns, constraints, narrowed technician policy, `technician_pending_offers()` | `supabase/migration_service_location.sql` |

## Flows

### A request arrives

```
POST /api/service-requests
  → validate, persist the request including requested_window_start/end
  → assignTechnician()      [service role → assign_technician_to_request]
  → notify the offered technician
  → response carries assignment_status ('offered' | 'waiting')
```

### A technician responds

```
POST /api/service-requests/:id/offer-response
  → requireRole(technician) + ownership check on the offer
  → respondToOffer()        [service role → respond_to_offer]
      accept  → turn consumed; position moves to the end of that appliance queue
      decline → reason recorded; queue re-walked; next candidate offered
  → refreshOperationalStatus(), notify as needed
```

### The clock keeps things moving

```
GET /api/cron/assignment-tick   (Vercel cron, every 5 minutes — vercel.json)
  → expireStaleOffers()     [service role → expire_stale_offers]
      lapse offers past their TTL, log EXPIRED, re-offer
  → rematchWaitingRequests()
  → notify affected technicians
```

`CRON_SECRET` must be set in the deployment environment or the route refuses to
run in production — see `TESTING.md`.

### A booking is made

```
POST /api/bookings
  → getCurrentUser()            (the identity, never trusted from the body)
  → create_booking_atomic(...)  [service role → one transaction]
        lock the request row FOR UPDATE
        re-check: already booked? assigned + accepted? estimate current + approved?
        the assigned technician still qualified for THIS appliance type?
        take the technician's advisory lock
        re-check: inside working hours? not on time off? no clash? capacity?
        insert the booking, mark the request `booked`, move active_job_load by 1
  → map the outcome to a status code (201 / 409 / 400 / 403 / 404)
```

The route validates its input and translates the answer; it decides nothing about
scheduling. Everything that could conflict with another writer happens inside the one
transaction, which is what stops two customers being sold the same technician at the
same time. Two guards back it up for any other writer: the partial unique index
`uniq_active_booking_per_request` and the trigger `trg_booking_no_overlap`. Direct
`authenticated` inserts are refused outright — the INSERT policies are gone — so the
function is the only path to an appointment.

Cancelling releases the slot and refreshes the technician's cached status in the SAME
transaction as the status change, through the AFTER UPDATE trigger
`release_slot_after_booking_cancel` (step 18), which calls the shared
`release_technician_slot()` primitive (one atomic statement, floored at zero). It used to
be a second call from the route, after the cancellation had committed: a failed call left
the counter inflated for good, and a cancellation written anywhere else released nothing.
The same trigger passes the request back to `quoted` through the Batch 1 trigger
`reopen_request_after_booking_cancel`, so the customer can book again with the estimate
they already approved. `booking_status_holds_slot()` is the one definition of which
statuses hold a slot, which is what makes a repeat cancellation — or a
`completed → cancelled` write — release nothing.

Booking creation moves no queue positions: the turn was already consumed at
acceptance, which is the difference from the old model.

### A payment reference is decided

```
PATCH /api/payments/:id
  → requireRole(admin|super_admin) + a written reason for a rejection
  → confirm  → confirm_payment()   [service role → one transaction]
                 verify the payment, close the booking, archive the history,
                 close the request, free the slot  → the repair is completed
  → reject   → reject_payment()    [service role → one transaction]
                 record rejected_by / rejected_at / rejection_reason
                 and nothing else  → the repair is untouched, the customer
                 is notified with the reason and submits a new reference
  → map the outcome to 200 / 409 / 404 / 403 / 400 (503 if the function is missing)
```

Both decisions re-read the actor's role from the database and hold the same row lock,
so a verification and a rejection of one reference cannot both succeed. The route
decides nothing: it validates the reason (customer-facing text, so it is required and
bounded), calls the function and translates the outcome.

## Observability

| Question | Where to look |
| --- | --- |
| Why did this technician get the offer? | `technician_queue_events` (`OFFERED`) |
| Why was this technician skipped? | `technician_queue_events` (`SKIPPED_*`, with reason and unchanged position) |
| Where is everyone in the rotation? | `/admin/technician-queue` or `technician_queue_snapshot()` |
| Who changed the rotation by hand? | `technician_queue_events` (`ADMIN_OVERRIDE`, with `actor_id` and reason) |

## Testing the architecture

`npm run test:queue-sql` (in-process Postgres, schema + migrations, full
scenario) and `npm run verify:queue` (live project, real JWTs, real RLS). See
`TESTING.md`.

## Deliberate non-goals

- **No technician ranking, recommendation or "best match".** Ratings and
  experience are display data; the rotation is the only selection mechanism.
- **No customer-side technician selection.** A customer cannot pick or switch a
  technician, and never sees the queue.
- **No client-side queue state.** Not in React, not in local storage, not in a
  reducer.

