-- =========================================================
-- Migration: sync a pre-appliance-centric database with the schema the app expects
-- ---------------------------------------------------------
-- WHY THIS FILE EXISTS
-- The live database was created before the appliance-centric flow landed, so
-- the application writes columns that do not exist yet:
--
--   service_requests : appliance_id, issue_category, problem_description,
--                      photos, service_type, offers_expires_at
--   appliances       : model_number, serial_number, warranty_status,
--                      warranty_expiry_date
--   bookings         : inspection_confirmed_at, inspection_note
--
-- PostgREST rejects every one of those with PostgreSQL 42703
-- (undefined_column), which the API turns into a blanket HTTP 500. The first
-- user-visible symptom is "POST /api/service-requests 500" with nothing in the
-- browser to explain it — the real error only ever appears in the server log.
--
-- WHY NOT RE-RUN migration_appliance_centric_flow.sql INSTEAD
-- That migration rebuilds the table: create service_requests_new, copy rows,
-- then `drop table public.service_requests cascade`. The CASCADE silently drops
-- the FOREIGN KEYS held by estimates.service_request_id,
-- bookings.service_request_id and technician_offer_history.service_request_id,
-- and it never recreates them — so referential integrity would be quietly lost.
--
-- This file only ADDS what is missing. Nothing is dropped, no rows are copied,
-- no foreign keys are touched, and every statement is guarded, so it is safe to
-- run more than once and safe to run on a database that is already current.
-- =========================================================

-- ---------- 1. appliances: warranty/model fields the request wizard collects ----------
alter table public.appliances
  add column if not exists model_number text,
  add column if not exists serial_number text,
  add column if not exists warranty_status text not null default 'unknown',
  add column if not exists warranty_expiry_date date;

-- Added separately from the statement above: `add column ... check (...)`
-- is not idempotent, so the constraint needs its own existence guard.
do $outer$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'appliances_warranty_status_check'
      and conrelid = 'public.appliances'::regclass
  ) then
    alter table public.appliances
      add constraint appliances_warranty_status_check
      check (warranty_status in ('yes', 'no', 'unknown'));
  end if;
end
$outer$;

-- ---------- 2. service_requests: appliance-centric columns ----------
-- problem_description is deliberately added NULLABLE here and made NOT NULL in
-- step 3: adding it as NOT NULL outright would fail against the existing rows.
alter table public.service_requests
  add column if not exists appliance_id uuid
    references public.appliances(id) on delete set null,
  add column if not exists issue_category text,
  add column if not exists photos text[] not null default '{}',
  add column if not exists service_type text not null default 'repair',
  add column if not exists problem_description text,
  add column if not exists offers_expires_at timestamptz;

-- ---------- 3. backfill, then enforce NOT NULL ----------
-- Existing rows predate problem_description; their text lives in the legacy
-- issue_description column. The DO block exists because a plain statement
-- naming issue_description would fail to parse on a database that has already
-- dropped that column — EXECUTE defers name resolution to run time.
do $outer$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'service_requests'
      and column_name = 'issue_description'
  ) then
    execute $sql$
      update public.service_requests
         set problem_description =
               coalesce(nullif(btrim(coalesce(issue_description, '')), ''), 'Issue reported by customer')
       where problem_description is null
    $sql$;
  else
    execute $sql$
      update public.service_requests
         set problem_description = 'Issue reported by customer'
       where problem_description is null
    $sql$;
  end if;
end
$outer$;

alter table public.service_requests
  alter column problem_description set not null;

-- ---------- 4. bookings: inspection sign-off ----------
alter table public.bookings
  add column if not exists inspection_confirmed_at timestamptz,
  add column if not exists inspection_note text;

-- ---------- 5. indexes the code depends on ----------
-- The two partial indexes are what make the assignment engine's read-then-write
-- safe: without uniq_active_offer_per_technician a technician can hold two
-- active offers at once, and without idx_service_requests_offer_expiry the
-- offer-expiry sweep degenerates into a sequential scan.
create index if not exists idx_service_requests_customer
  on public.service_requests (customer_id);

create index if not exists idx_service_requests_status
  on public.service_requests (status);

create index if not exists idx_service_requests_assignment_status
  on public.service_requests (assignment_status);

create index if not exists idx_service_requests_offer_expiry
  on public.service_requests (offers_expires_at)
  where assignment_status = 'offered';

create unique index if not exists uniq_active_offer_per_technician
  on public.service_requests (assigned_technician_id)
  where assignment_status = 'offered' and assigned_technician_id is not null;

create index if not exists idx_appliances_customer
  on public.appliances (customer_id);

-- ---------- Verify ----------
-- Run this afterwards; expect 12 rows:
--
--   select column_name
--   from information_schema.columns
--   where table_schema = 'public'
--     and table_name in ('service_requests', 'appliances', 'bookings')
--     and column_name in (
--       'appliance_id', 'issue_category', 'problem_description', 'photos',
--       'service_type', 'offers_expires_at', 'model_number', 'serial_number',
--       'warranty_status', 'warranty_expiry_date',
--       'inspection_confirmed_at', 'inspection_note'
--     )
--   order by column_name;
