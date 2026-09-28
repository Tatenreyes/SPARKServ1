-- =========================================================
-- SPARKServ — QUEUE MODEL v2  (supabase/migration_queue_redesign.sql)
-- ---------------------------------------------------------
-- Run this in the Supabase SQL Editor.
--
-- PREREQUISITES (run these first, in this order, if you have not):
--   1. supabase/migration_sync_live_schema.sql   (adds problem_description,
--      offers_expires_at and the other appliance-centric columns the app writes)
--   2. supabase/migration_flow_hardening.sql     (offer expiry index +
--      "one active offer per technician" guard)
-- The preflight below refuses to run — with an explicit message — if those
-- columns are still missing, instead of failing halfway through with a
-- confusing 42703.
--
-- WHAT THIS FILE REPLACES
-- The old rule was:
--   "accept a job -> disappear from the queue until the job completes."
-- That meant a technician booked for Jan 30 was invisible to the queue from
-- the moment the booking existed, and could not take anything in between
-- (see src/lib/assignment.ts, which excluded anyone holding ANY
-- pending/in_progress booking).
--
-- The new model treats four things as separate concepts:
--   QUEUE POSITION -> fairness (who has waited longest since their last turn)
--   ELIGIBILITY    -> qualification (approved, active, specialized, area)
--   AVAILABILITY   -> can they actually work the requested window?
--   CAPACITY       -> would accepting exceed their workload limits?
-- A future booking only affects the request(s) it actually conflicts with.
-- A technician who is skipped keeps their queue position. Only ACCEPTING an
-- offer consumes a turn and moves them to the end of that appliance queue.
--
-- Every statement is guarded, so this file is safe to re-run.
-- =========================================================

create extension if not exists "uuid-ossp";

-- ---------- Preflight: fail loudly and early, with instructions ----------
do $preflight$
declare
  missing text[] := '{}';
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'service_requests'
      and column_name = 'problem_description'
  ) then
    missing := missing || 'service_requests.problem_description';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'service_requests'
      and column_name = 'offers_expires_at'
  ) then
    missing := missing || 'service_requests.offers_expires_at';
  end if;

  if array_length(missing, 1) is not null then
    raise exception
      'QUEUE v2: prerequisite columns are missing (%). Run supabase/migration_sync_live_schema.sql and supabase/migration_flow_hardening.sql first, then re-run this file.',
      array_to_string(missing, ', ');
  end if;
end
$preflight$;

-- =========================================================
-- 1. Canonical appliance types + queue settings helpers
-- =========================================================

-- Technician specializations are stored as human labels in places
-- ("Air Conditioner") while service_requests.appliance_type stores slugs
-- ("aircon"). Every queue comparison therefore goes through this function, so
-- the two vocabularies can never silently disagree and strand a request in
-- "waiting" even though a qualified technician exists.
create or replace function public.normalize_appliance_type(p_value text)
returns text
language sql
immutable
as $$
  select case
    when v is null or v = '' then null
    when v in ('refrigerator', 'fridge', 'freezer_refrigerator') then 'refrigerator'
    when v in ('aircon', 'air_conditioner', 'air_conditioning', 'air conditioner', 'ac') then 'aircon'
    when v in ('washing_machine', 'washing machine', 'washer') then 'washing_machine'
    when v in ('clothes_dryer', 'clothes dryer', 'dryer') then 'clothes_dryer'
    when v in ('tv', 'television', 'television_set') then 'tv'
    when v in ('electric_fan', 'electric fan', 'fan') then 'electric_fan'
    when v in ('microwave', 'microwave_oven', 'microwave oven') then 'microwave'
    when v in ('rice_cooker', 'rice cooker') then 'rice_cooker'
    when v in ('electric_stove', 'electric stove', 'stove') then 'electric_stove'
    when v in ('induction_cooker', 'induction cooker') then 'induction_cooker'
    when v in ('water_dispenser', 'water dispenser') then 'water_dispenser'
    when v in ('electric_kettle', 'electric kettle', 'kettle') then 'electric_kettle'
    when v in ('vacuum_cleaner', 'vacuum cleaner', 'vacuum') then 'vacuum_cleaner'
    when v in ('water_heater', 'water heater', 'heater') then 'water_heater'
    else replace(replace(v, ' ', '_'), '-', '_')
  end
  from (select lower(btrim(coalesce(p_value, ''))) as v) t;
$$;

-- One row per setting key, so ops can tune the queue without a deploy.
insert into public.system_settings (key, value) values
  ('queue_offer_ttl_minutes', '15'),
  ('queue_decline_consumes_turn', 'false'),
  ('queue_service_timezone', 'Asia/Manila'),
  ('queue_model_version', '2.0')
on conflict (key) do nothing;

create or replace function public.queue_setting(p_key text, p_default text default null)
returns text
language sql
stable
security definer set search_path = public
as $$
  select coalesce((select value from public.system_settings where key = p_key), p_default);
$$;

create or replace function public.queue_setting_int(p_key text, p_default integer)
returns integer
language sql
stable
security definer set search_path = public
as $$
  select coalesce(nullif(btrim(public.queue_setting(p_key, '')), '')::integer, p_default);
$$;

create or replace function public.queue_setting_bool(p_key text, p_default boolean)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select case
    when exists (select 1 from public.system_settings where key = p_key)
      then lower(btrim((select value from public.system_settings where key = p_key)))
             in ('true', 't', '1', 'yes', 'on')
    else p_default
  end;
$$;

-- The platform's service timezone. Used only for calendar bucketing
-- ("jobs that day", "which weekday is the technician available"). Timestamps
-- themselves stay timestamptz — no local-time storage anywhere.
create or replace function public.service_timezone()
returns text
language sql
stable
security definer set search_path = public
as $$
  select coalesce(nullif(btrim(public.queue_setting('queue_service_timezone', 'Asia/Manila')), ''), 'Asia/Manila');
$$;

-- =========================================================
-- 2. Technician workload + operational status
-- =========================================================
-- operational_status is the technician's OPERATIONAL state. It is deliberately
-- separate from queue membership: a technician can be SCHEDULED (has a future
-- appointment) and still sit in the queue at position #2.
--   AVAILABLE | ON_JOB | SCHEDULED | TEMPORARILY_UNAVAILABLE | OFFLINE | SUSPENDED
alter table public.technicians
  add column if not exists operational_status text not null default 'AVAILABLE',
  add column if not exists status_updated_at timestamptz not null default now(),
  -- Capacity limits (section 17 of the queue spec). Time-based by default:
  -- 8 working hours/day, 2 simultaneous jobs, 4 appointments/day.
  add column if not exists max_daily_hours numeric not null default 8,
  add column if not exists max_concurrent_jobs integer not null default 2,
  add column if not exists max_jobs_per_day integer not null default 4,
  -- Default length assumed for a job when nobody has said otherwise.
  add column if not exists default_job_minutes integer not null default 120;

-- `add column ... check (...)` is not idempotent, so the constraints get their
-- own existence guards (same pattern as migration_sync_live_schema.sql).
do $constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'technicians_operational_status_check'
      and conrelid = 'public.technicians'::regclass
  ) then
    alter table public.technicians
      add constraint technicians_operational_status_check
      check (operational_status in (
        'AVAILABLE', 'ON_JOB', 'SCHEDULED', 'TEMPORARILY_UNAVAILABLE', 'OFFLINE', 'SUSPENDED'
      ));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'technicians_capacity_positive_check'
      and conrelid = 'public.technicians'::regclass
  ) then
    alter table public.technicians
      add constraint technicians_capacity_positive_check
      check (max_daily_hours >= 0 and max_concurrent_jobs >= 0 and max_jobs_per_day >= 0);
  end if;
end
$constraints$;

-- Helper: is the caller a technician? (Used by the queue RLS policies, which
-- must let technicians read the queue — but must NOT let customers read it.)
create or replace function public.is_technician()
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select public.current_role() = 'technician';
$$;

-- =========================================================
-- 3. Queue membership (technician_queue_state)
-- =========================================================
-- The table already existed as (technician_id, appliance_type,
-- last_assigned_at) and it already modelled the right *ordering* rule. What it
-- lacked was an explicit, inspectable membership record: a stable position, a
-- way to deactivate a membership without deleting its history, and a turn
-- counter. Those are added here rather than creating a second, parallel
-- "technician_queue_members" table that could disagree with this one.
alter table public.technician_queue_state
  add column if not exists id uuid not null default uuid_generate_v4(),
  add column if not exists queue_position integer,
  add column if not exists is_active boolean not null default true,
  add column if not exists turn_count integer not null default 0,
  add column if not exists joined_at timestamptz not null default now();

create unique index if not exists uniq_queue_state_id
  on public.technician_queue_state (id);

-- One row per (technician, appliance type) — the primary key already prevents
-- duplicate memberships, so "the same technician appears twice in one queue"
-- is impossible by construction.
create index if not exists idx_queue_state_appliance_position
  on public.technician_queue_state (appliance_type, queue_position);

-- Backfill: positions are ordered exactly the way the assignment engine has
-- always ordered the queue (never-assigned first, then oldest turn first), so
-- migrating does not reshuffle anyone's fair place.
with ranked as (
  select
    technician_id,
    appliance_type,
    row_number() over (
      partition by appliance_type
      order by last_assigned_at asc nulls first, technician_id
    ) as position
  from public.technician_queue_state
)
update public.technician_queue_state qs
   set queue_position = ranked.position
  from ranked
 where ranked.technician_id = qs.technician_id
   and ranked.appliance_type = qs.appliance_type
   and qs.queue_position is null;

alter table public.technician_queue_state
  alter column queue_position set default 1;

-- RLS: technicians may READ the whole queue for an appliance type (that is the
-- bug this migration fixes — the old policy restricted reads to
-- `technician_id = auth.uid()`, which is why a technician only ever saw
-- themselves). Membership rows contain no private data: technician id,
-- appliance type, position, timestamps. Customers still cannot read them.
drop policy if exists "technician views own queue position" on public.technician_queue_state;

drop policy if exists "technician and admin view queue positions" on public.technician_queue_state;
create policy "technician and admin view queue positions"
  on public.technician_queue_state for select
  using (public.is_technician() or public.is_admin());

-- Position changes are only ever made by the server-side queue functions
-- (SECURITY DEFINER) or by an admin — never by a client-side write, which is
-- what keeps the rotation trustworthy.
drop policy if exists "admin manages queue state" on public.technician_queue_state;
create policy "admin manages queue state"
  on public.technician_queue_state for all
  using (public.is_admin())
  with check (public.is_admin());

-- Renumbers the ACTIVE members of one appliance queue 1..N in their current
-- fair order. Without this, "move to the end" would be
-- `max(position) + 1` forever, so a 3-technician queue would report #4, #7, #10
-- — the order would still be right but the number shown to a technician would
-- not be their actual rank. Inactive (removed) members keep their row and are
-- simply not ranked.
--
-- DEFINED EARLY (section 3) because the membership-sync trigger below calls it,
-- and PL/pgSQL resolves functions at first execution, not at creation.
create or replace function public.compact_queue_positions(p_appliance_type text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_type text := public.normalize_appliance_type(p_appliance_type);
begin
  if v_type is null then
    return;
  end if;

  with ranked as (
    select
      qs.technician_id,
      row_number() over (
        order by coalesce(qs.queue_position, 2147483647) asc,
                 qs.last_assigned_at asc nulls first,
                 qs.technician_id asc
      ) as new_position
    from public.technician_queue_state qs
    where qs.appliance_type = v_type
      and qs.is_active
  )
  update public.technician_queue_state qs
     set queue_position = ranked.new_position,
         updated_at = now()
    from ranked
   where ranked.technician_id = qs.technician_id
     and qs.appliance_type = v_type
     and qs.is_active
     and qs.queue_position is distinct from ranked.new_position;
end;
$$;

-- =========================================================
-- 4. Queue audit trail (technician_queue_events)
-- =========================================================
-- Every fairness-relevant decision is recorded here: who was skipped and why,
-- who was offered what, who accepted (consuming a turn), who declined, which
-- offers expired, and any administrator override. This is what makes "why was
-- technician A skipped for this request?" answerable.
create table if not exists public.technician_queue_events (
  id uuid primary key default uuid_generate_v4(),
  -- Null for request-level events (e.g. nobody was eligible at all).
  technician_id uuid references public.users(id) on delete set null,
  appliance_type text,
  repair_request_id uuid references public.service_requests(id) on delete set null,
  action text not null,
  old_position integer,
  new_position integer,
  reason text,
  -- Who caused it: null = the system, otherwise a user id (admin override).
  actor_id uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

do $event_actions$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'technician_queue_events_action_check'
      and conrelid = 'public.technician_queue_events'::regclass
  ) then
    alter table public.technician_queue_events
      add constraint technician_queue_events_action_check
      check (action in (
        'JOINED_QUEUE', 'TURN_CONSUMED', 'MOVED_TO_END', 'POSITION_CHANGED',
        'SKIPPED_DUE_TO_SCHEDULE', 'SKIPPED_DUE_TO_CAPACITY', 'SKIPPED_DUE_TO_UNAVAILABLE',
        'SKIPPED_DUE_TO_SERVICE_AREA', 'SKIPPED_DUE_TO_ACTIVE_OFFER',
        'OFFERED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'REMOVED', 'REACTIVATED',
        'STATUS_CHANGED', 'WAITING_FOR_TECHNICIAN', 'ADMIN_OVERRIDE'
      ));
  end if;
end
$event_actions$;

create index if not exists idx_queue_events_appliance
  on public.technician_queue_events (appliance_type, created_at desc);
create index if not exists idx_queue_events_technician
  on public.technician_queue_events (technician_id, created_at desc);
create index if not exists idx_queue_events_request
  on public.technician_queue_events (repair_request_id, created_at desc);

alter table public.technician_queue_events enable row level security;

-- A technician may inspect their own queue history; admins see everything.
-- Nobody gets an INSERT policy: events are written exclusively by the
-- SECURITY DEFINER queue functions, so a client cannot fabricate history.
drop policy if exists "technician views own queue events" on public.technician_queue_events;
create policy "technician views own queue events"
  on public.technician_queue_events for select
  using (technician_id = auth.uid() or public.is_admin());

drop policy if exists "admin manages queue events" on public.technician_queue_events;
create policy "admin manages queue events"
  on public.technician_queue_events for all
  using (public.is_admin())
  with check (public.is_admin());

-- =========================================================
-- 5. Availability windows, time off, service areas
-- =========================================================

-- Weekly recurring availability. If a technician has NO rows here, they are
-- treated as available at any time their schedule allows (backward compatible
-- with technicians who never configured windows). As soon as they add windows,
-- a request outside those windows is skipped FOR THAT REQUEST ONLY.
create table if not exists public.technician_availability (
  id uuid primary key default uuid_generate_v4(),
  technician_id uuid not null references public.users(id) on delete cascade,
  -- 0 = Sunday … 6 = Saturday (matches extract(dow) in the service timezone).
  weekday smallint not null check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_time > start_time),
  unique (technician_id, weekday, start_time)
);

create index if not exists idx_technician_availability_technician
  on public.technician_availability (technician_id, weekday);

alter table public.technician_availability enable row level security;

drop policy if exists "technician manages own availability" on public.technician_availability;
create policy "technician manages own availability"
  on public.technician_availability for all
  using (technician_id = auth.uid() or public.is_admin())
  with check (technician_id = auth.uid() or public.is_admin());

-- Concrete time off / temporary unavailability (a day, an afternoon, a week).
create table if not exists public.technician_time_off (
  id uuid primary key default uuid_generate_v4(),
  technician_id uuid not null references public.users(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index if not exists idx_technician_time_off_window
  on public.technician_time_off (technician_id, starts_at, ends_at);

alter table public.technician_time_off enable row level security;

drop policy if exists "technician manages own time off" on public.technician_time_off;
create policy "technician manages own time off"
  on public.technician_time_off for all
  using (technician_id = auth.uid() or public.is_admin())
  with check (technician_id = auth.uid() or public.is_admin());

-- Service areas a technician covers. Optional: with no rows for an appliance
-- type (or with appliance_type = null), the technician covers everywhere.
create table if not exists public.technician_service_areas (
  id uuid primary key default uuid_generate_v4(),
  technician_id uuid not null references public.users(id) on delete cascade,
  -- null = applies to every appliance type they are qualified for.
  appliance_type text,
  area text not null,
  created_at timestamptz not null default now(),
  unique (technician_id, appliance_type, area)
);

create index if not exists idx_technician_service_areas_technician
  on public.technician_service_areas (technician_id);

alter table public.technician_service_areas enable row level security;

drop policy if exists "technician manages own service areas" on public.technician_service_areas;
create policy "technician manages own service areas"
  on public.technician_service_areas for all
  using (technician_id = auth.uid() or public.is_admin())
  with check (technician_id = auth.uid() or public.is_admin());

-- =========================================================
-- 6. Requested service window + booking duration
-- =========================================================
-- The queue can only reason about "is this technician free at the requested
-- time" if the request actually carries the requested time. Until now the
-- wizard collected a preferred date and then dropped it on the floor.
alter table public.service_requests
  add column if not exists requested_window_start timestamptz,
  add column if not exists requested_window_end timestamptz,
  add column if not exists requested_duration_minutes integer;

do $window_constraints$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'service_requests_requested_window_check'
      and conrelid = 'public.service_requests'::regclass
  ) then
    alter table public.service_requests
      add constraint service_requests_requested_window_check
      check (
        requested_window_end is null
        or requested_window_start is null
        or requested_window_end > requested_window_start
      );
  end if;
end
$window_constraints$;

create index if not exists idx_service_requests_requested_window
  on public.service_requests (requested_window_start)
  where requested_window_start is not null;

-- How long an appointment actually occupies the technician. Conflict checks and
-- the daily-hours capacity limit both need a duration: with only `scheduled_at`
-- the system cannot tell "back to back at 10:00" from "a two-hour job that runs
-- into the 11:00 slot".
alter table public.bookings
  add column if not exists duration_minutes integer not null default 120;

create index if not exists idx_bookings_technician_window
  on public.bookings (technician_id, scheduled_at);

-- =========================================================
-- 7. Membership sync + audit event writer
-- =========================================================

-- Single place that writes the audit trail. `actor_id` defaults to the caller
-- (null when the mutation came from the service role / a cron sweep, which is
-- exactly what "the system did it" looks like).
create or replace function public.log_queue_event(
  p_technician_id uuid,
  p_appliance_type text,
  p_request_id uuid,
  p_action text,
  p_old_position integer default null,
  p_new_position integer default null,
  p_reason text default null,
  p_actor_id uuid default null
)
returns void
language sql
security definer set search_path = public
as $$
  insert into public.technician_queue_events (
    technician_id, appliance_type, repair_request_id, action,
    old_position, new_position, reason, actor_id
  ) values (
    p_technician_id,
    public.normalize_appliance_type(p_appliance_type),
    p_request_id,
    p_action,
    p_old_position,
    p_new_position,
    p_reason,
    coalesce(p_actor_id, auth.uid())
  );
$$;

-- Keeps one membership row per (technician, appliance type) in step with the
-- technician's specializations and eligibility. Memberships are never deleted
-- (so the audit trail keeps its context) — they are deactivated instead, and
-- reactivating always rejoins at the END of the queue, which is what keeps the
-- rotation fair for everyone who kept working.
create or replace function public.sync_queue_membership(p_technician_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_type text;
  v_should_be_active boolean;
  v_position integer;
  v_existing record;
  v_touched text[] := '{}';
  i integer;
begin
  select (t.approved and u.is_active and t.operational_status <> 'SUSPENDED')
    into v_should_be_active
  from public.technicians t
  join public.users u on u.id = t.id
  where t.id = p_technician_id;

  if v_should_be_active is null then
    return; -- no technician row to sync
  end if;

  for v_type in
    select distinct public.normalize_appliance_type(s)
    from public.technicians t
    cross join lateral unnest(t.specializations) as s
    where t.id = p_technician_id
      and public.normalize_appliance_type(s) is not null
  loop
    select * into v_existing
    from public.technician_queue_state
    where technician_id = p_technician_id and appliance_type = v_type;

    if v_existing is null then
      select coalesce(max(queue_position), 0) + 1 into v_position
      from public.technician_queue_state
      where appliance_type = v_type;

      insert into public.technician_queue_state (
        technician_id, appliance_type, last_assigned_at,
        queue_position, is_active, turn_count, joined_at, updated_at
      ) values (
        p_technician_id, v_type, null,
        v_position, v_should_be_active, 0, now(), now()
      );

      perform public.log_queue_event(
        p_technician_id, v_type, null, 'JOINED_QUEUE', null, v_position,
        case when v_should_be_active
             then 'Joined the queue for a new specialization'
             else 'Membership created inactive (technician cannot be assigned yet)'
        end
      );
    elsif v_existing.is_active is distinct from v_should_be_active then
      if v_should_be_active then
        select coalesce(max(queue_position), 0) + 1 into v_position
        from public.technician_queue_state
        where appliance_type = v_type;

        update public.technician_queue_state
           set is_active = true, queue_position = v_position, joined_at = now(), updated_at = now()
         where technician_id = p_technician_id and appliance_type = v_type;

        perform public.log_queue_event(
          p_technician_id, v_type, null, 'REACTIVATED',
          v_existing.queue_position, v_position, 'Returned to the rotation at the end of the queue'
        );
      else
        update public.technician_queue_state
           set is_active = false, updated_at = now()
         where technician_id = p_technician_id and appliance_type = v_type;

        perform public.log_queue_event(
          p_technician_id, v_type, null, 'REMOVED',
          v_existing.queue_position, v_existing.queue_position,
          'Left the rotation (account inactive, unapproved or suspended)'
        );
      end if;
    elsif v_existing.queue_position is null or v_existing.queue_position < 1 then
      select coalesce(max(queue_position), 0) + 1 into v_position
      from public.technician_queue_state
      where appliance_type = v_type;

      update public.technician_queue_state
         set queue_position = v_position, updated_at = now()
       where technician_id = p_technician_id and appliance_type = v_type;

      perform public.log_queue_event(
        p_technician_id, v_type, null, 'POSITION_CHANGED',
        v_existing.queue_position, v_position, 'Position assigned during migration'
      );
    end if;

    v_touched := v_touched || v_type;
  end loop;


  -- Specializations that were removed: leave the queue, keep the audit trail.
  for v_existing in
    select * from public.technician_queue_state qs
    where qs.technician_id = p_technician_id
      and qs.is_active
      and not exists (
        select 1
        from public.technicians t
        cross join lateral unnest(t.specializations) as s
        where t.id = p_technician_id
          and public.normalize_appliance_type(s) = qs.appliance_type
      )
  loop
    update public.technician_queue_state
       set is_active = false, updated_at = now()
     where technician_id = p_technician_id and appliance_type = v_existing.appliance_type;

    perform public.log_queue_event(
      p_technician_id, v_existing.appliance_type, null, 'REMOVED',
      v_existing.queue_position, v_existing.queue_position, 'Specialization removed'
    );

    v_touched := v_touched || v_existing.appliance_type;
  end loop;

  -- Keep the numbers readable: renumber each touched queue 1..N.
  for i in 1 .. coalesce(array_length(v_touched, 1), 0) loop
    perform public.compact_queue_positions(v_touched[i]);
  end loop;
end;
$$;

-- Membership stays in step with specializations, approval, account status and
-- suspension automatically — no cron and no client can forget to do it.
create or replace function public.sync_queue_membership_trigger()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  perform public.sync_queue_membership(new.id);
  return new;
end;
$$;

drop trigger if exists trg_sync_queue_membership on public.technicians;
create trigger trg_sync_queue_membership
  after insert or update of specializations, approved, operational_status
  on public.technicians
  for each row execute procedure public.sync_queue_membership_trigger();

-- Also sync when an account is reactivated/deactivated.
create or replace function public.sync_queue_membership_user_trigger()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.role = 'technician' or old.role = 'technician' then
    perform public.sync_queue_membership(new.id);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_sync_queue_membership_user on public.users;
create trigger trg_sync_queue_membership_user
  after update of is_active, role
  on public.users
  for each row execute procedure public.sync_queue_membership_user_trigger();

-- Sync every approved technician's memberships for one appliance type. Called
-- by the assignment engine before it walks the queue, so a technician who was
-- just approved or specialized is pickable immediately.
create or replace function public.sync_appliance_queue_memberships(p_appliance_type text)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  v_type text := public.normalize_appliance_type(p_appliance_type);
  rec record;
begin
  if v_type is null then
    return;
  end if;

  for rec in
    select t.id
    from public.technicians t
    join public.users u on u.id = t.id
    where t.approved and u.is_active
      and exists (
        select 1 from unnest(t.specializations) s
        where public.normalize_appliance_type(s) = v_type
      )
  loop
    perform public.sync_queue_membership(rec.id);
  end loop;
end;
$$;

-- One-off: put every existing technician into the rotation for whatever they
-- specialize in. Idempotent — running it twice changes nothing.
do $backfill$
declare
  rec record;
begin
  for rec in select id from public.technicians loop
    perform public.sync_queue_membership(rec.id);
  end loop;
end
$backfill$;

-- =========================================================
-- 8. Operational status (separate from queue membership)
-- =========================================================

-- Computed from real schedule data, never stored as the source of truth.
-- SCHEDULED means "has a future appointment" — it does NOT mean unavailable.
create or replace function public.compute_technician_status(p_technician_id uuid)
returns text
language plpgsql
stable
security definer set search_path = public
as $$
declare
  v_now timestamptz := now();
begin
  if not exists (
    select 1 from public.users u where u.id = p_technician_id and u.is_active
  ) then
    return 'OFFLINE';
  end if;

  if not exists (
    select 1 from public.technicians t where t.id = p_technician_id and t.approved
  ) or exists (
    select 1 from public.technicians t
    where t.id = p_technician_id and t.operational_status = 'SUSPENDED'
  ) then
    return 'SUSPENDED';
  end if;

  if exists (
    select 1 from public.bookings b
    where b.technician_id = p_technician_id and b.status::text = 'in_progress'
  ) then
    return 'ON_JOB';
  end if;

  if exists (
    select 1 from public.technician_time_off t
    where t.technician_id = p_technician_id
      and t.starts_at <= v_now and t.ends_at > v_now
  ) then
    return 'TEMPORARILY_UNAVAILABLE';
  end if;

  if exists (
    select 1 from public.technicians t
    where t.id = p_technician_id and t.availability = false
  ) then
    return 'TEMPORARILY_UNAVAILABLE';
  end if;

  if exists (
    select 1 from public.bookings b
    where b.technician_id = p_technician_id
      and b.status::text in ('pending', 'awaiting_inspection')
      and b.scheduled_at > v_now
  ) then
    return 'SCHEDULED';
  end if;

  return 'AVAILABLE';
end;
$$;

-- Caches the computed status onto technicians.operational_status so the admin
-- lists and the queue snapshot are one cheap read, and writes a STATUS_CHANGED
-- audit event whenever it actually flips.
create or replace function public.refresh_technician_operational_status(p_technician_id uuid)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  v_status text;
  v_previous text;
begin
  v_status := public.compute_technician_status(p_technician_id);

  select operational_status into v_previous
  from public.technicians where id = p_technician_id;

  if v_previous is distinct from v_status then
    update public.technicians
       set operational_status = v_status, status_updated_at = now()
     where id = p_technician_id;

    perform public.log_queue_event(
      p_technician_id, null, null, 'STATUS_CHANGED', null, null,
      'Operational status: ' || coalesce(v_previous, 'unknown') || ' -> ' || v_status
    );
  end if;

  return v_status;
end;
$$;

-- =========================================================
-- 9. Schedule, availability windows, capacity, service area
-- =========================================================
-- Everything below answers "could this technician do THIS request?" — and
-- nothing here ever changes a queue position.

-- Overlap against real appointments and time off. NULL window (customer did not
-- pick a time) means "no conflict to prove", not "unavailable".
create or replace function public.technician_schedule_conflict(
  p_technician_id uuid,
  p_start timestamptz,
  p_end timestamptz
)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select case
    when p_start is null or p_end is null then false
    else
      exists (
        select 1 from public.bookings b
        where b.technician_id = p_technician_id
          and b.status::text in ('pending', 'in_progress', 'awaiting_inspection')
          and b.scheduled_at < p_end
          and b.scheduled_at
              + make_interval(mins => greatest(coalesce(b.duration_minutes, 120), 1)) > p_start
      )
      or exists (
        select 1 from public.technician_time_off t
        where t.technician_id = p_technician_id
          and t.starts_at < p_end
          and t.ends_at > p_start
      )
  end;
$$;

-- Weekly availability windows. No configured windows -> always inside them
-- (technicians who never set a schedule keep working exactly as before).
create or replace function public.technician_within_availability(
  p_technician_id uuid,
  p_start timestamptz,
  p_end timestamptz
)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select case
    when p_start is null or p_end is null then true
    when not exists (
      select 1 from public.technician_availability a
      where a.technician_id = p_technician_id and a.is_active
    ) then true
    else exists (
      select 1 from public.technician_availability a
      where a.technician_id = p_technician_id
        and a.is_active
        and a.weekday = extract(dow from (p_start at time zone public.service_timezone()))::integer
        and a.start_time <= (p_start at time zone public.service_timezone())::time
        and a.end_time >= (p_end at time zone public.service_timezone())::time
    )
  end;
$$;

-- Workload limits. Time-based where it matters: the daily hours check adds the
-- requested duration to the hours already committed that day.
create or replace function public.technician_capacity_failure(
  p_technician_id uuid,
  p_start timestamptz,
  p_end timestamptz
)
returns text
language plpgsql
stable
security definer set search_path = public
as $$
declare
  v_tz text := public.service_timezone();
  v_max_hours numeric;
  v_max_jobs integer;
  v_max_concurrent integer;
  v_active integer;
  v_jobs integer;
  v_minutes integer;
  v_booked_minutes integer;
  v_day_start timestamptz;
  v_day_end timestamptz;
begin
  select t.max_daily_hours, t.max_jobs_per_day, t.max_concurrent_jobs
    into v_max_hours, v_max_jobs, v_max_concurrent
  from public.technicians t where t.id = p_technician_id;

  if v_max_concurrent is not null and v_max_concurrent > 0 then
    select count(*) into v_active
    from public.bookings b
    where b.technician_id = p_technician_id and b.status::text = 'in_progress';

    if v_active >= v_max_concurrent then
      return 'capacity_concurrent_job';
    end if;
  end if;

  if p_start is null or p_end is null then
    return null; -- no requested time: only the concurrent-jobs limit applies
  end if;

  v_minutes := greatest(1, round(extract(epoch from (p_end - p_start)) / 60)::integer);
  v_day_start := date_trunc('day', p_start at time zone v_tz) at time zone v_tz;
  v_day_end := v_day_start + interval '1 day';

  if v_max_jobs is not null and v_max_jobs > 0 then
    select count(*) into v_jobs
    from public.bookings b
    where b.technician_id = p_technician_id
      and b.status::text <> 'cancelled'
      and b.scheduled_at >= v_day_start
      and b.scheduled_at < v_day_end;

    if v_jobs >= v_max_jobs then
      return 'capacity_daily_jobs';
    end if;
  end if;

  if v_max_hours is not null and v_max_hours > 0 then
    select coalesce(sum(greatest(coalesce(b.duration_minutes, 120), 1)), 0) into v_booked_minutes
    from public.bookings b
    where b.technician_id = p_technician_id
      and b.status::text <> 'cancelled'
      and b.scheduled_at >= v_day_start
      and b.scheduled_at < v_day_end;

    if (v_booked_minutes + v_minutes) > (v_max_hours * 60) then
      return 'capacity_daily_hours';
    end if;
  end if;

  return null;
end;
$$;

-- Service-area coverage. A technician with no configured areas covers
-- everywhere (so enabling this later cannot silently empty a queue).
create or replace function public.technician_covers_area(
  p_technician_id uuid,
  p_appliance_type text,
  p_location text
)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select case
    when p_location is null or btrim(p_location) = '' then true
    when not exists (
      select 1 from public.technician_service_areas a
      where a.technician_id = p_technician_id
        and (
          a.appliance_type is null
          or public.normalize_appliance_type(a.appliance_type) = public.normalize_appliance_type(p_appliance_type)
        )
    ) then true
    else exists (
      select 1 from public.technician_service_areas a
      where a.technician_id = p_technician_id
        and (
          a.appliance_type is null
          or public.normalize_appliance_type(a.appliance_type) = public.normalize_appliance_type(p_appliance_type)
        )
        and btrim(a.area) <> ''
        and lower(p_location) like '%' || lower(btrim(a.area)) || '%'
    )
  end;
$$;

-- THE eligibility gate for one request. Returns NULL when the technician can
-- take it, otherwise a machine-readable reason. Nothing in here mutates state.
create or replace function public.technician_eligibility_failure(
  p_technician_id uuid,
  p_appliance_type text,
  p_location text,
  p_start timestamptz,
  p_end timestamptz,
  p_request_id uuid default null
)
returns text
language plpgsql
stable
security definer set search_path = public
as $$
declare
  v_type text := public.normalize_appliance_type(p_appliance_type);
  v_capacity text;
begin
  -- 1. Account / approval / suspension
  if not exists (
    select 1 from public.users u where u.id = p_technician_id and u.is_active
  ) then
    return 'not_available';
  end if;

  if not exists (
    select 1 from public.technicians t where t.id = p_technician_id and t.approved
  ) then
    return 'not_available';
  end if;

  if exists (
    select 1 from public.technicians t
    where t.id = p_technician_id and t.operational_status = 'SUSPENDED'
  ) then
    return 'suspended';
  end if;

  -- 2. Queue membership for this appliance type (which mirrors specialization)
  if not exists (
    select 1 from public.technician_queue_state qs
    where qs.technician_id = p_technician_id
      and qs.appliance_type = v_type
      and qs.is_active
  ) then
    return 'not_in_queue';
  end if;

  -- 3. One live offer per technician — but this only skips them for the OTHER
  -- request; it is not a queue exit.
  if p_request_id is not null and exists (
    select 1 from public.service_requests r
    where r.assigned_technician_id = p_technician_id
      and r.assignment_status = 'offered'
      and r.id <> p_request_id
  ) then
    return 'holding_offer';
  end if;

  -- 4. Service area
  if not public.technician_covers_area(p_technician_id, v_type, p_location) then
    return 'service_area';
  end if;

  -- 5. Availability at the requested time
  if exists (
    select 1 from public.technicians t
    where t.id = p_technician_id and t.availability = false
  ) then
    return 'temporarily_unavailable';
  end if;

  if p_start is not null and p_end is not null then
    if not public.technician_within_availability(p_technician_id, p_start, p_end) then
      return 'outside_availability_window';
    end if;

    if public.technician_schedule_conflict(p_technician_id, p_start, p_end) then
      return 'schedule_conflict';
    end if;
  end if;

  -- 6. Capacity
  v_capacity := public.technician_capacity_failure(p_technician_id, p_start, p_end);
  if v_capacity is not null then
    return v_capacity;
  end if;

  return null;
end;
$$;

-- Machine reason -> audit action. Keeps technician_queue_events.action inside
-- the documented vocabulary while the reason stays specific.
create or replace function public.queue_event_action_for_reason(p_reason text)
returns text
language sql
immutable
as $$
  select case
    when p_reason = 'schedule_conflict' then 'SKIPPED_DUE_TO_SCHEDULE'
    when p_reason like 'capacity%' then 'SKIPPED_DUE_TO_CAPACITY'
    when p_reason = 'service_area' then 'SKIPPED_DUE_TO_SERVICE_AREA'
    when p_reason = 'holding_offer' then 'SKIPPED_DUE_TO_ACTIVE_OFFER'
    else 'SKIPPED_DUE_TO_UNAVAILABLE'
  end;
$$;

-- Human-readable reason, used by the admin queue monitor.
create or replace function public.queue_reason_message(p_reason text)
returns text
language sql
immutable
as $$
  select case p_reason
    when 'not_available' then 'Not eligible: account inactive or technician not approved'
    when 'suspended' then 'Not eligible: suspended'
    when 'not_in_queue' then 'Not in this appliance queue'
    when 'holding_offer' then 'Already holding another active offer'
    when 'service_area' then 'Request location is outside the covered service area'
    when 'temporarily_unavailable' then 'Temporarily unavailable'
    when 'outside_availability_window' then 'Requested time is outside the technician''s availability windows'
    when 'schedule_conflict' then 'Schedule conflict: already booked during the requested window'
    when 'capacity_concurrent_job' then 'Capacity: maximum simultaneous jobs reached'
    when 'capacity_daily_jobs' then 'Capacity: maximum jobs per day reached'
    when 'capacity_daily_hours' then 'Capacity: maximum working hours per day reached'
    else 'Skipped'
  end;
$$;

-- =========================================================
-- 10. Consume a queue turn (the only thing that moves a position)
-- =========================================================

-- Renumbers 1..N with the accepting technician last (see section 3 for the
-- definition); also called by the membership sync and the admin override.
--
-- Called when a technician ACCEPTS an offer (and by the admin override). The
-- technician is moved to the end of that appliance queue; everyone else keeps
-- their position. Serialized with an advisory lock per appliance type so two
-- concurrent acceptances cannot land on the same position.

create or replace function public.consume_queue_turn(
  p_technician_id uuid,
  p_appliance_type text,
  p_request_id uuid default null,
  p_reason text default null
)
returns integer
language plpgsql
security definer set search_path = public
as $$
declare
  v_type text := public.normalize_appliance_type(p_appliance_type);
  v_old integer;
  v_new integer;
  v_turn integer;
begin
  if v_type is null then
    raise exception 'consume_queue_turn: appliance type is required';
  end if;

  -- Serialize rotations for this queue.
  perform pg_advisory_xact_lock(hashtext('sparkserv-queue:' || v_type));

  select queue_position, turn_count into v_old, v_turn
  from public.technician_queue_state
  where technician_id = p_technician_id and appliance_type = v_type;

  if v_old is null and v_turn is null then
    raise exception 'consume_queue_turn: technician % is not part of the % queue',
      p_technician_id, v_type;
  end if;

  select coalesce(max(queue_position), 0) + 1 into v_new
  from public.technician_queue_state
  where appliance_type = v_type;

  insert into public.technician_queue_state (
    technician_id, appliance_type, last_assigned_at,
    queue_position, is_active, turn_count, joined_at, updated_at
  ) values (
    p_technician_id, v_type, now(),
    v_new, true, 1, now(), now()
  )
  on conflict (technician_id, appliance_type) do update
    set last_assigned_at = now(),
        queue_position = v_new,
        is_active = true,
        turn_count = public.technician_queue_state.turn_count + 1,
        updated_at = now();

  -- Renumber 1..N with the accepting technician last, so the stored position is
  -- a real rank rather than an ever-growing counter.
  perform public.compact_queue_positions(v_type);

  select queue_position into v_new
  from public.technician_queue_state
  where technician_id = p_technician_id and appliance_type = v_type;

  perform public.log_queue_event(
    p_technician_id, v_type, p_request_id, 'TURN_CONSUMED',
    v_old, v_new, coalesce(p_reason, 'Queue turn consumed'), null
  );

  perform public.log_queue_event(
    p_technician_id, v_type, p_request_id, 'MOVED_TO_END',
    v_old, v_new, 'Moved to the end of the rotation after accepting', null
  );

  perform public.refresh_technician_operational_status(p_technician_id);

  return v_new;
end;
$$;

-- =========================================================
-- 11. Assignment engine (queue walk)
-- =========================================================
-- Walks the appliance queue in fair order and offers the request to the first
-- technician who is ELIGIBLE for it and AVAILABLE at the requested time with
-- spare CAPACITY. Skipped technicians keep their queue position — the only
-- thing that writes a new position is consume_queue_turn() on acceptance.
--
-- Concurrency: the request row is locked FOR UPDATE, so two simultaneous
-- assignments of the same request cannot both create an offer; the partial
-- unique index uniq_active_offer_per_technician turns "two requests offered to
-- one technician" into a unique_violation that this loop simply skips past.
create or replace function public.assign_technician_to_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  r public.service_requests%rowtype;
  v_type text;
  v_start timestamptz;
  v_end timestamptz;
  v_ttl integer;
  v_reason text;
  v_conflict boolean;
  v_claimed public.service_requests%rowtype;
  v_skipped text[] := '{}';
  cand record;
begin
  select * into r from public.service_requests where id = p_request_id for update;

  if r.id is null then
    raise exception 'assign_technician_to_request: request % not found', p_request_id;
  end if;

  -- Someone already offered/accepted it (concurrent call) — do not interfere.
  if r.assignment_status not in ('matching', 'waiting') then
    return jsonb_build_object(
      'outcome', 'unchanged',
      'request_id', r.id,
      'assignment_status', r.assignment_status,
      'assigned_technician_id', r.assigned_technician_id,
      'offers_expires_at', r.offers_expires_at
    );
  end if;

  v_type := public.normalize_appliance_type(r.appliance_type);
  v_start := r.requested_window_start;
  v_end := coalesce(
    r.requested_window_end,
    case when r.requested_window_start is not null
         then r.requested_window_start + make_interval(mins => coalesce(r.requested_duration_minutes, 120))
    end
  );
  v_ttl := greatest(1, public.queue_setting_int('queue_offer_ttl_minutes', 15));

  perform public.sync_appliance_queue_memberships(v_type);

  for cand in
    select qs.technician_id, qs.queue_position
    from public.technician_queue_state qs
    join public.technicians t on t.id = qs.technician_id
    join public.users u on u.id = t.id
    where qs.appliance_type = v_type
      and qs.is_active
      and t.approved
      and u.is_active
      and not exists (
        select 1 from public.technician_offer_history h
        where h.service_request_id = r.id and h.technician_id = qs.technician_id
      )
    order by coalesce(qs.queue_position, 2147483647) asc,
             qs.last_assigned_at asc nulls first,
             u.name asc
  loop
    v_reason := public.technician_eligibility_failure(
      cand.technician_id, v_type, r.location, v_start, v_end, r.id
    );

    if v_reason is not null then
      v_skipped := v_skipped || (cand.technician_id::text || '=' || v_reason);

      perform public.log_queue_event(
        cand.technician_id, v_type, r.id,
        public.queue_event_action_for_reason(v_reason),
        cand.queue_position, cand.queue_position,
        public.queue_reason_message(v_reason), null
      );

      continue; -- position untouched: a skip is not an exit
    end if;

    -- Claim the request for this technician. The partial unique index
    -- uniq_active_offer_per_technician raises unique_violation when they are
    -- already holding a live offer for a different request; the flag keeps that
    -- decision outside the exception handler.
    v_conflict := false;
    v_claimed := null;

    begin
      update public.service_requests
         set assigned_technician_id = cand.technician_id,
             assignment_status = 'offered',
             offers_expires_at = now() + make_interval(mins => v_ttl),
             updated_at = now()
       where id = r.id
         and assignment_status in ('matching', 'waiting')
      returning * into v_claimed;
    exception when unique_violation then
      v_conflict := true;
    end;

    if v_conflict then
      v_skipped := v_skipped || (cand.technician_id::text || '=holding_offer');

      perform public.log_queue_event(
        cand.technician_id, v_type, r.id, 'SKIPPED_DUE_TO_ACTIVE_OFFER',
        cand.queue_position, cand.queue_position,
        public.queue_reason_message('holding_offer'), null
      );

      continue;
    end if;

    if v_claimed.id is null then
      -- Lost the race: another caller moved this request on.
      return jsonb_build_object(
        'outcome', 'unchanged',
        'request_id', r.id,
        'assignment_status', r.assignment_status
      );
    end if;

    insert into public.technician_offer_history (service_request_id, technician_id, status)
    values (r.id, cand.technician_id, 'offered');

    perform public.log_queue_event(
      cand.technician_id, v_type, r.id, 'OFFERED',
      cand.queue_position, cand.queue_position,
      'Offer sent; expires at ' || to_char(v_claimed.offers_expires_at, 'YYYY-MM-DD HH24:MI'),
      null
    );

    perform public.refresh_technician_operational_status(cand.technician_id);

    return jsonb_build_object(
      'outcome', 'offered',
      'request_id', r.id,
      'assigned_technician_id', cand.technician_id,
      'assignment_status', 'offered',
      'offers_expires_at', v_claimed.offers_expires_at,
      'queue_position', cand.queue_position,
      'skipped', to_jsonb(v_skipped)
    );
  end loop;

  -- Nobody in the queue could take it right now. The request WAITS; it is not
  -- rejected, and nobody lost their place.
  update public.service_requests
     set assigned_technician_id = null,
         assignment_status = 'waiting',
         offers_expires_at = null,
         updated_at = now()
   where id = r.id
     and assignment_status in ('matching', 'waiting');

  perform public.log_queue_event(
    null, v_type, r.id, 'WAITING_FOR_TECHNICIAN', null, null,
    case when array_length(v_skipped, 1) is null
         then 'No eligible technician in this queue'
         else 'Every eligible technician was skipped: ' || array_to_string(v_skipped, ', ')
    end,
    null
  );

  return jsonb_build_object(
    'outcome', 'waiting',
    'request_id', r.id,
    'assignment_status', 'waiting',
    'assigned_technician_id', null,
    'skipped', to_jsonb(v_skipped)
  );

end;
$$;

-- =========================================================
-- 12. Offer response (accept / decline) — a single transaction
-- =========================================================

-- Accepting consumes the technician's queue turn (they move to the end of that
-- appliance queue) and confirms the assignment. Declining records the reason
-- and immediately offers the request to the next eligible person.
--
-- Everything happens under one lock on the request row, which is what makes
-- "two technicians accept the same job" impossible: the second call sees
-- assignment_status <> 'offered' and gets outcome = 'not_offered'.
create or replace function public.respond_to_offer(
  p_request_id uuid,
  p_technician_id uuid,
  p_action text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  r public.service_requests%rowtype;
  v_type text;
  v_position integer;
  v_next jsonb;
  v_decline_consumes boolean;
begin
  if p_action not in ('accept', 'decline') then
    raise exception 'respond_to_offer: p_action must be accept or decline';
  end if;

  if v_caller is not null and v_caller <> p_technician_id and not public.is_admin() then
    raise exception 'respond_to_offer: not allowed to respond for another technician';
  end if;

  select * into r from public.service_requests where id = p_request_id for update;

  if r.id is null then
    raise exception 'respond_to_offer: request % not found', p_request_id;
  end if;

  v_type := public.normalize_appliance_type(r.appliance_type);

  if r.assignment_status <> 'offered' or r.assigned_technician_id is distinct from p_technician_id then
    return jsonb_build_object(
      'outcome', 'not_offered',
      'request_id', r.id,
      'assignment_status', r.assignment_status,
      'assigned_technician_id', r.assigned_technician_id
    );
  end if;

  -- Responding after the TTL is a no-op for the technician: the offer expired.
  if r.offers_expires_at is not null and r.offers_expires_at <= now() then
    update public.technician_offer_history
       set status = 'rejected', reason = coalesce(reason, 'Offer expired')
     where service_request_id = r.id and technician_id = p_technician_id and status = 'offered';

    perform public.log_queue_event(
      p_technician_id, v_type, r.id, 'EXPIRED', null, null,
      'Offer expired before a response was received', null
    );

    update public.service_requests
       set assigned_technician_id = null,
           assignment_status = 'matching',
           offers_expires_at = null,
           updated_at = now()
     where id = r.id;

    v_next := public.assign_technician_to_request(r.id);

    return jsonb_build_object(
      'outcome', 'expired',
      'request_id', r.id,
      'reassignment', v_next
    );
  end if;

  if p_action = 'accept' then
    update public.service_requests
       set assignment_status = 'accepted',
           status = case when status = 'open' then 'quoted'::public.request_status else status end,
           offers_expires_at = null,
           updated_at = now()
     where id = r.id;

    update public.technician_offer_history
       set status = 'accepted'
     where service_request_id = r.id
       and technician_id = p_technician_id
       and status = 'offered';

    -- The turn is consumed HERE — not when the job completes.
    v_position := public.consume_queue_turn(
      p_technician_id, v_type, r.id, 'Accepted a repair request'
    );

    perform public.log_queue_event(
      p_technician_id, v_type, r.id, 'ACCEPTED', v_position, v_position,
      'Assignment confirmed; queue turn consumed', null
    );

    return jsonb_build_object(
      'outcome', 'accepted',
      'request_id', r.id,
      'appliance_type', v_type,
      'assigned_technician_id', p_technician_id,
      'assignment_status', 'accepted',
      'queue_position', v_position
    );
  end if;

  -- decline
  update public.technician_offer_history
     set status = 'rejected', reason = coalesce(p_reason, 'Declined by technician')
   where service_request_id = r.id
     and technician_id = p_technician_id
     and status = 'offered';

  perform public.log_queue_event(
    p_technician_id, v_type, r.id, 'DECLINED', null, null,
    coalesce(p_reason, 'Declined the offer'), null
  );

  -- Configurable policy (default: a declined offer does NOT cost queue
  -- position — the rotation rewards work taken, not offers turned down).
  v_decline_consumes := public.queue_setting_bool('queue_decline_consumes_turn', false);
  if v_decline_consumes then
    perform public.consume_queue_turn(
      p_technician_id, v_type, r.id, 'Declined offer (policy: decline consumes turn)'
    );
  end if;

  update public.service_requests
     set assigned_technician_id = null,
         assignment_status = 'matching',
         offers_expires_at = null,
         updated_at = now()
   where id = r.id;

  v_next := public.assign_technician_to_request(r.id);

  return jsonb_build_object(
    'outcome', 'declined',
    'request_id', r.id,
    'decline_consumed_turn', v_decline_consumes,
    'reassignment', v_next
  );
end;
$$;

-- =========================================================
-- 13. Offer expiry sweep + audited admin override
-- =========================================================

-- Lapses every offer past its TTL and immediately re-offers the request to the
-- next eligible person. Driven by /api/cron/assignment-tick, and safe to call
-- at any time (the per-request lock makes concurrent sweeps harmless).
-- Returns the lapsed offers so the caller can notify those technicians.
create or replace function public.expire_stale_offers()
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  rec record;
  v_type text;
  v_count integer := 0;
  v_expired jsonb := '[]'::jsonb;
begin
  for rec in
    select * from public.service_requests
    where assignment_status = 'offered'
      and offers_expires_at is not null
      and offers_expires_at <= now()
    order by created_at
    for update
  loop
    v_count := v_count + 1;
    v_type := public.normalize_appliance_type(rec.appliance_type);

    update public.technician_offer_history
       set status = 'rejected', reason = coalesce(reason, 'Offer expired')
     where service_request_id = rec.id and status = 'offered';

    perform public.log_queue_event(
      rec.assigned_technician_id, v_type, rec.id, 'EXPIRED', null, null,
      'Offer expired without a response; passed to the next technician', null
    );

    update public.service_requests
       set assigned_technician_id = null,
           assignment_status = 'matching',
           offers_expires_at = null,
           updated_at = now()
     where id = rec.id;

    perform public.assign_technician_to_request(rec.id);

    v_expired := v_expired || jsonb_build_object(
      'request_id', rec.id,
      'technician_id', rec.assigned_technician_id,
      'appliance_type', v_type
    );
  end loop;

  return jsonb_build_object('count', v_count, 'expired', v_expired);
end;
$$;

-- Documented administrative override. Requires an explicit reason; every action
-- is written to the audit trail with the acting administrator recorded, so a
-- manual queue change can always be traced and justified.
create or replace function public.admin_queue_override(
  p_appliance_type text,
  p_technician_id uuid,
  p_action text,
  p_reason text
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v_type text := public.normalize_appliance_type(p_appliance_type);
  v_actor uuid := auth.uid();
  v_position integer;
begin
  if not public.is_admin() then
    raise exception 'admin_queue_override: administrator access required';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'admin_queue_override: a reason is required for every override';
  end if;

  perform public.sync_queue_membership(p_technician_id);

  if p_action = 'move_to_end' then
    v_position := public.consume_queue_turn(
      p_technician_id, v_type, null, 'Admin override: ' || btrim(p_reason)
    );
  elsif p_action = 'remove' then
    update public.technician_queue_state
       set is_active = false, updated_at = now()
     where technician_id = p_technician_id and appliance_type = v_type
     returning queue_position into v_position;

    if v_position is null then
      raise exception 'admin_queue_override: technician % is not in the % queue',
        p_technician_id, v_type;
    end if;

    perform public.log_queue_event(
      p_technician_id, v_type, null, 'REMOVED', v_position, v_position,
      'Admin override: ' || btrim(p_reason), v_actor
    );

    perform public.compact_queue_positions(v_type);
  elsif p_action = 'reactivate' then
    perform public.sync_queue_membership(p_technician_id);

    select coalesce(max(queue_position), 0) + 1 into v_position
    from public.technician_queue_state
    where appliance_type = v_type and technician_id <> p_technician_id;

    update public.technician_queue_state
       set is_active = true, queue_position = v_position, joined_at = now(), updated_at = now()
     where technician_id = p_technician_id and appliance_type = v_type;

    if not found then
      raise exception 'admin_queue_override: technician % is not in the % queue',
        p_technician_id, v_type;
    end if;

    perform public.log_queue_event(
      p_technician_id, v_type, null, 'REACTIVATED', null, v_position,
      'Admin override: ' || btrim(p_reason), v_actor
    );

    perform public.compact_queue_positions(v_type);
  else
    raise exception 'admin_queue_override: unknown action % (expected move_to_end, remove or reactivate)', p_action;
  end if;

  perform public.log_queue_event(
    p_technician_id, v_type, null, 'ADMIN_OVERRIDE', null, v_position,
    btrim(p_reason), v_actor
  );

  return jsonb_build_object(
    'ok', true,
    'action', p_action,
    'technician_id', p_technician_id,
    'appliance_type', v_type,
    'queue_position', v_position,
    'actor_id', v_actor
  );
end;
$$;

-- =========================================================
-- 14. Queue snapshot — the full queue as a technician (or admin) may see it
-- =========================================================
-- This is the fix for "the technician only sees themselves": the old SELECT
-- policy on technician_queue_state restricted rows to `technician_id =
-- auth.uid()`, so no screen could ever show the rest of the queue. This
-- function returns the WHOLE queue for an appliance type, with only the fields
-- a technician is allowed to see:
--   position, technician name, operational status, next booking time, self flag.
-- It deliberately does NOT expose phone numbers, addresses, customer details,
-- documents or account data, and it refuses customers outright.
--
-- p_appliance_type = null returns every queue the caller belongs to
-- ("All my queues"); admins may ask for any queue and see active offers too.
create or replace function public.technician_queue_snapshot(p_appliance_type text default null)
returns table (
  appliance_type text,
  queue_position integer,
  technician_id uuid,
  technician_name text,
  operational_status text,
  is_self boolean,
  is_member_active boolean,
  is_next_in_queue boolean,
  queue_status text,
  next_booking_at timestamptz,
  current_job_until timestamptz,
  active_offer_request_id uuid,
  offers_expires_at timestamptz
)
language plpgsql
stable
security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_role public.user_role := public.current_role();
  v_type text := public.normalize_appliance_type(p_appliance_type);
begin
  -- `v_role is null` matters: without it, a caller with no JWT at all (e.g. a
  -- bare service-role/PostgREST call) evaluates `null not in (...)` as NULL and
  -- slips past the guard. Refuse anything that is not an authenticated
  -- technician or administrator.
  if v_role is null or v_role::text not in ('technician', 'admin', 'super_admin') then
    -- Customers never see the technician queue — only their own request status.
    raise exception 'technician_queue_snapshot: only technicians and administrators can view the queue';
  end if;

  return query
  select
    qs.appliance_type,
    qs.queue_position,
    t.id,
    u.name,
    public.compute_technician_status(t.id) as operational_status,
    (t.id = v_uid) as is_self,
    qs.is_active,
    (
      qs.is_active
      and qs.queue_position = (
        select min(x.queue_position)
        from public.technician_queue_state x
        where x.appliance_type = qs.appliance_type and x.is_active
      )
    ) as is_next_in_queue,
    case
      when not qs.is_active then 'TEMPORARILY_REMOVED'
      when qs.queue_position = (
        select min(x.queue_position)
        from public.technician_queue_state x
        where x.appliance_type = qs.appliance_type and x.is_active
      ) then 'NEXT_TURN'
      else 'IN_ROTATION'
    end as queue_status,
    (
      select min(b.scheduled_at)
      from public.bookings b
      where b.technician_id = t.id
        and b.status::text in ('pending', 'in_progress', 'awaiting_inspection')
        and b.scheduled_at >= now()
    ) as next_booking_at,
    (
      select max(
        b.scheduled_at + make_interval(mins => greatest(coalesce(b.duration_minutes, 120), 1))
      )
      from public.bookings b
      where b.technician_id = t.id and b.status::text = 'in_progress'
    ) as current_job_until,
    case
      when t.id = v_uid or public.is_admin() then (
        select r.id from public.service_requests r
        where r.assigned_technician_id = t.id and r.assignment_status = 'offered'
        limit 1
      )
      else null
    end as active_offer_request_id,
    case
      when t.id = v_uid or public.is_admin() then (
        select r.offers_expires_at from public.service_requests r
        where r.assigned_technician_id = t.id and r.assignment_status = 'offered'
        limit 1
      )
      else null
    end as offers_expires_at
  from public.technician_queue_state qs
  join public.technicians t on t.id = qs.technician_id
  join public.users u on u.id = t.id
  where (v_type is null or qs.appliance_type = v_type)
    and t.approved
    and u.is_active
    and (
      public.is_admin()
      -- A technician sees the queues they are a member of. Written as an
      -- explicit EXISTS with a NULL guard so a caller without a JWT cannot
      -- match anything (SQL NULL in a boolean predicate is not false).
      or (
        v_uid is not null
        and exists (
          select 1
          from public.technician_queue_state my
          where my.technician_id = v_uid
            and my.appliance_type = qs.appliance_type
        )
      )
    )
  order by qs.appliance_type asc,
           qs.is_active desc,
           coalesce(qs.queue_position, 2147483647) asc,
           qs.last_assigned_at asc nulls first,
           u.name asc;
end;
$$;

-- =========================================================
-- 15. Privileges — who may call what
-- =========================================================
-- Table privileges (RLS still filters rows on top of these grants).
grant select on public.technician_queue_state to authenticated;
grant select on public.technician_queue_events to authenticated;
grant insert, update, delete on public.technician_availability to authenticated;
grant insert, update, delete on public.technician_time_off to authenticated;
grant insert, update, delete on public.technician_service_areas to authenticated;
grant all on public.technician_queue_state to service_role;
grant all on public.technician_queue_events to service_role;
grant all on public.technician_availability to service_role;
grant all on public.technician_time_off to service_role;
grant all on public.technician_service_areas to service_role;

-- Mutating queue functions are SERVER-ONLY. Revoking EXECUTE from PUBLIC/anon/
-- authenticated is what stops a signed-in user (or a script with the anon key)
-- from rewriting their own queue position — the client can *request* an
-- assignment through the API, but only the server calls these.
revoke all on function public.assign_technician_to_request(uuid) from public, anon, authenticated;
revoke all on function public.respond_to_offer(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.expire_stale_offers() from public, anon, authenticated;
revoke all on function public.consume_queue_turn(uuid, text, uuid, text) from public, anon, authenticated;
revoke all on function public.sync_queue_membership(uuid) from public, anon, authenticated;
revoke all on function public.sync_appliance_queue_memberships(text) from public, anon, authenticated;
revoke all on function public.refresh_technician_operational_status(uuid) from public, anon, authenticated;
revoke all on function public.log_queue_event(uuid, text, uuid, text, integer, integer, text, uuid) from public, anon, authenticated;

grant execute on function public.assign_technician_to_request(uuid) to service_role;
grant execute on function public.respond_to_offer(uuid, uuid, text, text) to service_role;
grant execute on function public.expire_stale_offers() to service_role;
grant execute on function public.consume_queue_turn(uuid, text, uuid, text) to service_role;
grant execute on function public.sync_queue_membership(uuid) to service_role;
grant execute on function public.sync_appliance_queue_memberships(text) to service_role;
grant execute on function public.refresh_technician_operational_status(uuid) to service_role;
grant execute on function public.log_queue_event(uuid, text, uuid, text, integer, integer, text, uuid) to service_role;

-- The admin override runs from the admin UI: it is granted to `authenticated`
-- but the function itself refuses anyone who is not an administrator and
-- demands a written reason, which is recorded with the acting admin's id.
revoke all on function public.admin_queue_override(text, uuid, text, text) from public, anon;
grant execute on function public.admin_queue_override(text, uuid, text, text) to authenticated, service_role;


-- Read-only helpers that reveal schedule details stay server-only too.
revoke all on function public.technician_schedule_conflict(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.technician_eligibility_failure(uuid, text, text, timestamptz, timestamptz, uuid) from public, anon, authenticated;
revoke all on function public.technician_capacity_failure(uuid, timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.technician_within_availability(uuid, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.technician_schedule_conflict(uuid, timestamptz, timestamptz) to service_role;
grant execute on function public.technician_eligibility_failure(uuid, text, text, timestamptz, timestamptz, uuid) to service_role;
grant execute on function public.technician_capacity_failure(uuid, timestamptz, timestamptz) to service_role;
grant execute on function public.technician_within_availability(uuid, timestamptz, timestamptz) to service_role;

-- The snapshot IS meant to be called by a signed-in technician (its internal
-- role guard rejects customers), and by the service role for admin screens.
revoke all on function public.technician_queue_snapshot(text) from public, anon;
grant execute on function public.technician_queue_snapshot(text) to authenticated, service_role;

insert into public.system_settings (key, value) values ('queue_model_version', '2.0')
on conflict (key) do update set value = excluded.value, updated_at = now();

-- =========================================================
-- Verify the migration
-- =========================================================
-- Expect: 1 | 2.0
--   select count(*) as queue_rows, (select value from public.system_settings where key = 'queue_model_version') as model
--   from public.technician_queue_state;
--
-- Every membership must have a unique, contiguous position per appliance type:
--   select appliance_type, count(*) as members,
--          count(distinct queue_position) as distinct_positions,
--          max(queue_position) as highest
--   from public.technician_queue_state group by appliance_type;
--
-- What the technician queue screen shows (run as a technician, or as service role
-- with the technician's uuid hard-coded):
--   select * from public.technician_queue_snapshot(null);
--
-- Why somebody was skipped for a request:
--   select action, reason, old_position, new_position, created_at
--   from public.technician_queue_events
--   where repair_request_id = '<request uuid>'
--   order by created_at;

















