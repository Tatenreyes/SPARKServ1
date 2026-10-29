# SPARKServ — Testing

Two automated harnesses cover the queue, one covers the multilingual issue matcher,
one covers the estimate money rules, one covers the password-recovery rules, one
covers the booking outcome contract, one covers the shared admin-list guards, one
covers the customer-facing assignment state, and one covers request removal. They
answer different questions, and **all** are needed before the work can be called done.

| Command | Runs against | Proves | Cannot prove |
| --- | --- | --- | --- |
| `npm run test:queue-sql` | an in-process WASM Postgres (PGlite) loaded with this repo's real SQL files | the **logic**: rotation, skip rules, capacity, expiry, race guards, audit rows, the estimate state machine (totals, versions, single-shot approval, booking gate), and atomic booking (one live booking per request, no overlapping appointment, counter moves exactly once) | that the migration was applied to the live project, real JWT claims, PostgREST exposure, UI rendering, and anything requiring two genuinely concurrent transactions |
| `npm run test:issues` | the real `src/lib/*.ts` modules, run directly by Node 24 (type stripping, no build step) | the **matching**: normalisation, the English/Tagalog/Bisaya/mixed mappings, appliance scoping, negation, ambiguity, and the safety of every published guide | the React form itself, and anything needing the database |
| `npm run test:estimates` | the real `src/lib/estimate-costs.ts`, run directly by Node 24 | the **money and status rules** the form and the API route share: rounding, invalid amounts, the itemized total, the required scope/description, the status vocabulary, and which version is bookable | the database constraints (group 19 covers those) and the React components |
| `npm run test:auth` | the real `src/lib/auth/recovery.ts`, `src/lib/auth/recovery-marker.ts` and `src/lib/password.ts`, run directly by Node 24 | the **password-recovery rules**: the minimum/maximum length and the mismatch rule, the duplicate-submission guards, the callback decision table (exchange a PKCE code, verify a `token_hash`, refuse an expired or wrong-type link), the open-redirect guard on `next`, the error-to-copy mapping that keeps the request form from disclosing whether an account exists, and the **recovery authorization binding** — that the marker is signed and names one user and one session, so it is refused for a visitor with no recovery session, for the same account after an ordinary sign-in, for a different account in the same browser, after a completed reset, and when it is expired, forged, unsigned or tampered — plus source guardrails (no token logging, no service-role client, no identifier sent to `updateUser`) | the rendered React components, a real recovery email, the live project's redirect allow-list, and the browser's cookie handling — §4 has the manual pass |
| `npm run verify:queue` | the **live Supabase project** from `.env.local` | the **deployed system**: real RLS, real GRANTs, real `auth.uid()`, RPC exposure through PostgREST | anything about the browser UI |
| `npm run test:admin-lists` | the real `src/lib/booking-status.ts` and `src/lib/query-rows.ts`, plus the two admin listing pages and `TechnicianJobsClient`, read as text | the **shared guards**: that "active" is one four-status list consumed by both booking monitors and the technician job list (never re-listed inline, which is how the two pages drifted apart), that every listing query goes through `requireRows()` and no page reads a query result unguarded, that the guard throws with the query name and the database code while never logging `details`/`hint`, that `/admin/bookings` is a redirect into the merged list and the merged list kept that page's one unique column, and that a refused visit write is surfaced instead of looking saved | the rendered React tree, a real PostgREST failure, and the numbers the pages actually display |
| `npm run test:removal` | `src/app/api/service-requests/[id]/route.ts`, `src/components/RemoveRequestControl.tsx`, `src/components/RequestDetailClient.tsx`, `src/components/RecentRepairTable.tsx` and `src/lib/navConfig.ts`, read as text | **removing a repair request**: that the delete runs on the service-role client (there is no DELETE policy, so a browser cannot do it), that a completed repair, an accepted assignment, an appointment and a prepared estimate each have their own refusal code, that every one of those checks runs BEFORE the delete statement (the delete cascades into estimates, bookings, their messages/visits/ratings/payments and the offer history), that another customer's request answers as a 404, and that both surfaces offer the control while hiding it for the states the server would refuse | the cascade itself and the refusals against a live database — both need the live project |
| `npm run test:tracking` | `src/app/customer/dashboard/page.tsx`, `src/components/ServiceTracking.tsx`, `src/app/customer/service-request/[id]/page.tsx`, `src/components/RequestDetailClient.tsx` and `src/lib/assignment-coverage.ts`, read as text | the **customer-facing assignment state**: that the "Active repairs" tile opens the customer's own request list instead of the legacy alias that redirects to the new-request wizard; that the tracking strip takes a coverage answer and, when the database has confirmed that nobody covers the appliance, replaces "next: technician assigned" with the shared dead-end wording plus a support link; that coverage is re-read on the server for unassigned requests only; and that the check degrades to `null` (neutral wording) when it cannot run | the rendered React tree, and the live answer (`appliance_has_qualified_technician()` needs the live project) |
| `npm run test:booking-api` | `supabase/migration_atomic_booking.sql`, `migration_booking_eligibility.sql` and `src/app/api/bookings/route.ts`, read as text | the **wiring** between the booking function and the route: every outcome `create_booking_atomic()` can return (including the three it passes through from `technician_capacity_failure()`) has a `case` in the route, the route's only `201` is the `booked` case, the `default:` branch answers `500` and never `201`, and the `technician_not_eligible` case is a `409` naming the appliance | the behaviour itself (group 26) and anything that needs a request/response runner — there is none in this repository |

A green PGlite run means "the SQL is sound". A green `test:issues` run means "the
mappings behave". A green `test:estimates` run means "the total on the button is
the total that gets stored". A green `test:auth` run means "the recovery rules and the
callback's decisions behave". A green `test:booking-api` run means "the route knows
every outcome the booking function can return". A green `test:admin-lists` run means
"the admin lists share one definition of active, and a failed read cannot render as an
empty list". A green `test:tracking` run means "the dashboard and the request page tell
the customer the truth about their assignment — including when nobody covers the
appliance". A green `test:removal` run means "a customer can only remove a request that
nothing depends on, and the refusals are checked before the cascade". A green live run
means "the deployed
system behaves that way". None substitutes for another.

---

## 1. `npm run test:queue-sql` — SQL / behaviour suite

```
node scripts/test-queue-sql.mjs
```

* `scripts/sql-harness.sql` first: stand-ins for what Supabase normally provides
  (`auth.users`, `auth.uid()`, `storage.buckets`, `storage.foldername`, the
  `anon` / `authenticated` / `service_role` roles). `auth.uid()` reads the same
  `request.jwt.claim.sub` GUC Supabase uses, so the suite impersonates callers
  with `set role authenticated` + that GUC — real RLS evaluation, not a mock.
* Then the repo's own files, unmodified: `supabase/schema.sql`,
  `supabase/migration_sync_live_schema.sql`,
  `supabase/migration_flow_hardening.sql`,
  `supabase/migration_queue_redesign.sql`,
  `supabase/migration_service_location.sql`,
  `supabase/migration_troubleshooting.sql`,
  `supabase/migration_offer_lifecycle.sql`,
  `supabase/migration_estimate_status.sql`,
  `supabase/migration_estimate_workflow.sql`,
  `supabase/migration_booking_payment_status.sql`,
  `supabase/migration_rls_workflow_enforcement.sql`,
  `supabase/migration_atomic_booking.sql`,
  `supabase/migration_reject_payment.sql`. **The queue logic is tested against
  the DDL that ships**, so a syntax or ordering error in a migration fails here.
  (The estimate pair is loaded in order on purpose: PostgreSQL refuses to use an
  enum value in the same transaction that adds it, so the harness would fail the
  same way a single combined file would. The Batch 1 pair is the same story for
  `booking_status`.) The Batch 2 and Batch 3 files are each loaded **twice** — once
  as part of the chain and once again on their own — so re-running them against a
  database that already has them (the normal upgrade mistake) is proven harmless.
  Batch 3 is loaded a **third** time, immediately after the Supabase-style grant stub:
  that stub grants `ALL` on `payments` the way Supabase's default privileges do, so the
  third load is what re-applies the revoke the migration performs — without it the
  privilege assertions would pass without the revoke ever being exercised.
* 25 groups, 326 assertions, current result **326/326 passed**:

| # | Group | Spec clauses |
| --- | --- | --- |
| 1 | Loading schema and migrations | — |
| 2 | Fixtures: technicians A, B, C + a customer | — |
| 3 | Fairness rotation | §22 |
| 4 | Schedule conflict skips for one request only | §8, §9, §23 |
| 5 | Multiple appliance queues stay independent | §25 |
| 6 | Full queue visibility for technicians | §11, §26 |
| 7 | Capacity protection, time based | §17 |
| 8 | Offer expiry keeps the technician in the queue | §10 |
| 9 | Concurrency: one job, one accepting technician | §28 |
| 10 | Audit trail + no duplicates | §27, §33, §36 |
| 11 | Completing a job does not re-rotate the queue | §20 |
| 12 | Operational status is separate from queue membership | §15 |
| 13 | Admin override needs a reason and is audited | §32, §33 |
| 14 | Cancelling or rescheduling never grants a new turn | §18, §19 |
| 15 | Ratings and experience never influence the rotation | §1 |
| 16 | Service location: coordinate validation, and visibility only to the assigned technician | §7 (location privacy) |
| 17 | Troubleshooting: identified issue + reported outcome are stored, and the outcome vocabulary is constraint-checked | persistence |
| 18 | Offer lifecycle: cancelling releases the offer, a cancelled request is never accepted or re-offered, and a lapsed offer cannot freeze the rotation | §5, §6, §7 |
| 19 | Estimate workflow: itemized total derived server-side, draft invisibility, single-shot approval on the exact version, revision as a new version, declined/superseded/unapproved quotes cannot be booked, and no decision touches the queue, the assignment or a booking | estimate lifecycle |
| 20 | Workflow enforcement in the database: a customer cannot book without the approved estimate, book as `completed`, complete their own repair, write `final_cost`, self-verify a payment, pay for someone else's booking, reassign or close their own request; a technician cannot quote a request they were not assigned; and the legitimate paths (book, cancel while pending, start the job, send for inspection, confirm the inspection with a note, submit the payment) all still work | RLS + triggers |
| 21 | Completion follows verified payment: a non-administrator cannot verify, verification completes the booking/request/history/counters in one transaction, a second verification changes nothing and double-counts nothing, a payment cannot close a repair that never reached the payment step, and a pre-policy booking is verified without rewriting history | payment → completion |
| 22 | Cancelling an appointment, and booking the same request again afterwards: the slot is released, the request returns to `quoted`, the cancelled row stays as history, and the technician is not re-rotated | Batch 1 cancellation |
| 23 | Atomic booking and double-booking prevention (Batch 2): a customer books a valid approved estimate through the one atomic function, and the booking, the request state and the job-load counter move together; a retry reports `already_booked` with the same booking id and creates nothing; adjacent half-open windows are allowed while an overlapping one on the same technician is refused (`schedule_conflict`, and `23P01` for a direct write); capacity refusals name their limit (`capacity_daily_jobs`, `capacity_daily_hours`); a booking during approved time off or outside the configured working hours is refused; a refusal leaves no row, no request change, no counter move and an untouched queue; a customer cannot book another customer's request, a technician cannot book, an estimate from another request / another technician / a superseded version / an unapproved version is refused, as is a request whose technician has not accepted; and the full Batch 1 lifecycle (book → inspect → pay → verify) still completes on a Batch 2 booking | atomicity + scheduling invariants |
| 24 | Database-enforced payment rejection (Batch 3): only an administrator can reject, and the actor's role is re-read from `public.users` (a customer's own session cannot even execute the function); the reason is required, trimmed and capped at 500 characters — whitespace-only counts as missing, including a reason made only of vertical tabs, while a reason that merely begins or ends with the letter `v` is stored intact; a missing payment reports `not_found`; a decision is final (`not_pending` on a retry, and a rejected reference can never be verified); the rejection is recorded on `rejected_by`/`rejected_at`/`rejection_reason` with `confirmed_by`/`confirmed_at` left null; once decided, the row is frozen — the status and every metadata column are immutable, so a rejection reason, the administrator who refused it or a timestamp cannot be rewritten after the fact; the booking, the service request, the technician's slot counter and `service_history` are all untouched by a rejection, and a pending reference on an already-completed repair can still be rejected without altering that booking or its history; the guards hold for a privileged direct write (a rejected row cannot claim a verification, an identifying column cannot change, a pending row cannot carry decision metadata); a customer cannot submit a payment carrying rejection metadata; and `confirm_payment()` still completes a repair (and still verifies a pre-policy one) exactly as before | payment decision + metadata invariants |
| 25 | Payment write authorization (Batch 3): the payment table privilege matrix is exactly `service_role` = SELECT, `authenticated` = SELECT + INSERT, `anon` = nothing, checked by name for every privilege (`SELECT`, `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE`, `REFERENCES`, `TRIGGER`) and confirmed in the ACL (`service_role=r`, `authenticated=ar`, `anon` absent); a direct `INSERT`, `UPDATE`, `DELETE` or `TRUNCATE` as the service role fails with SQLSTATE **42501** (the TRUNCATE attempt runs inside a rolled-back transaction and the payment provably survives it); a customer's `UPDATE`/`DELETE` is refused by the same privilege, and an unauthenticated `SELECT` too, with the row left unchanged; RLS is still proven where the role *does* hold the privilege — a customer's `SELECT` of another customer's payment returns no row while their own returns it — and the customer workflow still works (`INSERT` submits a reference, `SELECT` reads their own records); both decision functions are SECURITY DEFINER and owned by the table owner, and both still work after the revokes (`reject_payment()` returns `rejected`, `confirm_payment()` still completes the repair, archives the history and moves the counters); `EXECUTE` on both RPCs is granted to `service_role` and to nobody else, so a customer's call fails with 42501 while the RPCs' *own* authorization check refuses a non-administrator **actor** with `forbidden` (or a raise); the trigger refuses a decision **recorded** against a customer or a technician and accepts an `admin`/`super_admin`; the CHECK constraint refuses a rejected row with no reason and names itself; and the trigger still freezes a decided record | payment table privilege matrix + which guard refuses what |
| 26 | The booking eligibility invariant (step 17): the qualification predicate accepts a technician who is in the appliance's queue and refuses one who is not, and the queue walk's eligibility gate gives the *same* answer (one shared definition); a request with no technician, or with an offer that was never accepted, still cannot be booked; an estimate from another request is still refused even when the technician is qualified; a booking is refused (`technician_not_eligible`) when the assigned technician does not service that appliance type, when the specialization was removed after acceptance, when the account is suspended, unapproved or deactivated, and when **no** technician covers the appliance type at all (`qualified_technician_available = false`); every one of those refusals writes nothing — no booking row, the request still `quoted` + `accepted` with its requested window intact, `active_job_load` unchanged, and the rotation exactly as the attempt found it; queue membership is per appliance type, so being in one rotation never qualifies a technician for another; a mutation test books the **same** request — refused while the technician is ineligible, then booked once the qualification is restored — and the refused attempt leaves exactly one booking behind; a qualified, assigned technician with an approved estimate still books normally; and the two new predicates are service-role only | booking eligibility invariant |
| 27 | The atomic cancellation release (step 18): cancelling a booking releases exactly one slot **in the same transaction as the status change**, and the request reopens with its assignment and approved estimate while the cancelled row stays as history; the rotation does not move; a repeat cancellation — a retried PATCH, a second cancel, or an `updated_at` touch — releases nothing; a failed release rolls the whole cancellation back (the booking stays live, the counter does not move, the request stays `booked`), and a failed **status refresh** rolls back both the cancellation *and* the decrement the release had already performed; `confirm_payment()` still frees the slot exactly once and a completed booking cannot release a second time; two bookings for one technician take two slots and give both back once each; **the release follows the technician who held the slot** — `bookings.technician_id` is NOT NULL, no client role (customer, technician or administrator) may move a booking to another technician, and when a trusted writer reassigns *and* cancels in one statement the slot released is the old technician's, never the new one's; an administrator cannot cancel a completed booking at all (the `completed` guard precedes every role branch); the `booking_status_holds_slot()` predicate names exactly the four live statuses; the trigger is installed AFTER UPDATE beside the request-reopening trigger and its definition never mentions `technician_queue_state`; and the predicate is service-role only with the release primitive's grants unchanged | cancellation / technician-slot consistency |

Group 19 covers the estimate rules that only a database can guarantee: the stored
total must equal the itemized sum (`estimates_amounts_check`), one live version and
one approval per request (the two partial unique indexes), a booking may only name
the current approved estimate (`require_approved_estimate_for_booking`), a
customer cannot read a draft, and a technician cannot set an estimate to
`accepted` from the client (RLS `WITH CHECK`). It also proves the negative cases
the workflow depends on: a second approval of the same version is a no-op, an
approval that was superseded authorises nothing, a declined estimate creates no
booking, and an unanswered estimate stays unanswered when the cron sweep runs.

Groups 20 and 21 cover the Batch 1 enforcement, and they assert **both directions**:
each unauthorised operation is refused, and each legitimate one still works. Group
20 runs every statement as the real role with a real JWT claim (`asUser`), so it is
the policies and the BEFORE UPDATE triggers being tested rather than the route
handlers — the point of the batch is that the database, not TypeScript, is the
boundary. Group 21 drives `confirm_payment()`: one transaction closes the booking,
archives `service_history`, closes the request and moves the technician's counters,
a second call changes nothing, and a booking that never reached the payment step
cannot be closed by a payment. Its privilege stub grants `authenticated` exactly
what Supabase grants by default (`select/insert` on `payments`, `update` on
`service_requests`), so a refusal is a policy refusal and never a `42501`
permission error — which would prove nothing.

Group 23 covers Batch 2, and it books through `create_booking_atomic()` the same way
`POST /api/bookings` does — there is no direct-insert path left to test, which is the
point: group 20 already proves a direct `authenticated` insert is refused *and* that
a customer cannot execute the function itself. Its own dedicated technician is used
for the availability, time-off and capacity cases, so the limits it configures cannot
disturb the queue fixtures the other groups rely on.

**Step 17 changed those fixtures, and that is part of the finding.** Technician D was
created without specializations, so no appliance queue contained him — and every
booking in the group still succeeded, because the transaction only ever checked the
request's workflow state. Those fixtures *were* the defect, written down as expected
behaviour. D is now specialized in an appliance type no other group uses (`electric_kettle`),
so the group proves the legitimate path against genuinely eligible data, and group 26
owns the refusals.

### What group 23 cannot prove

**PGlite is a single connection, so two transactions never truly interleave.** The
suite proves that both guards exist, are enforced by the database rather than by a
route, and refuse the second write: the unique index for one live booking per
request, and the overlap trigger — which serializes on a per-technician advisory lock
— for the technician's window. It does **not** prove that a live two-client race is
safe, and it should not be read as if it did. Sequential tests cannot demonstrate
concurrency; they only rule out the sequential half of the bug.

The remaining half has to be exercised against the live project, once step 15 is
applied, with two real sessions:

```sql
-- Session 1
begin;
select public.create_booking_atomic('<request-A>', '<estimate-A>', '<customer>',
       '2031-03-02T01:00:00Z', 120, null);
-- (leave the transaction open)

-- Session 2, same technician, overlapping window: must return schedule_conflict
-- (or fail with 23P01), never `booked`
select public.create_booking_atomic('<request-B>', '<estimate-B>', '<customer>',
       '2031-03-02T02:00:00Z', 120, null);

-- Session 1
commit;
```

Then confirm the invariants held:

```sql
select service_request_id, count(*) from public.bookings
 where status <> 'cancelled' group by 1 having count(*) > 1;   -- expect zero rows
```

### What group 24 cannot prove

Two things, stated rather than implied:

**Notification delivery.** The customer notification is sent by the *route*
(`PATCH /api/payments/:id` → `notify()`), after the rejection transaction has
committed. This harness runs SQL only — there is no route runner and no API test
harness in this repository — so group 24 proves the decision and its metadata, not
that the customer's bell shows the reason. Verify by hand: reject a reference, then
open the customer's own notification list (`/customer/account/notifications`) and the
booking page as that customer.

**Two genuinely concurrent decisions.** PGlite is a single connection, so a rejection
and a verification of the same reference cannot truly interleave here. What *is*
proven: `reject_payment()` takes the same `for update` row lock as `confirm_payment()`,
a decided row cannot be re-decided (`not_pending`), and the trigger refuses any
transition out of a terminal state. The live check, with two sessions:

```sql
-- Session 1: leave the transaction open
begin;
select public.reject_payment('<payment-uuid>', '<admin-uuid>', 'Two-session test');

-- Session 2: blocks on the row lock, then reports not_pending once session 1 commits
select public.confirm_payment('<payment-uuid>', '<admin-uuid>');

-- Session 1
commit;
```

Then confirm the row records the rejection and nothing else:

```sql
select status, confirmed_by, confirmed_at, rejected_by, rejected_at, rejection_reason
  from public.payments where id = '<payment-uuid>';
-- expect: rejected / null / null / <admin-uuid> / not null / the reason
```

### What group 25 proves, and what it cannot

Group 25 exists to attribute every refusal to the mechanism that produced it, and to
stop one mechanism standing in for another:

| Refusal | Mechanism | How the test proves it |
| --- | --- | --- |
| the service role writes or truncates a payment | **table privilege** | SQLSTATE `42501`; the TRUNCATE attempt runs inside a rolled-back transaction and the row is checked to survive it |
| a customer updates or deletes a payment | **table privilege** | SQLSTATE `42501`, and the record is checked to be unchanged |
| an unauthenticated caller reads payments | **table privilege** | SQLSTATE `42501` |
| a customer reads another customer's payment | **RLS** | the `SELECT` is permitted, returns **no row**, and the owner's own `SELECT` returns theirs |
| a customer submits a reference for someone else's booking | **RLS** (insert policy) | the `INSERT` is permitted but refused by the policy |
| a customer calls a decision RPC | **function grant** | SQLSTATE `42501` |
| a non-administrator is passed as the actor | **RPC authorization** | `outcome: 'forbidden'`, or `confirm_payment()` raising |
| a rejected row with no reason | **CHECK constraint** | the constraint is named in the error — proved with an INSERT, which never reaches the UPDATE trigger |
| a decision recorded against a non-administrator, or a rewrite of a decided row | **trigger** | the trigger's own message |

Two limits worth stating:

* **The harness's `service_role` bypasses RLS**, matching Supabase, so the `42501`
  refusals are the privilege and not a policy. A live project's ACL cannot be read
  through PostgREST — confirm it with the `information_schema.role_table_grants` query
  in `DATABASE.md`.
* **Nothing here proves the absence of every other writer.** It proves that the roles the
  application uses cannot write, and that the database refuses the shapes it must
  refuse. A role with `bypassrls` and its own grant — a future migration, or a manual
  `psql` session as the owner — is outside what a test suite can rule out.

Group 3 is the acceptance scenario verbatim: `A → B → C`, A accepts a repair
booked for a week later, the rotation must become `B → C → A` with **A still a
member**, then requests on the 24th, 25th and 26th rotate it back through
`C → A → B` → `A → B → C` → `B → C → A`, proving one technician can hold two
future repairs.


### What group 26 proves, and what it cannot

Group 26 exists because the defect was not a missing message: the database wrote a
booking for a technician its own rules excluded, and the fixtures asserted that as
correct. It proves the invariant is enforced *inside* `create_booking_atomic()` — one
definition of "qualified for this appliance", shared with the queue walk — and that a
refusal is inert: no booking row, no request transition, no counter move, no rotation
change. The mutation test is the part that pins the guard down: the same request,
estimate and appointment are refused while the technician is ineligible and booked once
the qualification is restored, so the refusal is attributable to eligibility rather than
to anything else in the fixture.

It also proves the two halves of the **concurrency** guard that a single connection can
observe: that the booking transaction really does lock the account, the technician and
the appliance membership it checks — `FOR SHARE` on `users` and `technician_queue_state`,
`FOR NO KEY UPDATE` on `technicians`, read back out of `pg_locks` by relation-level mode
with the probe rolled back so it leaves nothing behind — that the qualification predicate
on its own takes **no** such lock (which is why the transaction has to), and that no
refusal outcome carries a `booking`/`booking_id` payload — i.e. nothing the API could read
as a success.

Three things it cannot prove:

* **It cannot prove a live request is unreachable.** The stale states it builds
  (specialization removed, account suspended, nobody covering the appliance) are reached
  by writing the tables directly; the suite does not drive `PATCH /api/profile` or the
  admin screens. Those paths are covered by inspection, not by this group.
* **It cannot prove the customer's browser behaves.** The API mapping and the estimate
  card's gate are TypeScript; the suite exercises the database, and the UI needs the
  manual pass in section 4. (`npm run test:booking-api` covers the *wiring* — that every
  outcome the function can return has a case in the route, and that the only 201 is the
  `booked` case.)
* **It cannot prove a writer actually waits.** One connection cannot block on another,
  and PGlite does not report tuple locks at all, so the suite can show the row lock is
  *taken* but not that a concurrent `UPDATE` *blocks* on it. That needs two sessions —
  the test below.

#### The two-session interleaving test (live, step 17)

Run this against the live project after applying step 17, in a **staging project or with
disposable data** — never on a technician or request that is carrying real work. It is the
race the row locks close: a qualification change (a specialization edit, an approval
change, a suspension, a deactivation, an administrative queue removal) committing between
the eligibility check and the booking's commit.

Two things are required to run it at all, and both are easy to get wrong:

* **Two real connections holding transactions open.** Two `psql` sessions against the
  project's direct/session connection. The REST API cannot do it (PostgREST runs every
  request in its own autocommit transaction) and neither can a single SQL editor tab.
* **READ COMMITTED**, PostgreSQL's default, which is what Supabase and PostgREST run and
  what every expectation below assumes.

The full annotated version, including the snapshots to compare and the cleanup steps, is
in `supabase/migration_booking_eligibility.sql` section 5. The sequences:

**Test 1 — lock held, then rolled back.** Proves a qualification writer *waits* while a
booking transaction is in flight. It does **not** prove a committed booking: the rollback
undoes it.

```sql
-- Session 1
begin;
select public.create_booking_atomic('<request>', '<approved-estimate>', '<customer>',
       '2031-05-02T01:00:00Z', 120, null) -> 'outcome';   -- expect: booked (not committed)

-- Session 2 (run now; it must WAIT, not fail)
update public.technicians set specializations = '{}' where id = '<technician>';

-- any third connection (privileged, like the direct psql session):
-- Session 2 is demonstrably blocked
select pid, state, wait_event_type, left(query, 60) as query
  from pg_stat_activity
 where datname = current_database() and wait_event_type = 'Lock';
-- expect: Session 2 waiting on the technicians row (transactionid / tuple)

-- Session 1
rollback;   -- undoes the booking; Session 2 then proceeds

-- Session 2
commit;

select count(*) from public.bookings where service_request_id = '<request>';
-- expect: 0 — Session 1 rolled back
```

**Test 2 — the committed eligibility change wins.** Session 2 must **commit**, so that
when Session 1 resumes it re-reads the new state and refuses. Rolling back here would undo
the change, and Session 1 would see the original eligible state and legitimately return
`booked` — the opposite of what this test is for.

```sql
-- Session 2
begin;
update public.technicians set specializations = '{}' where id = '<technician>';

-- Session 1 (run now; it must WAIT here)
begin;
select public.create_booking_atomic('<request>', '<approved-estimate>', '<customer>',
       '2031-05-02T01:00:00Z', 120, null) -> 'outcome';
-- (still waiting: confirm with the pg_stat_activity query above)

-- Session 2
commit;     -- RELEASE the change. Do NOT roll back.

-- Session 1 resumes by itself:
-- expect: technician_not_eligible, reason = not_in_queue
commit;     -- nothing was written, so there is nothing to undo
```

Test 2 must then be shown to have written **nothing**. Session 2 takes the snapshot *inside
its own transaction, before committing* — only Session 2 can see its own uncommitted change,
which is what makes that the "armed" state — then commits and lets Session 1 resume. Re-run
the same queries afterwards (now visible to everyone) and compare: the request's
`status`/`assignment_status`/`assigned_technician_id`/window, `technicians.active_job_load`,
and `technician_queue_state.queue_position` per member. Compare against the **armed**
snapshot, not the pre-test one — the specialization change itself legitimately moves the
rotation, and the claim is only that the *refused booking* left it alone. Plus:

```sql
select count(*) from public.bookings where service_request_id = '<request>';
-- expect: 0 — no booking row
```

**Test 3 (optional) — a committed booking, then a later change.** This commits the
booking, so it leaves a real appointment behind, and it is documented separately because
its outcome is **not** the defect: the booking was valid when it was written, and the
specialization change came after. No guard can un-write a valid booking, and silently
cancelling a real customer's appointment would be worse than leaving it. That residual
state is the stale-assignment follow-up in section 6 of the migration, and
`npm run audit:bookings` lists exactly those rows for a human decision (finish it, or
cancel through the normal UI). Do not delete the row to make a sweep come back clean.

Either test must leave the invariant intact:

```sql
select count(*)
  from public.bookings b
  join public.service_requests r on r.id = b.service_request_id
 where b.status <> 'cancelled'
   and public.technician_qualification_failure(b.technician_id, r.appliance_type) is not null;
-- expect: 0
-- Test 3 is the only case that can legitimately leave a row here (a valid booking, then a
-- later change). Any other row is a real finding: step 5 did not refuse something it should
-- have refused.
```

**Cleanup — restore the test technician.** Record the original values *before* the tests and
put them back afterwards:

```sql
-- before
select specializations, approved, operational_status
  from public.technicians where id = '<technician>';
select is_active from public.users where id = '<technician>';

-- after
update public.technicians
   set specializations = array['<original appliance>', ...]
 where id = '<technician>';
```

The sync trigger reactivates the membership **at the end of the queue** — the documented
behaviour for a returning technician — so restoring specializations does move the rotation.
That side effect is exactly why this runs on a disposable technician in a staging project,
never on somebody carrying real work. Any appointment Test 3 committed is cancelled through
the normal UI (which releases the slot and returns the request to `quoted`) or left for the
assigned technician to finish; it is never deleted. Then confirm you are back where you
started: `specializations` restored, and the probe request's booking count at its original
value.


### What group 27 cannot prove

Group 27 runs on one connection, so it proves the *mechanism* of the cancellation release
— one release per cancellation, a failure in either call rolling the whole thing back, and
a guard that is a transition rather than a status — and never a genuine interleaving. Two
things need two sessions, and both run on **staging data** (a disposable technician,
request and approved estimate), never on a real appointment.

**Two cancellations for one technician.** Both must **commit**, so what is being tested is
the counter's behaviour rather than the rollback's:

```sql
-- Session 1
begin;
update public.bookings set status = 'cancelled' where id = '<booking-A>';
-- Session 2
begin;
update public.bookings set status = 'cancelled' where id = '<booking-B>';
-- both sessions
commit;

select active_job_load from public.technicians where id = '<technician>';
-- expect: two lower than it started — never one (a release lost) and never three (a
--         release counted twice). `release_technician_slot()` is one statement that reads
--         and writes under a row lock, so the two decrements cannot undo each other.
```

**A cancellation racing a payment completion.** The booking can only be decided once, and
the counter must move exactly once:

```sql
-- Session 1 — the administrator verifies the payment. confirm_payment() takes the payment
--              row and then the booking row FOR UPDATE, so this holds the booking.
begin;
select public.confirm_payment('<payment-id>', '<admin-id>') -> 'outcome';   -- confirmed

-- Session 2 — the cancellation, run now. It waits on that row lock.
--   * as ANY client role (customer, technician, administrator) the transition matrix
--     refuses `completed -> cancelled` outright: the `completed` guard runs before every
--     role branch, so the statement raises and the booking stays completed.
--   * as a TRUSTED writer (the service role, or a direct psql session) the transition does
--     go through — the matrix returns early for both by design — and the counter must
--     STILL move only once, because `completed` is not a slot-holding status. That is the
--     separately tracked `completed -> cancelled` follow-up (DATABASE.md), visible here
--     rather than hidden.
update public.bookings set status = 'cancelled' where id = '<booking-id>';

-- Session 1
commit;   -- Session 2 then resumes

select b.status, t.active_job_load
  from public.bookings b join public.technicians t on t.id = b.technician_id
 where b.id = '<booking-id>';
-- expect: the counter exactly one lower than before the booking, whatever the booking's
--         final status is. Never two lower, and never a booking that released twice.
```

Both tests inherit the step 17 rule above: a rollback in the first session would undo the
change being raced and make the result meaningless — commit both sessions.


### Limits to keep in mind

* PGlite is a Postgres build compiled to WASM, not the exact Supabase minor
  version. Treat "passed" as *the SQL is sound*, not *production is verified*.
* `auth.uid()` and the `auth` / `storage` schemas are local stubs.
* Table privileges are stubs too. Supabase grants `authenticated` SELECT on the
  public tables and lets RLS decide the ROWS; a bare Postgres grants nothing. The
  harness applies that one privilege for `service_requests`, plus SELECT / INSERT /
  UPDATE for `estimates` (see the "Supabase default privilege stub" step) so groups
  16 and 19 can prove "zero rows visible" instead of failing with "permission
  denied for table", which would prove nothing.
* Supabase-managed helpers (`auth.jwt()`, `auth.role()`) do not exist in a bare
  Postgres, so role resolution goes through `public.current_role()` (defined by
  the migrations against `users.role`) — the same definition production uses.
* `@electric-sql/pglite` is a **devDependency**. It is imported only by this
  script, never by application code, so it never reaches a Vercel build.
* **`btree_gist` is not available in this build.** That is why Batch 2 guards
  overlapping appointments with a trigger plus a per-technician advisory lock rather
  than an `EXCLUDE USING gist` constraint: the constraint could not have been tested
  here before shipping. The trigger raises the same SQLSTATE a real exclusion
  constraint does (`23P01`), so a caller cannot tell the difference.
* One connection means no real concurrency: see *What group 23 cannot prove* above.

### Why `schema.sql` needs the harness at all

`supabase/schema.sql` references `public.is_admin()` in the `users` policies
before creating that function further down, and it references `auth.*` and
`storage.*` objects that only exist inside a Supabase project. It is therefore
**not** a standalone fresh install in bare Postgres. Consequences:

1. in the harness the stubs load first, so load order is controlled;
2. in a real project it must be run inside Supabase (where `auth`/`storage`
   exist), and `is_admin()` / `is_technician()` are `create or replace`, so the
   forward reference resolves before any policy is *evaluated*.

Anything new added to `schema.sql` must keep working under that rule — the suite
fails loudly if it does not.

---

## 2. `npm run test:estimates` — estimate money and status rules

```
node --test scripts/tests/estimate-costs.test.mjs
```

Runs the real `src/lib/estimate-costs.ts` through Node 24's type stripping. That
module is imported by **both** the technician's form (the live total under the
button) and `POST /api/estimates` (validation before the database function sees
the input), so a drift here would mean the customer is shown one number and asked
to approve another. 15 assertions cover:

* rounding to the currency's minor unit, including the values whose binary float
  sits just below the midpoint (`111.115` → `111.12`, not `111.11`);
* `""` meaning 0 (an unused line) versus `abc`, `-1`, `Infinity`, an
  over-sized amount and `null` all being rejected rather than coerced;
* the total being derived from labour + parts + other, with parts legitimately 0;
* a required scope, a required description for any additional charge, and a
  refusal to submit a zero total;
* the status vocabulary and the rule that only the *current* approval is bookable.

What it cannot prove: the database constraints (`estimates_amounts_check` and the
two unique indexes) and the RPCs — those are group 19 of `test:queue-sql` — and
anything about how the components render.

---

## 3. `npm run verify:queue` — live-database verification

```
node scripts/verify-queue-fairness.mjs         # run and clean up
node scripts/verify-queue-fairness.mjs --keep  # leave fixtures for inspection
```

Requirements in `.env.local`: `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

Safety properties:

* **refuses to run** unless `technician_queue_state.queue_position` exists, i.e.
  unless `migration_queue_redesign.sql` has been applied — so it can never run
  half against the old model;
* every fixture lives under generated appliance types (`qa_queue_<runid>`,
  `qa_queue2_<runid>`) and unique email prefixes, so it cannot touch real
  technicians, real customers or real queues;
* it deletes the users, requests, bookings, queue rows and audit rows it
  created (unless `--keep`).

Coverage: the §38 scenario end to end through the RPCs; a schedule conflict that
skips without moving anyone; a future booking that does **not** make a
technician globally unavailable; two independent appliance queues for the same
technician; a technician reading the **whole** queue under real RLS while a
customer is denied it; a duplicate membership insert rejected; a second
acceptance of the same offer rejected; the audit trail; the admin override
without a reason rejected and with a reason audited.

Sign-in is real (`signInWithPassword`, after creating users through the Auth
admin API), so the JWT role-claim path — the part the harness stubs — is
genuinely exercised.


---

## 4. Manual verification (UI)

The scripts prove data behaviour; these confirm the screens match.

**Technician — `/technician/queue`** every technician in the selected appliance
queue is listed with position, operational status and next booking; the
signed-in row is labelled `YOU` and highlighted; the header states "Your queue
position: #n"; the copy says a turn is next *when eligible and available for a
matching request* (never "you get the next job"); tabs switch queues, and a
technician in two queues sees two different positions.

**Technician — dashboard**: `src/components/QueueCard.tsx` shows the same
rotation compactly.

**Customer** — a request in `matching` / `offered` shows only "Checking
technician availability" or "Waiting for a technician to respond"; no names, no
positions, and no way to pick or switch a technician (`AssignmentStatusCard`).
Confirm the payload too: a `GET /api/service-requests` issued with a customer
token must not contain queue rows.

**Admin — `/admin/technician-queue`** full rotation per appliance, status
filter, next bookings, per-request "why was this technician skipped", offer
activity, queue history, and an override that demands a reason and then appears
in the history.

**Customer — service location map (`/customer/request-repair`, step 4)** the map
renders with OpenStreetMap attribution and a Cagayan de Oro default view; tapping
it drops a pin and dragging the pin moves it; "Use my location" prompts for
permission once and, when it is denied, shows a message while the address field
and the map keep working; a pin that is placed but not confirmed blocks the
submit with "Confirm the location you pinned…"; the summary (and the desktop
rail) shows the address plus the confirmed coordinates; after submitting, the
request page re-renders the saved pin. Deny geolocation and block the tile host
(DevTools → Network → offline) to confirm the form still submits with the written
address alone, and that the map's failure card does not cover the submit button.

**Technician — `/technician/estimate-requests`** an unaccepted offer shows the
appliance, problem, photos and requested window and states that the address is
shared on acceptance — **no address and no coordinates**. After accepting, the
same request shows the address, the map pin and "Get directions".
`/technician/jobs` and `/technician/bookings/[id]` show the service-location card
with the pin and the directions button; a request with no pin shows the address
fallback message instead of a map.

Accepting must SAY something: the control reports the engine's own outcome
("Job accepted. Send your estimate below…", "This offer had already expired, so it
was not assigned to you…", or the server's error text) instead of silently
refreshing. An offer whose TTL has already passed is labelled as expired and
offers "Release offer" rather than a dead Accept button.

**The full job flow, in order** — no booking is created by accepting, and none by
approving an estimate:

1. customer submits the request → the rotation offers it (one technician holds it
   for `queue_offer_ttl_minutes`, default 15);
2. **technician** accepts it on `/technician/estimate-requests` → the request
   moves to "Accepted — send an estimate";
3. **technician** submits an itemized estimate — scope of work, labour, parts,
   additional charges and notes (`EstimateForm`, `POST /api/estimates`). The total
   is computed from those lines on the server; a draft can be saved first
   (invisible to the customer) and finished later. This sends version 1 and the
   customer is notified;
4. **customer** opens `/customer/service-request/<id>` (or `/customer/estimates`)
   and reads the itemized breakdown, the version number and the submission date,
   then chooses one of three actions, each behind a confirmation:
   * **Approve estimate** → `POST /api/estimates/:id/decision` records the
     approval against THAT version. Nothing is booked yet;
   * **Request revision** (optional reason) → the estimate returns to the
     technician, who submits a NEW version that supersedes the old one. The
     customer approves the new version explicitly;
   * **Decline estimate** (optional reason) → recorded; no booking is created and
     the request is not silently deleted;
5. **customer** picks a date/time on the approved version and presses "Confirm
   booking" → `POST /api/bookings` creates the booking (it requires the *current
   approved* estimate and re-checks schedule conflicts and capacity, returning 409
   with the reason instead of storing a double-booking). A conflict does **not**
   discard the approval — pick another slot;
6. repair → `awaiting_inspection` → the **customer** confirms the appliance works
   (with a written note) → the booking moves to `awaiting_payment`;
7. **customer** submits the GCash reference at `/customer/bookings/<id>` → the
   payment is `pending_verification`;
8. **administrator** opens `/admin/payments` (linked from the sidebar and from the
   "payments to verify" card on `/admin/dashboard`), finds the reference, and presses
   **Confirm**. The row shows which repair it belongs to and its current status, and
   after confirming it reports *"Payment verified — the repair is now Completed."*
   → `confirm_payment()` closed the repair: the booking became `completed`, the
   service history was archived, the request was closed and the technician's slot was
   freed. Only then can the customer rate it.

A verification that does **not** close a repair says so instead of failing quietly:
`booking_cancelled` (the appointment was cancelled while the reference waited — the
payment stays pending for the admin to reject) and `not_pending` (already verified)
both come back as 409 with the reason shown on the row. If the function is not
installed yet — i.e. `migration_rls_workflow_enforcement.sql` has not been applied —
the row reports *"Payment verification is not installed on this database yet…"*
rather than appearing to do nothing.

**Completion is the verified payment, not the inspection.** Nobody — customer,
technician or administrator — can set a booking to `completed` through the API or
through PostgREST: the transition matrix refuses it and `confirm_payment()` is the
only writer. A booking that never reached `awaiting_payment` cannot be closed by a
payment either (the function raises rather than guessing).

**A customer may cancel their own booking while it is still `pending`** — before the
technician starts. After that, cancellation is an administrator action or a support
request; there are no cancellation fees and no automatic penalties. A cancellation
releases the technician's slot and keeps the booking row as history, and it returns
the **request** from `booked` to `quoted`, so the customer can book the same repair
again with the estimate they already approved — the request is not duplicated, the
technician keeps the job they accepted, and no queue turn is spent or refunded.
Group 22 asserts that round trip, and that cancelling is refused once the work has
started (`in_progress` and beyond), by anyone other than the customer.

**Additional chargeable work** found during the repair follows the same path: the
technician submits a revised estimate (a new version, showing what changed), the
previous version — and any approval it carried — is superseded, and the customer
approves the new total before the extra work proceeds.

**An unanswered estimate stays unanswered.** It remains "Awaiting customer
decision" indefinitely; nothing approves, declines or expires it. There is no
estimate-expiry policy in SPARKServ — see the open policy decision in
`DATABASE.md` / the final report.

**Estimate approval is not payment.** Approving marks the quote, nothing more:
the GCash reference is still submitted separately and verified by an
administrator, and submitting a payment never marks an estimate approved.

If step 1 never happens (every technician skipped with `holding_offer`), see
`QUEUE-SYSTEM.md`, "The offer TTL needs the sweep to run".

**Customer — the problem step (`/customer/request-repair`, step 2)** choosing an
appliance shows its issue list and **no troubleshooting at all**. Typing
"Hindi lumalamig ang ref kahit umaandar" (or the Bisaya/mixed equivalents) offers
"The problem may be: Not cooling. Is this correct?"; the guidance appears only
after "Yes, this is correct", and choosing an issue from the list shows its guide
immediately. Editing the description after confirming withdraws the confirmation
(and any outcome) and re-evaluates; changing the appliance clears the issue,
confirmation and outcome. "No, choose an issue", an unrecognised description and
"Continue without troubleshooting" all leave the form submittable, and no guide
is ever shown for an appliance alone. Submitting with an unidentified issue must
succeed — check the row has `issue_id = null` and the description as typed.

**Admin — `/admin/job-monitoring`** the Location column shows the address, the
stored coordinates and a "Directions" link.

**Migration preflight** — `npm run db:check` lists
`supabase/migration_service_location.sql` until it has been applied; it must
report `technician_pending_offers()` as exposed before the tightened policy is
relied on. It also reports three files as *"nothing to probe: cannot be confirmed
through the API"* — `migration_estimate_status.sql` (an enum value),
`migration_legacy_columns.sql` (a dropped NOT NULL) and
`migration_service_request_photos_bucket.sql` (a storage bucket) — because
PostgREST cannot see any of them. That is not a failure, but it is also not
confirmation: **step 8 must still be applied before step 9**, and the check prints
it in the PENDING list whenever 9 is pending for exactly that reason. Applying 9
without 8 fails with `invalid input value for enum estimate_status: draft`.
Confirm 8 by hand with `select unnest(enum_range(null::estimate_status));`
(expect `draft`, `revision_requested`, `superseded`) and 10 with the query at the
end of `supabase/migration_legacy_columns.sql` (expect `is_nullable = 'YES'`).

**What a skipped step looks like from the browser** — with step 5 or 6 unapplied,
submitting the repair wizard answers `503 SERVICE_SETUP_REQUIRED`. The route also
returns `detail.message` (the database's own wording) and `detail.next_step` in
development, and `RequestRepairWizard` appends it to the banner, so the screen
reads *"… — PGRST204: Could not find the 'issue_id' column of 'service_requests' in
the schema cache"* instead of an unexplained failure. Production returns the opaque
sentence only; never rely on `detail` being present outside development.

**A missing appliance column looks different** — with step 12 unapplied,
`/customer/appliances` shows PostgREST's own wording in a raw `alert()`:
*"Could not find the 'warranty_type' column of 'appliances' in the schema cache"*.
That is not a bug in the page: `/customer/appliances` writes with the browser
client instead of `POST /api/appliances`, so there is no route to translate the
error. The fix is the column (`migration_appliance_columns.sql`), and the raw
message is the most direct signal you will get — but it is the reason a missing
`appliances` column never appears as a 503.

**Cron / sweep** — `vercel.json` schedules `/api/cron/assignment-tick` every 5
minutes in production (`CRON_SECRET` must be set or the route refuses to run
there). Locally, run the same two steps with either:

```
npm run cron:tick                 # expire stale offers + re-match waiting requests
npm run cron:tick -- --dry-run    # report only
curl "http://localhost:3000/api/cron/assignment-tick"
```

**Cancellation** — cancel a request through `PATCH /api/service-requests/:id`
(`{"status":"cancelled"}`) while it is `offered`: the technician's offer card must
disappear from their list, `technician_offer_history` must show `rejected`, an
`EXPIRED` event must be logged, and `assignment_status` must fall back to
`matching`. If a live offer somehow survives (e.g. forced by SQL), pressing Accept
must answer "This request was cancelled, so the offer was released" (HTTP 409) —
never `accepted` + `cancelled`.
The route returns HTTP 500 with "CRON_SECRET is not configured" when
`NODE_ENV=production` and `CRON_SECRET` is unset, so **`CRON_SECRET` must be set
in the Vercel project's environment variables**, or offers never lapse and
`waiting` requests never get re-matched. Locally:
`curl "http://localhost:3000/api/cron/assignment-tick"` (no secret required in dev).

**Customer — booking an appointment (`/customer/bookings/new` or the estimate
screen)** the time the customer picks is the time that is stored; choosing a slot
another appointment already occupies on that technician is refused with a readable
reason (the queue's own wording: "…already has an appointment in that window"), not a
generic 500; picking a time outside the technician's working hours says so; and
submitting the same booking twice — double-click, or a retry after a slow response —
leaves **one** appointment and one request status change, reporting that the request
already has a booking rather than creating a second. Then cancel it from the booking
page and book again: the same request is bookable, the cancelled row is still listed
as history, and the technician's "current load" on `/admin/technician-queue` goes
down by one (not by two, and never negative).

**Admin — `/admin/payments`** each row shows the repair it belongs to; verifying
reports its outcome inline ("Payment verified. The repair is now complete.") and the
list refreshes; verifying the same payment twice says nothing changed; and a
deployment where step 14 is missing answers `503 PAYMENT_SETUP_REQUIRED` rather than
a blank failure.

**Privileges (Batch 3)** — after applying step 16, run the
`information_schema.role_table_grants` query from `DATABASE.md`: `service_role` must
list **SELECT only** on `payments`, and no other role should have gained a write it did
not have. Then reject one reference and verify another through `/admin/payments` to
confirm both decision paths still work with the table write privilege gone (they run as
the function owner, so they must).

**Admin — rejecting a reference (Batch 3)** the Reject button opens a reason field and
**the confirm button stays disabled until a reason is written** — there is no way to
reject without one, at any layer (the button, the route's 400, and `reject_payment()`).
Reviewing shows what the customer will read; confirming reports *"Rejected — the
customer has been told why and can submit a new reference."* The row's status becomes
`Rejected`, the repair stays at the payment step on the customer's page (it is **not**
completed and the technician's load does not change), and the customer's booking page
shows the reason with the payment form open again. Submitting a new reference works,
and verifying that one completes the repair as before. A deployment where step 16 is
missing answers `503 PAYMENT_SETUP_REQUIRED` naming
`supabase/migration_reject_payment.sql`.

**Password recovery** (with the Dashboard settings from README §3 in place) — open
`/login` and confirm the **Forgot password?** link sits beside the password label and
that logging in, registration and role redirects still behave exactly as before. Follow
the link and submit a **registered** address and an address that has **never** had an
account: both must end on the same "Check your email" panel, with nothing that hints one
address exists and the other does not. Press the button twice quickly — one email is
sent, not two (the button disables while the request is in flight, and the handler
re-checks the same rule).

* **Valid link** — the emailed link passes through `/auth/callback`, lands on
  `/update-password` with the form visible, and the browser now holds a session plus a
  `sparkserv-recovery` cookie whose value is a signed payload (payload + `.` +
  signature — **not** the constant `1`).
* **Mismatch** — two different passwords are refused with "Those passwords do not
  match.", and no request is sent.
* **Weak** — a 5-character password is refused by the field and by the rule, naming the
  6-character minimum.
* **Success** — a matching 6+ character password is accepted, "Password updated" is
  shown with a route back to `/login`, logging in with the **new** password works, the
  **old** one is refused, and reopening the same email link shows "This link can't be
  used". Confirm in DevTools → Application → Cookies that the `sparkserv-recovery`
  cookie is **gone** afterwards (the form `DELETE`s it), not merely ignored.
* **Same account, ordinary sign-in** — request a link, open it, then (inside the 15
  minutes) sign out and log in normally in the same browser and open
  `/update-password`: the "This link can't be used" panel must appear, because the
  marker names the recovery session and this is a new one.
* **Same browser, another account** — request a link for account A, open it, then log in
  as account B in the same browser without clearing cookies and open `/update-password`:
  the panel must appear. Neither A's marker nor the still-present cookie may open the
  form for B (and vice versa).
* **Forged marker** — as a signed-in customer, set
  `document.cookie = "sparkserv-recovery=<anything>"` (or paste a valid-looking
  `base64url(JSON).signature` value) and open `/update-password`: still the panel. An
  unsigned or tampered marker must never be accepted.
* **Expired or reused** — wait past the token's expiry (or reuse a spent link): the
  callback bounces to `/forgot-password?error=link_invalid` and the yellow notice
  appears above the form.
* **No session** — clear cookies (or use a private window) and open `/update-password`
  directly: the "This link can't be used" panel renders and **no password field is
  present**. Repeat while signed in as a customer who never asked for a reset — the
  marker cookie is what they lack, and the panel must still appear.
* **Nothing else changed** — after a reset, log in as each role and confirm the sections
  in `ROLES-AND-PERMISSIONS.md` still open (customer → `/customer/dashboard`,
  technician → `/technician/dashboard`, admin → `/admin/dashboard`, super admin →
  `/superadmin/dashboard`) and that `/admin/*` still refuses a customer.

Type and build checks: `npx tsc --noEmit`, `npm run lint`, `npm run build`.

---

## 5. Regression watchlist

The behaviours that break first if someone edits the queue:

1. A future appointment removing a technician from the queue (§3) — group 3 + live check.
2. A skipped technician being repositioned (§8) — group 4.
3. Completion pushing a technician to the back again (§20) — group 11.
4. A technician listing only themselves (§26) — group 6.
5. Rating or experience entering the ordering (§1) — group 15.
6. A client writing `queue_position` directly (§28) — grants + group 9.
7. Cancel or reschedule handing out a fresh turn (§18, §19) — group 14.
8. A booking written without going through `create_booking_atomic()` — group 20
   (`authenticated` inserts are refused) and group 23 (one live booking per request,
   no overlapping appointment, the counter moves once). If a feature needs to create
   an appointment, extend the function; do not add an INSERT policy back.
9. A booking written for a technician who is not qualified for the request's appliance
   type (step 17) — group 26. The qualification rule has exactly one definition
   (`technician_qualification_failure()`), used by both the queue walk and the booking
   transaction; re-implementing it in either place, or checking it only in the API, is
   how this defect returns. If eligibility changes, it changes in that function. The
   same group also holds the `FOR SHARE` locks that stop a qualification change
   committing between the check and the booking — dropping those statements is the
   quieter half of the same regression, and the lock-inventory check catches it.
10. A cancellation that releases the technician's slot twice, or not at all (step 18) —
   group 27. The release must stay a trigger: moving it back into the route is what
   created the gap, and *keeping* the route's `release_technician_slot()` call after the
   trigger lands would double-decrement every cancellation. `booking_status_holds_slot()`
   is the one definition of which statuses hold a slot; widening it to include
   `completed` or `cancelled` is the other way this breaks.

If any of these regress, fix it in the SQL functions, not in React — see
`ARCHITECTURE.md`, "Rule 1".
