# SPARKServ — Database

## Where the schema lives

| File | Role |
| --- | --- |
| `supabase/schema.sql` | Canonical install: extensions, enums, tables, indexes, RLS policies, triggers, storage buckets. **Not self-contained** — it assumes Supabase's `auth`/`storage` schemas and the `anon`/`authenticated`/`service_role` roles exist. |
| `supabase/migration_sync_live_schema.sql` | Brings an older live project up to the pre-queue shape (idempotent). |
| `supabase/migration_flow_hardening.sql` | Flow hardening (idempotent). |
| `supabase/migration_queue_redesign.sql` | **Queue model v2.** Adds the queue columns/tables/functions/policies/grants described in `QUEUE-SYSTEM.md`. Idempotent: re-running it is a no-op, which `npm run test:queue-sql` proves by loading it twice. |
| `supabase/migration_technician_queue.sql` | Historical, superseded by `schema.sql` + the redesign. Do not apply it on top of them. |

### Apply order

There is no DDL channel from this repo to the project (no `psql`, no Supabase CLI,
no management token), so migrations are applied by hand. In the Supabase SQL
Editor, in this order:

```
1. supabase/migration_sync_live_schema.sql
2. supabase/migration_flow_hardening.sql
3. supabase/migration_queue_redesign.sql
```

Then confirm with `npm run verify:queue` — it refuses to run until step 3 is
applied (it checks for `technician_queue_state.queue_position`).

A fresh install runs `schema.sql` first and then the same three migrations; the
harness `scripts/test-queue-sql.mjs` loads exactly that sequence, which is how the
fresh-install and live-upgrade paths are kept equivalent.

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

Indexes added: `idx_bookings_technician_window (technician_id, scheduled_at)` and
a partial `idx_service_requests_requested_window (requested_window_start)`.

## Functions

See the RPC table in `QUEUE-SYSTEM.md`. The architectural point:

- **Read** functions (`technician_queue_snapshot`) are callable by authenticated
  technicians/admins and return only non-sensitive fields.
- **Mutation** functions (`assign_technician_to_request`, `respond_to_offer`,
  `expire_stale_offers`, `consume_queue_turn`) are revoked from `anon` and
  `authenticated` and granted to `service_role` only. They take a row lock on the
  request plus an advisory lock per request, which is what makes concurrent
  assignment safe.

## Row Level Security

| Table | Who can read | Who can write |
| --- | --- | --- |
| `technician_queue_state` | technicians (their own queues), admins | nobody through the API — only SECURITY DEFINER functions, plus admins through `admin_queue_override` |
| `technician_queue_events` | the technician the row is about, admins | only SECURITY DEFINER functions (no client insert path) |
| `technician_availability`, `technician_time_off`, `technician_service_areas` | owner + admins | owner + admins |
| `technician_offer_history` | owner + admins | admins / service role via RPC |
| `service_requests`, `bookings` | existing policies (a customer owns theirs, an assigned technician sees theirs, admins see all) | unchanged |

`is_technician()` and `is_admin()` back those policies; both derive from
`public.users.role` through `current_role()`, which reads `auth.uid()`.

## Triggers

| Trigger | Effect |
| --- | --- |
| `sync_queue_membership_trigger` (technicians) | an approved technician's specializations are synced into `technician_queue_state` — joining a queue at the end, leaving it on removal |
| `sync_queue_membership_user_trigger` (users) | deactivating an account removes it from the rotations (`REMOVED`) |
| `on_auth_user_created` (auth.users) | creates `public.users` (+ a `technicians` row for the technician role) from signup metadata |

## Known state worth flagging

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

