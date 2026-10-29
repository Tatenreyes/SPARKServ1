-- =========================================================
-- Migration: atomic booking creation, one live booking per request, and no
--            overlapping appointments for a technician (Batch 2)
-- ---------------------------------------------------------
-- WHY THIS FILE EXISTS
-- The audit found `POST /api/bookings` performing three separate writes that could
-- half-fail: insert the booking, update the repair request, increment the
-- technician's job-load counter. A crash between them left a booking whose request
-- was still `quoted` (so it could be booked twice) or a counter that drifted. It
-- also found two read-then-write races with no database protection at all:
--
--   * two requests could both pass the schedule-conflict check before either
--     committed, and both reserve the same technician for the same hours;
--   * nothing stopped a second live booking for the same repair request — the only
--     guard was `POST /api/bookings` happening to be the sole writer.
--
-- WHAT THIS FILE ADDS
--   1. `uniq_active_booking_per_request` — at most ONE non-cancelled booking per
--      repair request. Cancelled rows are history and are deliberately outside the
--      index, which is what keeps Batch 1's cancel-then-rebook flow working.
--   2. `enforce_booking_no_overlap()` — the database refuses an appointment that
--      overlaps another live appointment for the same technician, and serializes
--      writers per technician so the check cannot be raced.
--   3. `create_booking_atomic()` — the ONLY writer of a booking. One transaction:
--      lock the request, validate the actor, the request state and the estimate,
--      take the technician's scheduling lock, recheck availability / time off /
--      conflicts / capacity, insert, mark the request booked, move the counter.
--   4. Direct authenticated INSERT on `bookings` is withdrawn: the atomic function
--      is service-role only, so a browser cannot bypass it through PostgREST.
--
-- WHY NOT AN EXCLUSION CONSTRAINT
--   `EXCLUDE USING gist (technician_id WITH =, tstzrange(...) WITH &&)` is the
--   textbook answer and would be the first choice. It needs `btree_gist`, which is
--   available on Supabase but NOT in the PGlite harness this repository tests with
--   (`create extension btree_gist` -> "extension is not available"). A rule that
--   cannot be exercised by the test suite is a rule nobody can trust, so the
--   equivalent is built from a trigger plus a per-technician advisory lock: every
--   writer — the RPC, a service-role script, a future reschedule — takes the same
--   lock and then re-checks, which is the serialization an exclusion constraint
--   provides. It raises SQLSTATE 23P01 (exclusion_violation), the class a real
--   exclusion constraint raises, so callers treat both identically.
--
-- Idempotent: the index is `if not exists`, the function is `create or replace`,
-- and the trigger is dropped before it is recreated.
-- =========================================================


-- =========================================================
-- 1. Preflight — fail safely, with the offending rows named
-- =========================================================
-- These constraints cannot be created while existing data violates them, and the
-- raw PostgreSQL error (`could not create unique index ... Key (service_request_id)
-- is duplicated`) does not say which bookings to look at. This block refuses the
-- migration up front and prints the ids, so the decision stays yours: nothing here
-- cancels, completes or deletes a real booking.

do $preflight$
declare
  v_dup_requests uuid[];
  v_overlap_techs uuid[];
  v_zero_durations integer;
begin
  -- (a) One repair request with more than one non-cancelled booking.
  select array_agg(service_request_id) into v_dup_requests
  from (
    select service_request_id
    from public.bookings
    where status <> 'cancelled'
    group by service_request_id
    having count(*) > 1
    limit 25
  ) dupes;

  if v_dup_requests is not null then
    raise exception using
      errcode = 'P0001',
      message = format(
        'Batch 2 preflight: %s repair request(s) already have more than one non-cancelled booking, so uniq_active_booking_per_request cannot be created. Affected service_request_id values: %s',
        array_length(v_dup_requests, 1),
        array_to_string(v_dup_requests, ', ')
      ),
      hint = 'Read-only review first: select id, service_request_id, status, scheduled_at, technician_id from public.bookings where service_request_id = any(''<ids above>'') order by service_request_id, scheduled_at; then decide by hand which booking is the real one and cancel the duplicates through the normal cancellation path — do not delete them.',
      detail = 'Nothing was changed by this migration.';
  end if;

  -- (b) Two live bookings for one technician whose windows overlap.
  select array_agg(distinct ov.technician_id) into v_overlap_techs
  from (
    select b1.technician_id
    from public.bookings b1
    join public.bookings b2
      on b1.technician_id = b2.technician_id
     and b1.id < b2.id
     and b1.status in ('pending', 'in_progress', 'awaiting_inspection')
     and b2.status in ('pending', 'in_progress', 'awaiting_inspection')
     and b1.scheduled_at < b2.scheduled_at + make_interval(mins => greatest(coalesce(b2.duration_minutes, 120), 1))
     and b2.scheduled_at < b1.scheduled_at + make_interval(mins => greatest(coalesce(b1.duration_minutes, 120), 1))
    limit 25
  ) ov;

  if v_overlap_techs is not null then
    raise exception using
      errcode = 'P0001',
      message = format(
        'Batch 2 preflight: %s technician(s) already hold overlapping live appointments, so enforce_booking_no_overlap() would reject every later write for them until that is resolved. Affected technician_id values: %s',
        array_length(v_overlap_techs, 1),
        array_to_string(v_overlap_techs, ', ')
      ),
      hint = 'Read-only review first: select b1.id, b1.technician_id, b1.status, b1.scheduled_at, b1.duration_minutes, b2.id as clashes_with, b2.scheduled_at as other_start from public.bookings b1 join public.bookings b2 on b1.technician_id = b2.technician_id and b1.id < b2.id where b1.status in (''pending'',''in_progress'',''awaiting_inspection'') and b2.status in (''pending'',''in_progress'',''awaiting_inspection'') and b1.scheduled_at < b2.scheduled_at + make_interval(mins => greatest(coalesce(b2.duration_minutes,120),1)) and b2.scheduled_at < b1.scheduled_at + make_interval(mins => greatest(coalesce(b1.duration_minutes,120),1)) order by b1.technician_id, b1.scheduled_at;',
      detail = 'Nothing was changed by this migration.';
  end if;

  -- (c) Zero or negative durations. Not fatal — the rules below treat a missing or
  -- non-positive duration as the platform default — but they are almost certainly
  -- bad data, so report them rather than silently reinterpreting them.
  select count(*) into v_zero_durations
  from public.bookings
  where duration_minutes is not null and duration_minutes <= 0;

  if v_zero_durations > 0 then
    raise notice 'Batch 2 preflight: % booking(s) have a non-positive duration_minutes and are treated as 120 minutes. Review with: select id, service_request_id, scheduled_at, duration_minutes from public.bookings where duration_minutes is not null and duration_minutes <= 0;', v_zero_durations;
  end if;
end
$preflight$;

-- =========================================================
-- 2. One live booking per repair request
-- =========================================================
-- `status <> 'cancelled'` on purpose:
--   * a cancelled booking stays as history and must NOT block rebooking, which is
--     the flow Batch 1 added (cancel a pending booking -> the request returns to
--     `quoted` -> book again with the same approved estimate);
--   * a completed booking still occupies its request, so a finished repair cannot
--     collect a second appointment.

create unique index if not exists uniq_active_booking_per_request
  on public.bookings (service_request_id)
  where status <> 'cancelled';

-- =========================================================
-- 3. No overlapping appointments for one technician
-- =========================================================
-- The blocking status set is the same one technician_schedule_conflict() uses and
-- the two must stay in step:
--   pending             — an upcoming appointment holds the slot
--   in_progress         — the technician is there now
--   awaiting_inspection — the visit is still open
--   cancelled           — frees the slot (history)
--   completed           — history; the work is done
--   awaiting_payment    — the physical repair is finished and the customer owes
--                         money, so it no longer occupies the technician's time.
--                         This mirrors the existing conflict rule exactly; it is
--                         not a new policy.

create or replace function public.enforce_booking_no_overlap()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_other public.bookings%rowtype;
begin
  -- Cancelled and finished appointments never block anything.
  if new.status not in ('pending', 'in_progress', 'awaiting_inspection') then
    return new;
  end if;

  -- Serialize every writer for this technician for the rest of the transaction, so
  -- two concurrent inserts cannot both pass the check below — the read-then-write
  -- race the audit found. `pg_advisory_xact_lock` is re-entrant within a
  -- transaction, so create_booking_atomic() taking the same lock first is free.
  perform pg_advisory_xact_lock(hashtext('booking_technician:' || new.technician_id::text));

  v_start := new.scheduled_at;
  v_end := new.scheduled_at
           + make_interval(mins => greatest(coalesce(new.duration_minutes, 120), 1));

  select b.* into v_other
  from public.bookings b
  where b.technician_id = new.technician_id
    and b.id is distinct from new.id
    and b.status in ('pending', 'in_progress', 'awaiting_inspection')
    -- Half-open intervals: a booking that ends at 10:00 does not clash with one
    -- that starts at 10:00.
    and b.scheduled_at < v_end
    and b.scheduled_at
        + make_interval(mins => greatest(coalesce(b.duration_minutes, 120), 1)) > v_start
  limit 1;

  if v_other.id is not null then
    raise exception using
      errcode = '23P01', -- exclusion_violation: what an EXCLUDE constraint raises
      message = format(
        'This technician already has an appointment that overlaps %s to %s.',
        to_char(v_start, 'YYYY-MM-DD HH24:MI'),
        to_char(v_end, 'YYYY-MM-DD HH24:MI')
      ),
      detail = format('Overlapping booking %s is %s from %s.', v_other.id, v_other.status, to_char(v_other.scheduled_at, 'YYYY-MM-DD HH24:MI')),
      hint = 'Choose a different time, or a different technician through the queue.';
  end if;

  return new;
end;
$$;

-- Named `trg_…` so it fires AFTER `require_approved_estimate_for_booking`: BEFORE
-- triggers run in alphabetical order, and an unapproved estimate should be reported
-- as such rather than as a scheduling clash.
drop trigger if exists trg_booking_no_overlap on public.bookings;
create trigger trg_booking_no_overlap
  before insert or update of technician_id, scheduled_at, duration_minutes, status
  on public.bookings
  for each row execute procedure public.enforce_booking_no_overlap();


-- =========================================================
-- 4. create_booking_atomic() — the ONLY writer of a booking
-- =========================================================
-- Everything a booking needs to be true happens in one transaction, in this order:
--
--   1. lock the repair request            (serializes decisions about this request)
--   2. identify the actor                 (role re-read from the database)
--   3. validate the request state         (assigned + accepted + bookable)
--   4. refuse a second live booking       (idempotent for a retry)
--   5. validate the estimate              (this request, this technician, current
--                                          approved version, not superseded)
--   6. validate the appointment window    (start + a sane duration)
--   7. take the technician's scheduling lock
--   8. recheck availability / time off / conflicts / capacity  (the SAME functions
--                                          the queue walk uses — nothing duplicated)
--   9. insert the booking
--  10. mark the request booked (+ its confirmed window)
--  11. move the technician's job-load counter, exactly once
--
-- LOCK ORDER: the request row first, then the per-technician advisory lock, and
-- nothing else. Two bookings for one technician therefore serialize on the same
-- lock, and a booking never waits on a lock another booking holds in the opposite
-- order. Cancellation (a booking row, then the request through the Batch 1 reopen
-- trigger) touches the request last as well, so the request is always the final
-- resource and no cycle can form.
--
-- Returns jsonb, so the API route can map an expected refusal to the right status
-- without parsing error strings. `outcome` is one of:
--   booked                      booking_id, booking, request_id, scheduled_at
--   already_booked              booking_id (a live booking already exists)
--   request_not_found
--   forbidden                   the actor may not book this request
--   request_not_bookable        reason: not_assigned | status_<request status>
--   estimate_invalid            reason: wrong_request | wrong_technician |
--                               not_approved | superseded
--   invalid_input | invalid_schedule
--   outside_availability_window
--   schedule_conflict
--   capacity_concurrent_job | capacity_daily_jobs | capacity_daily_hours

create or replace function public.create_booking_atomic(
  p_request_id uuid,
  p_estimate_id uuid,
  p_actor uuid,
  p_scheduled_at timestamptz,
  p_duration_minutes integer default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  r public.service_requests%rowtype;
  e public.estimates%rowtype;
  b public.bookings%rowtype;
  v_role public.user_role;
  v_existing uuid;
  v_minutes integer;
  v_end timestamptz;
  v_capacity text;
begin
  if p_request_id is null or p_estimate_id is null or p_actor is null or p_scheduled_at is null then
    return jsonb_build_object('outcome', 'invalid_input', 'reason', 'missing_parameter');
  end if;

  -- 1. The request is the unit of work: lock it for the whole transaction.
  select * into r from public.service_requests where id = p_request_id for update;
  if r.id is null then
    return jsonb_build_object('outcome', 'request_not_found', 'request_id', p_request_id);
  end if;

  -- 2. Who is asking? Read the role from public.users; never trust the caller.
  select u.role into v_role from public.users u where u.id = p_actor;
  if v_role is null or v_role not in ('customer', 'admin', 'super_admin') then
    return jsonb_build_object('outcome', 'forbidden', 'request_id', r.id, 'reason', 'role');
  end if;
  if v_role = 'customer' and r.customer_id <> p_actor then
    return jsonb_build_object('outcome', 'forbidden', 'request_id', r.id, 'reason', 'not_owner');
  end if;

  -- 3. One live booking per request, checked BEFORE the request-state rules: a
  --    retry of an attempt that already succeeded must be answered "you already
  --    have a booking" (idempotent, 409) rather than "this request is not bookable",
  --    which is what its `booked` status would otherwise report.
  select b2.id into v_existing
  from public.bookings b2
  where b2.service_request_id = r.id
    and b2.status <> 'cancelled'
  limit 1;
  if v_existing is not null then
    return jsonb_build_object('outcome', 'already_booked', 'request_id', r.id, 'booking_id', v_existing);
  end if;

  -- 4. A request is bookable once a technician has ACCEPTED it and it is still open
  --    or quoted. `booked`/`completed`/`cancelled` are refused here.
  if r.assignment_status <> 'accepted' or r.assigned_technician_id is null then
    return jsonb_build_object(
      'outcome', 'request_not_bookable',
      'reason', 'not_assigned',
      'request_id', r.id,
      'assignment_status', r.assignment_status
    );
  end if;
  if r.status not in ('quoted', 'open') then
    return jsonb_build_object(
      'outcome', 'request_not_bookable',
      'reason', 'status_' || r.status::text,
      'request_id', r.id,
      'request_status', r.status
    );
  end if;


  -- 5. The estimate must be the CURRENT APPROVED version of THIS request, made by
  --    the technician who is actually assigned to it. This is the same rule the
  --    `require_approved_estimate_for_booking` trigger enforces for any writer; it
  --    is checked here first so the API can say which of the four things is wrong.
  select * into e from public.estimates where id = p_estimate_id;
  if e.id is null or e.service_request_id <> r.id then
    return jsonb_build_object('outcome', 'estimate_invalid', 'reason', 'wrong_request', 'request_id', r.id);
  end if;
  if e.technician_id <> r.assigned_technician_id then
    return jsonb_build_object(
      'outcome', 'estimate_invalid',
      'reason', 'wrong_technician',
      'request_id', r.id,
      'estimate_technician_id', e.technician_id,
      'assigned_technician_id', r.assigned_technician_id
    );
  end if;
  -- Superseded first: it is the more specific fact, and a replaced version carries
  -- both `status = 'superseded'` and `superseded_by` (submit_estimate sets both).
  if e.status = 'superseded' or e.superseded_by is not null then
    return jsonb_build_object('outcome', 'estimate_invalid', 'reason', 'superseded', 'estimate_status', e.status);
  end if;
  if e.status <> 'accepted' then
    return jsonb_build_object('outcome', 'estimate_invalid', 'reason', 'not_approved', 'estimate_status', e.status);
  end if;

  -- 6. The appointment window. The duration falls back to what the customer asked
  --    for when they submitted the request, then to the platform default; a whole
  --    day is the ceiling, because a longer "appointment" is a data error rather
  --    than a booking.
  v_minutes := coalesce(nullif(p_duration_minutes, 0), r.requested_duration_minutes, 120);
  if v_minutes is null or v_minutes < 1 or v_minutes > 1440 then
    return jsonb_build_object('outcome', 'invalid_schedule', 'reason', 'duration', 'duration_minutes', v_minutes);
  end if;
  v_end := p_scheduled_at + make_interval(mins => v_minutes);

  -- 7. Everything from here decides a scheduling question, so serialize on the
  --    technician. The same lock is taken by the overlap trigger, which is what
  --    makes a concurrent second booking see this one.
  perform pg_advisory_xact_lock(hashtext('booking_technician:' || r.assigned_technician_id::text));

  -- 8. The rules that made the technician eligible when the offer was sent are
  --    rechecked against the appointment the customer actually chose: weekly
  --    working hours, time off and existing appointments (one function, both
  --    concerns), then the workload limits. No eligibility logic is reimplemented
  --    here — these are the queue engine's own functions.
  if not public.technician_within_availability(r.assigned_technician_id, p_scheduled_at, v_end) then
    return jsonb_build_object(
      'outcome', 'outside_availability_window',
      'reason', 'outside_availability_window',
      'message', public.queue_reason_message('outside_availability_window'),
      'request_id', r.id,
      'technician_id', r.assigned_technician_id
    );
  end if;

  if public.technician_schedule_conflict(r.assigned_technician_id, p_scheduled_at, v_end) then
    return jsonb_build_object(
      'outcome', 'schedule_conflict',
      'reason', 'schedule_conflict',
      'message', public.queue_reason_message('schedule_conflict'),
      'request_id', r.id,
      'technician_id', r.assigned_technician_id
    );
  end if;

  v_capacity := public.technician_capacity_failure(r.assigned_technician_id, p_scheduled_at, v_end);
  if v_capacity is not null then
    return jsonb_build_object(
      'outcome', v_capacity,
      'reason', v_capacity,
      'message', public.queue_reason_message(v_capacity),
      'request_id', r.id,
      'technician_id', r.assigned_technician_id
    );
  end if;


  -- 9-11. The three writes, in one transaction. The trigger and the index re-check
  --        the two races that a read-then-write sequence cannot close on its own, so
  --        a booking that slipped past the checks above is refused rather than
  --        stored — and because this block catches the violation, the request and
  --        the counter are left untouched.
  begin
    insert into public.bookings (
      service_request_id, estimate_id, customer_id, technician_id,
      scheduled_at, duration_minutes, notes, status
    )
    values (
      r.id, e.id, r.customer_id, r.assigned_technician_id,
      p_scheduled_at, v_minutes, nullif(btrim(coalesce(p_notes, '')), ''), 'pending'
    )
    returning * into b;
  exception
    when unique_violation then
      -- uniq_active_booking_per_request: another transaction booked this request
      -- while we were deciding.
      return jsonb_build_object('outcome', 'already_booked', 'request_id', r.id);
    when exclusion_violation then
      -- trg_booking_no_overlap: another transaction took the technician's window.
      return jsonb_build_object(
        'outcome', 'schedule_conflict',
        'reason', 'schedule_conflict',
        'message', public.queue_reason_message('schedule_conflict'),
        'request_id', r.id
      );
  end;

  -- 10. The confirmed appointment replaces the preference the customer gave with the
  --     request, so the queue engine and the schedule agree on one window. The
  --     request row is already locked by this transaction.
  update public.service_requests
     set status = 'booked',
         requested_window_start = p_scheduled_at,
         requested_window_end = v_end,
         requested_duration_minutes = v_minutes,
         updated_at = now()
   where id = r.id;

  -- 11. The job-load counter moves once per successful booking, in the same
  --     statement that reads it, so a retry cannot double-count and a failure
  --     cannot leave it behind.
  update public.technicians
     set active_job_load = active_job_load + 1
   where id = r.assigned_technician_id;

  perform public.refresh_technician_operational_status(r.assigned_technician_id);

  return jsonb_build_object(
    'outcome', 'booked',
    'booking_id', b.id,
    'booking', to_jsonb(b),
    'request_id', r.id,
    'technician_id', r.assigned_technician_id,
    'estimate_id', e.id,
    'scheduled_at', p_scheduled_at,
    'duration_minutes', v_minutes
  );
end;
$$;

-- =========================================================
-- 5. Booking creation happens only through the atomic function
-- =========================================================
-- Batch 1 left two INSERT policies on `bookings` so a customer (or an administrator)
-- could insert a booking straight through PostgREST. That path bypasses the
-- transaction above: no request lock, no capacity recheck, and it relied on the
-- route happening to be the only writer. No feature inserts bookings from the
-- browser — `POST /api/bookings` was the only writer, and it now calls
-- `create_booking_atomic()` with the service-role client — so the policies go.
--
-- With no INSERT policy at all, RLS denies every direct insert for `authenticated`,
-- which is what makes the atomic path unavoidable. The constraints added above stay
-- in place as defence in depth for the service role itself.

drop policy if exists "customer creates booking from own request" on public.bookings;
drop policy if exists "admin creates bookings" on public.bookings;


-- =========================================================
-- 6. Permissions
-- =========================================================
-- Booking creation is server-only, like every other state change in this workflow
-- (submit_estimate, decide_estimate, respond_to_offer, confirm_payment). The route
-- authenticates the caller with `getCurrentUser()` and passes that id in; the
-- function then re-reads the actor's role and ownership from the database, so a
-- forged `p_actor` cannot book somebody else's request.

revoke all on function public.create_booking_atomic(uuid, uuid, uuid, timestamptz, integer, text)
  from public, anon, authenticated;
grant execute on function public.create_booking_atomic(uuid, uuid, uuid, timestamptz, integer, text)
  to service_role;

-- =========================================================
-- 7. Giving the slot back when a booking is cancelled
-- =========================================================
-- `create_booking_atomic()` moves `active_job_load` by exactly one, so the release
-- has to be just as atomic. The route used to read the counter, subtract in
-- JavaScript and write the result back:
--
--     const { data: tech } = await supabase.from("technicians")
--       .select("active_job_load").eq("id", ...).single();
--     await supabase.from("technicians")
--       .update({ active_job_load: Math.max(0, tech.active_job_load - 1) });
--
-- Two cancellations for the same technician finishing together both read the same
-- starting value, so the second write undid the first decrement and the technician's
-- load stayed permanently one too high. One statement closes that; `greatest(0, …)`
-- keeps the counter from ever going negative if a booking is cancelled twice.
--
-- The request side of a cancellation is NOT here: the Batch 1 trigger
-- `reopen_request_after_booking_cancel` returns the request from `booked` to
-- `quoted` once its last live booking is gone, whichever writer cancelled it.
create or replace function public.release_technician_slot(p_technician_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_load integer;
begin
  if p_technician_id is null then
    return null;
  end if;

  update public.technicians
     set active_job_load = greatest(0, active_job_load - 1)
   where id = p_technician_id
  returning active_job_load into v_load;

  return v_load;
end;
$$;

revoke all on function public.release_technician_slot(uuid) from public, anon, authenticated;
grant execute on function public.release_technician_slot(uuid) to service_role;

-- To confirm the release by hand, in the SQL editor:
--
--   select public.release_technician_slot('<technician-uuid>');
--   -- expect: the counter one lower, never below zero

-- =========================================================
-- 8. Verify (run these in the SQL editor after applying)
-- =========================================================
-- The one-live-booking index exists:
--
--   select indexdef from pg_indexes
--   where schemaname = 'public' and indexname = 'uniq_active_booking_per_request';
--
-- The overlap trigger is installed on bookings:
--
--   select t.tgname, pg_get_triggerdef(t.oid)
--   from pg_trigger t join pg_class c on c.oid = t.tgrelid
--   where c.relname = 'bookings' and not t.tgisinternal;
--
-- No INSERT policy remains on bookings (expect zero rows):
--
--   select policyname, cmd from pg_policies
--   where schemaname = 'public' and tablename = 'bookings' and cmd = 'INSERT';
--
-- The atomic function is service-role only:
--
--   select has_function_privilege('authenticated',
--     'public.create_booking_atomic(uuid,uuid,uuid,timestamptz,integer,text)', 'EXECUTE');
--   -- expect: false
--
-- And a dry run of the two protections, in a transaction you roll back:
--
--   begin;
--     -- overlapping: expect SQLSTATE 23P01
--     insert into public.bookings (service_request_id, customer_id, technician_id, scheduled_at, duration_minutes, status)
--     select service_request_id, customer_id, technician_id, scheduled_at, 120, 'pending'
--     from public.bookings where status = 'pending' limit 1;
--   rollback;

