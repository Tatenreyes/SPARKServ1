# SPARKServ — Progress

Status as of 27 Sep 2026. This is the "where does the project actually stand"
document: what is finished, what is proven, and what is still owed. The queue
rules themselves are in `QUEUE-SYSTEM.md`; how to re-prove them is in
`TESTING.md`.

## Summary

The technician queue redesign is **code-complete and locally verified**. It is
**not yet applied to the live database**, so the live verification step is still
open — that is the only thing standing between this branch and the acceptance
scenario being true in production.

| Area | State |
| --- | --- |
| Queue model in Postgres (tables, RPCs, triggers, grants) | Implemented; proven 69/69 against real Postgres |
| Fresh-install schema (`supabase/schema.sql`) | Matches the migrated end state; harness builds a DB from it and all checks pass |
| TypeScript layer (`src/lib/queue.ts`, `assignment.ts`, `service-time.ts`, types) | Implemented; `tsc --noEmit` clean |
| API endpoints | Implemented; all routes compile in `next build` |
| Technician / Admin / Customer screens | Implemented; build succeeds, `/technician/queue` present in the route table |
| Forbidden behaviour removed | Ranking endpoint, scoring engine and ranked card deleted |
| Documentation | Updated across 8 files (see below) |
| **Live database migration** | **Pending — must be run by a human in the Supabase SQL editor** |
| **Live verification** (`npm run verify:queue`) | **Pending — blocked on the migration above** |
| Manual UI walkthrough with real accounts | Pending |

## What is implemented

### Database

* `supabase/migration_queue_redesign.sql` — the queue itself:
  `technician_queue_members` (rotation), `technician_operational_status`
  (separate), `technician_queue_events` (append-only audit), `queue_position` +
  `last_assigned_at` + `requested_window_*` columns, and the RPCs
  `technician_queue_snapshot()`, `try_assign_service_request()`,
  `respond_to_offer()`, `expire_stale_offers()`, `admin_queue_override()`,
  `refresh_technician_operational_status()`, plus membership sync triggers and
  `REVOKE EXECUTE` on every mutating function.
* `supabase/migration_sync_live_schema.sql` + `migration_flow_hardening.sql` —
  bring an existing project up to the same state (workflow columns, capacity
  fields, request status alignment).
* `supabase/schema.sql` — same end state for a fresh project, so a new database
  does not need the migrations.

### Application

* `src/lib/queue.ts` — the only queue read path: one snapshot call per appliance
  plus `customerAssignmentCopy()` (the customer wording).
* `src/lib/assignment.ts` — thin wrappers over the RPCs; no decision logic in
  TypeScript, deliberately.
* `src/lib/service-time.ts` — preferred date/time → UTC window in the service
  timezone, `formatRequestedWindow()` for display, and the conflict/capacity
  helpers.
* `src/app/api/service-requests/route.ts` — creates the request and the first
  assignment attempt in one call.
* `src/app/api/service-requests/[id]/offer-response/route.ts` — accept/decline
  through `respond_to_offer()`.
* `src/app/api/admin/queue-override/route.ts` — reason-required override.
* `src/app/api/cron/assignment-tick/route.ts` — expiry + re-match + status
  refresh, every 5 minutes via `vercel.json`.
* Screens: `/technician/queue` (full rotation per appliance, `YOU` marker),
  `/technician/dashboard` (`QueueCard`), `/admin/technician-queue` (positions,
  statuses, skip reasons, offer activity, history, override), and the
  customer-facing `AssignmentStatusCard` / `ServiceTracking`.

### Surfaces removed

`POST /api/recommend`, `src/lib/recommendation.ts`, `TechnicianWithScore` and
`src/components/TechnicianCard.tsx` were deleted: they ranked technicians by
rating, experience and distance — with a customer-callable endpoint and a
"match score" card that could be selected. None of it was wired into any screen,
so nothing broke. Reasoning is recorded in `QUEUE-SYSTEM.md`.

## What is proven, and how

| Check | Command | Result |
| --- | --- | --- |
| Queue behaviour against real SQL | `npm run test:queue-sql` | **69/69 passed** |
| Types | `npx tsc --noEmit` | clean |
| Lint | `npx next lint` | clean except one pre-existing `<img>` warning in `RequestRepairWizard.tsx` |
| Whole app compiles, routes resolve | `npm run build` | succeeded, 67/67 pages; `/technician/queue`, `/api/admin/queue-override`, `/api/cron/assignment-tick`, `/api/technician-availability` all present |
| **Live DB migration state** | `npm run db:check` | exit 1 — **nothing applied** (11 + 2 + 22 objects missing) |

`npm run test:queue-sql` boots a real Postgres in-process (PGlite), loads
`schema.sql` and the two `SECURITY INVOKER` harness files, and asserts the spec
by section: rotation on acceptance exactly once, position unchanged by decline,
schedule skip leaves position intact, a Jan 30 booking does not block a Jan 24
request, overlap skips only the clashing technician, no second live offer,
one winner under concurrent acceptance, completion/reschedule/cancel do not
re-rotate, override requires a reason and is audited, and rating/experience
changes move nobody.

Two of those need three separate connections at once (the concurrency checks),
which is why the runner keeps three clients on one server rather than trusting
simulated timing.

## What is NOT proven yet

0. **THE LIVE DATABASE HAS NONE OF THE THREE MIGRATIONS.** This was measured,
   not assumed — `npm run db:check` (added in this pass) probes the real project
   in `.env.local` and reports, per migration, per object:

   | Migration | Objects missing |
   | --- | --- |
   | `migration_sync_live_schema.sql` | **11 of 11** — not applied |
   | `migration_flow_hardening.sql` | 2 of 3 — `offers_expires_at` and `expire_offer()` absent |
   | `migration_queue_redesign.sql` | **22 of 22** — not applied |

   The base tables the migrations build on all exist and are readable
   (`technician_queue_state`, `service_requests`, `appliances`, `bookings`,
   `estimates`, `technicians`, `users`, `system_settings`,
   `technician_offer_history`, `notifications`), so migration 3's
   `alter table public.technician_queue_state` will find its target. Only **3
   RPCs** are exposed to the service role on the live project.

   The consequence is worse than "the new queue is not live": because
   `service_requests.problem_description`, `photos`, `service_type` and
   `appliance_id` are all absent, **the deployed app cannot create a repair
   request at all** — every POST hits PostgreSQL 42703, which PostgREST surfaces
   as an unexplained HTTP 500. That is migration 1's whole purpose and it has
   never been run.

1. **Live schema.** The three migrations have not been applied to the live
   Supabase project. Until they are, the deployed app is still running the old
   queue and `verify:queue` cannot pass.
2. **RLS and auth behaviour on the live project.** PGlite has no Supabase Auth,
   so no JWT roles exist there. The checks that only the live run can give — a
   technician reading another technician's queue rows, a customer being refused
   `technician_queue_members`, the service-role path still working — are designed
   and scripted but unexecuted.
3. **Real browser behaviour** for the three new screens with seeded accounts.
4. **The cron in production** (`vercel.json` → `/api/cron/assignment-tick`) has
   not been observed firing.
5. **Availability and area data entry — now built, still unexercised.** The three
   tables are edited on `/technician/profile` via `AvailabilityManager`, which
   reads and writes `/api/technician-availability` (including the new
   `add_area` / `remove_area` actions, which nothing wrote before). It has never
   been opened in a browser, because it needs migration 3 applied first — the
   API returns `503` naming the migration until then.

## Fix applied while writing these docs

`USER-FLOWS.md` originally described the customer picking a date *and* a time
window. Checking that claim against the code found it was false in two ways, both
now fixed:

* `RequestRepairWizard` kept `preferredDate` in local state, showed it in the
  review summary, and then omitted it from the `POST` body — the customer's
  choice was discarded and every request stored a null window, so availability
  and duration checks never ran in production. The wizard now sends
  `preferred_date` + `preferred_start_time` + `preferred_end_time`, refuses a
  half-entered or inverted window, and says the times are service-timezone.
* Nothing rendered the stored window back to anyone. `formatRequestedWindow()`
  now feeds the technician's offer card and the customer's request page, and an
  absent window is labelled "no time preference" instead of rendering nothing —
  the two cases mean different things to the queue.

Verified by compiling `service-time.ts` and calling the real function on a box
whose own timezone is `Asia/Shanghai`: a `01:00Z` instant renders as `09:00 AM`
Manila, so the conversion does not depend on the machine's clock.

## Next steps, in order

1. **Apply the migrations** (human action — Supabase SQL Editor, in this order,
   one file at a time, waiting for each to report success):
   `migration_sync_live_schema.sql` → `migration_flow_hardening.sql` →
   `migration_queue_redesign.sql`. Then reload the Postgres schema in the
   dashboard so PostgREST notices the new RPCs and columns. Every file is
   guarded and idempotent, so a re-run is harmless.
2. **`npm run db:check`** — must report all three applied before going further.
   This is now the gate; it replaces guessing.
3. Copy the `-- 7. VERIFY` block at the end of `migration_queue_redesign.sql` and
   run it: `2.0` as the model version and non-zero membership rows.
4. `npm run verify:queue`. Expect `checks failed: 0`. Anything else is a real bug
   or an unapplied migration. (This script needs only the anon + service-role
   keys already in `.env.local`; the earlier note claiming it needs
   `SUPABASE_PAT` was wrong.)
5. Manual walkthrough: technician sees the full rotation and their own position,
   and can save working hours / time off / service areas on
   `/technician/profile`; admin sees skip reasons; customer sees only the four
   plain-language states; an ignored offer visibly re-offers after the TTL.
6. Confirm the cron fires in the Vercel logs.
7. Commit — nothing from this redesign is committed yet (see `git status`).

