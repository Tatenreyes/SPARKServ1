# SPARKServ — Progress

Status as of 30 Oct 2026. This is the "where does the project actually stand"
document: what is finished, what is proven, and what is still owed. The queue
rules themselves are in `QUEUE-SYSTEM.md`; how to re-prove them is in
`TESTING.md`.

## Summary

The technician queue redesign, Batches 1–3, the booking-eligibility invariant
(step 17) and the atomic cancellation release (step 18) are **code-complete and
locally verified, and the live database now has every migration applied —
steps 1–18** (`npm run db:check` exits 0 with 76 checks passed). What is still
owed is on the code side: the whole implementation sits uncommitted in the
working tree, and no deployment has been verified. Until the release is committed
and deployed, the *deployed* app is not the app this document describes.

| Area | State |
| --- | --- |
| Queue model in Postgres (tables, RPCs, triggers, grants) | Implemented; proven **374/374** checks in the SQL suite |
| Fresh-install schema (`supabase/schema.sql`) | Matches the migrated end state; harness builds a DB from it and all checks pass |
| TypeScript layer (`src/lib/queue.ts`, `assignment.ts`, `service-time.ts`, types) | Implemented; `tsc --noEmit` clean |
| API endpoints | Implemented; all routes compile in `next build` |
| Technician / Admin / Customer screens | Implemented; build succeeds, `/technician/queue` present in the route table |
| Forbidden behaviour removed | Ranking endpoint, scoring engine and ranked card deleted |
| Documentation | Updated across 8 files (see below) |
| **Live database migration** | **Applied — steps 1–18; `npm run db:check` exits 0 (76 checks passed)** |
| **Application code** | **Uncommitted — the whole release is in the working tree (93 modified, 29 deleted, 93 untracked paths)** |
| **Deployment** | **Not verified — no deployment URL is recorded in this repo; do not describe production as running this code** |
| **Live verification** (`npm run verify:queue`) | **Pending — deliberately not run: it creates and cleans up live fixtures** |
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
| Queue behaviour against real SQL | `npm run test:queue-sql` | **374/374 checks passed** |
| Types | `npx tsc --noEmit` | clean |
| Lint | `npm run lint` | clean — no warnings or errors |
| Whole app compiles, routes resolve | `npm run build` | succeeded; `/technician/queue`, `/api/admin/queue-override`, `/api/cron/assignment-tick`, `/api/technician-availability` all present |
| **Live DB migration state** | `npm run db:check` | exit 0 — **all 18 applied** (76 checks passed) |

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

0. **The live database is migrated; the deployed application is not.** `npm run
   db:check` exits 0 against the real project in `.env.local` and reports all 18
   migrations applied (76 checks passed; **42 RPCs** exposed to the service role).
   The risk has therefore flipped direction: the database now enforces steps 14–18, so
   a deployed build of a committed revision cannot book (step 15 withdrew the INSERT
   policies on `bookings`), cannot complete a repair (`confirm_payment()` is the only
   writer), and double-decrements `active_job_load` on every cancellation (the
   committed route decrements by hand *and* step 18's trigger releases). See
   `DATABASE.md` → *Known state worth flagging*, and the release manifest.

1. **The release itself.** The code that matches the live schema is uncommitted and
   undeployed. Nothing here can be described as running in production until the
   release is committed, pushed, deployed, and the deployed revision is confirmed to
   be the one that was tested.
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
   reads and writes `/api/technician-availability` (including the `add_area` /
   `remove_area` actions). Migration 3 is applied, so the old `503` reason no
   longer applies — it has simply never been opened in a browser.

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

1. **Ship the release.** The migrations are already live; the code is not. Stage the
   release paths explicitly (never `git add -A`), commit, push `main` to
   `origin/main`, and deploy. `DATABASE.md` → *Known state worth flagging* carries the
   safety checks and the ordering rules; the release manifest lists the exact paths.
2. **`npm run db:check`** — must still exit 0 (all 18 applied) before and after the
   deploy. This is the gate; it replaces guessing. Do **not** re-apply migrations
   1–18: they are applied, and idempotence is a safety net, not an invitation.
3. **Confirm the deployed revision** — the deployed commit must be the one that was
   tested locally. There is no deployment URL recorded in this repo, so this is a
   check against the hosting dashboard, not against a documented URL.
4. `npm run verify:queue`. Expect `checks failed: 0`. Anything else is a real bug
   or an unapplied migration. **It is a live write**: it creates and cleans up its own
   fixtures (users, requests, bookings, queue rows) scoped to a unique appliance type,
   so run it deliberately. (It needs only the anon + service-role keys already in
   `.env.local`; the earlier note claiming it needs `SUPABASE_PAT` was wrong.)
5. Manual walkthrough: technician sees the full rotation and their own position,
   and can save working hours / time off / service areas on
   `/technician/profile`; admin sees skip reasons; customer sees only the four
   plain-language states; an ignored offer visibly re-offers after the TTL.
6. Confirm the cron fires in the Vercel logs.
7. Keep this document honest. It reported the migrations as pending for five weeks
   after they had been applied; update `PROGRESS.md` in the same commit as the
   release, not afterwards.

