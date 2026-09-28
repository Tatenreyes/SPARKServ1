# SPARKServ — Testing

Two automated harnesses cover the queue. They answer different questions, and
**both** are needed before the queue work can be called done.

| Command | Runs against | Proves | Cannot prove |
| --- | --- | --- | --- |
| `npm run test:queue-sql` | an in-process WASM Postgres (PGlite) loaded with this repo's real SQL files | the **logic**: rotation, skip rules, capacity, expiry, race guards, audit rows | that the migration was applied to the live project, real JWT claims, PostgREST exposure, UI rendering |
| `npm run verify:queue` | the **live Supabase project** from `.env.local` | the **deployed system**: real RLS, real GRANTs, real `auth.uid()`, RPC exposure through PostgREST | anything about the browser UI |

A green PGlite run means "the SQL is sound". A green live run means "the
deployed system behaves that way". Neither substitutes for the other.

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
  `supabase/migration_queue_redesign.sql`. **The queue logic is tested against
  the DDL that ships**, so a syntax or ordering error in a migration fails here.
* 15 groups, 69 assertions, current result **69/69 passed**:

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

Group 3 is the acceptance scenario verbatim: `A → B → C`, A accepts a repair
booked for a week later, the rotation must become `B → C → A` with **A still a
member**, then requests on the 24th, 25th and 26th rotate it back through
`C → A → B` → `A → B → C` → `B → C → A`, proving one technician can hold two
future repairs.


### Limits to keep in mind

* PGlite is a Postgres build compiled to WASM, not the exact Supabase minor
  version. Treat "passed" as *the SQL is sound*, not *production is verified*.
* `auth.uid()` and the `auth` / `storage` schemas are local stubs.
* Supabase-managed helpers (`auth.jwt()`, `auth.role()`) do not exist in a bare
  Postgres, so role resolution goes through `public.current_role()` (defined by
  the migrations against `users.role`) — the same definition production uses.
* `@electric-sql/pglite` is a **devDependency**. It is imported only by this
  script, never by application code, so it never reaches a Vercel build.

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

## 2. `npm run verify:queue` — live-database verification

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

## 3. Manual verification (UI)

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

**Cron** — `vercel.json` schedules `/api/cron/assignment-tick` every 5 minutes.
The route returns HTTP 500 with "CRON_SECRET is not configured" when
`NODE_ENV=production` and `CRON_SECRET` is unset, so **`CRON_SECRET` must be set
in the Vercel project's environment variables**, or offers never lapse and
`waiting` requests never get re-matched. Locally:
`curl "http://localhost:3000/api/cron/assignment-tick"` (no secret required in dev).

Type and build checks: `npx tsc --noEmit`, `npm run lint`, `npm run build`.

---

## 4. Regression watchlist

The behaviours that break first if someone edits the queue:

1. A future appointment removing a technician from the queue (§3) — group 3 + live check.
2. A skipped technician being repositioned (§8) — group 4.
3. Completion pushing a technician to the back again (§20) — group 11.
4. A technician listing only themselves (§26) — group 6.
5. Rating or experience entering the ordering (§1) — group 15.
6. A client writing `queue_position` directly (§28) — grants + group 9.
7. Cancel or reschedule handing out a fresh turn (§18, §19) — group 14.

If any of these regress, fix it in the SQL functions, not in React — see
`ARCHITECTURE.md`, "Rule 1".
