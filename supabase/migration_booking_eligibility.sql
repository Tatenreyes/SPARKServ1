-- =========================================================
-- Migration: the booking eligibility invariant (step 17)
-- ---------------------------------------------------------
-- THE DEFECT THIS CLOSES
-- `create_booking_atomic()` validated the WORKFLOW STATE of a request — the
-- assignment had to be `accepted`, and the estimate had to be the current approved
-- version of the same request written by the same technician — but it never
-- re-checked that the technician is still QUALIFIED for the request's appliance
-- type.
--
-- Qualification IS enforced when an offer is sent: `technician_eligibility_failure()`
-- requires an ACTIVE queue membership for the appliance type, and membership mirrors
-- `technicians.specializations`. It was never enforced when the booking is WRITTEN,
-- and an accepted assignment can go stale in between:
--
--   * a technician removes an appliance from their own specializations — the
--     profile form writes `technicians.specializations` directly — and the
--     membership sync deactivates their queue membership while the request they
--     already accepted is left untouched;
--   * an administrator unapproves, suspends or deactivates the account: same sync,
--     same untouched request;
--   * `admin_queue_override(..., 'remove')` takes a technician out of one appliance
--     rotation, which is a documented administrative action with a written reason.
--
-- In every one of those the request stayed `assignment_status = 'accepted'` with
-- `status = 'quoted'` and an approved estimate, so the customer could confirm the
-- appointment: a booking row was written for a technician the application's own
-- rules say must not be offered that work, the request flipped to `booked`, and
-- `active_job_load` moved. Where that technician was the LAST member of the queue,
-- the same path let a customer book an appliance type the platform cannot service
-- at all.
--
-- A SECOND, NARROWER FORM OF THE SAME DEFECT was found in review. The check added
-- here is a READ, and none of the three rows it reads was locked, so a concurrent
-- commit could still land between the read and the booking's commit: a
-- specialization edit, an approval change, a suspension, an account deactivation or
-- an administrative queue removal, all of which the sync triggers perform in their
-- own transaction. The technician is then eligible when checked and ineligible when
-- the booking becomes visible — the same invalid booking, with a narrower window.
-- Section 3 therefore takes a row lock on each row the decision reads (FOR SHARE
-- where this transaction only reads, FOR NO KEY UPDATE on the technician, which it
-- also writes), which serializes those writers against the booking and blocks no
-- reader.
--
-- WHAT THIS FILE DOES
--   1. `technician_qualification_failure()` — the qualification half of the queue
--      engine's eligibility gate, extracted so it has exactly ONE definition:
--      account active, technician approved, not suspended, and an active queue
--      membership for the appliance type. `technician_eligibility_failure()` is
--      re-pointed at it, so the queue walk and the booking transaction cannot
--      disagree about who may take a given appliance.
--   2. `appliance_has_qualified_technician()` — read-only: does ANY technician
--      currently qualify for this appliance type? It exists only so the API can
--      choose the honest customer message ("nobody covers this appliance" vs "the
--      technician assigned to you is no longer qualified").
--   3. `create_booking_atomic()` — one new check, before the estimate is examined,
--      a new outcome `technician_not_eligible`, and a row lock on each row that check
--      reads (FOR SHARE where this transaction only reads, FOR NO KEY UPDATE on the
--      technician it also writes) so a concurrent qualification change cannot
--      interleave with it.
--   4. Permissions for the two new helpers, matching the existing predicate
--      functions: server-only.
--
-- WHAT DELIBERATELY DOES NOT CHANGE
--   * No new product policy. These are the rules the queue engine already applies,
--     applied at the moment the booking is written as well.
--   * A refused attempt mutates NOTHING: no booking row, the request keeps its
--     status and its assignment, `active_job_load` is untouched, and the queue
--     rotation does not move. The check therefore sits before the technician's
--     advisory lock and before every write.
--   * `respond_to_offer()` and the assignment walk are untouched. A stale
--     assignment is REFUSED at booking time rather than silently re-matched or
--     released: releasing it would be a workflow decision, not a guard, and it is
--     called out as the follow-up in the notes at the end of this file.
--
-- Safe to run more than once: every statement is create-or-replace, and the
-- permission block is idempotent.
-- =========================================================


-- =========================================================
-- 1. "Is this technician qualified for this appliance type?" — ONE definition
-- =========================================================
-- Verbatim the first two checks of `technician_eligibility_failure()` below, in the
-- same order and with the same reason strings, so re-pointing that function at this
-- one cannot change a single queue decision.
--
-- Returns NULL when the technician qualifies, otherwise a machine-readable reason:
--   not_available  account inactive, or the technician is not approved
--   suspended      operational_status = 'SUSPENDED'
--   not_in_queue   no ACTIVE queue membership for this appliance type, which is how
--                  "not qualified for this appliance" is represented everywhere else
--
-- Deliberately no early return for a null technician or a null/blank appliance
-- type: the checks below already answer those the way the queue engine does (an
-- unknown id is 'not_available'; an appliance type nobody queues for is
-- 'not_in_queue').
create or replace function public.technician_qualification_failure(
  p_technician_id uuid,
  p_appliance_type text
)
returns text
language plpgsql
stable
security definer set search_path = public
as $qualification$
declare
  v_type text := public.normalize_appliance_type(p_appliance_type);
begin
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

  if not exists (
    select 1 from public.technician_queue_state qs
    where qs.technician_id = p_technician_id
      and qs.appliance_type = v_type
      and qs.is_active
  ) then
    return 'not_in_queue';
  end if;

  return null;
end;
$qualification$;

-- Does the platform have ANYONE who could take this appliance type right now?
-- Read-only, no counts and no names: it answers "is this a gap in coverage, or did
-- the assigned technician simply lose the qualification?" so the customer can be
-- told which of the two happened.
--
-- plpgsql rather than sql on purpose: schema.sql is a fresh install and does not
-- carry the queue engine, so this body may be created before
-- normalize_appliance_type() exists. A plpgsql body is resolved at call time.
create or replace function public.appliance_has_qualified_technician(p_appliance_type text)
returns boolean
language plpgsql
stable
security definer set search_path = public
as $coverage$
declare
  v_type text := public.normalize_appliance_type(p_appliance_type);
begin
  return exists (
    select 1
    from public.technician_queue_state qs
    join public.technicians t on t.id = qs.technician_id
    join public.users u on u.id = qs.technician_id
    where qs.appliance_type = v_type
      and qs.is_active
      and t.approved
      and t.operational_status <> 'SUSPENDED'
      and u.is_active
  );
end;
$coverage$;

-- =========================================================
-- 2. The eligibility gate now delegates qualification
-- =========================================================
-- Same signature, same reason strings, same ORDER of checks as the version in
-- migration_queue_redesign.sql — the first four checks (account, approval,
-- suspension, queue membership) are simply read from the shared predicate above.
-- Everything after them (one live offer per technician, service area, availability,
-- capacity) is untouched, so no queue decision changes.
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
  v_qualification text;
  v_capacity text;
begin
  -- 1. Account / approval / suspension, then queue membership for this appliance
  --    type. ONE definition, shared with create_booking_atomic().
  v_qualification := public.technician_qualification_failure(p_technician_id, v_type);
  if v_qualification is not null then
    return v_qualification;
  end if;

  -- 2. One live offer per technician — but this only skips them for the OTHER
  -- request; it is not a queue exit.
  if p_request_id is not null and exists (
    select 1 from public.service_requests r
    where r.assigned_technician_id = p_technician_id
      and r.assignment_status = 'offered'
      and r.id <> p_request_id
  ) then
    return 'holding_offer';
  end if;

  -- 3. Service area
  if not public.technician_covers_area(p_technician_id, v_type, p_location) then
    return 'service_area';
  end if;

  -- 4. Availability at the requested time
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

  -- 5. Capacity
  v_capacity := public.technician_capacity_failure(p_technician_id, p_start, p_end);
  if v_capacity is not null then
    return v_capacity;
  end if;

  return null;
end;
$$;

-- =========================================================
-- 3. create_booking_atomic() — the booking eligibility invariant
-- =========================================================
-- The Batch 2 transaction, unchanged except for step 5. Same signature, same lock
-- order (request row, then the per-technician advisory lock), same outcomes — plus
-- `technician_not_eligible`.
--
-- Returns jsonb. `outcome` is one of:
--   booked                      booking_id, booking, request_id, scheduled_at
--   already_booked              booking_id (a live booking already exists)
--   request_not_found
--   forbidden                   the actor may not book this request
--   request_not_bookable        reason: not_assigned | status_<request status>
--   technician_not_eligible     reason: not_in_queue | not_available | suspended,
--                               plus appliance_type, technician_id and
--                               qualified_technician_available (does ANYBODY cover
--                               this appliance type?) — the assignment is stale, so
--                               no booking, no request change, no counter move
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
  v_qualification text;
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

  -- 5. THE ELIGIBILITY INVARIANT. The technician who accepted must still be
  --    qualified for THIS appliance type, by the queue engine's own rule
  --    (`technician_qualification_failure`): approved, active, not suspended, and
  --    holding an active membership of this appliance's queue — which is what
  --    mirrors `technicians.specializations`.
  --
  --    An `accepted` assignment is a claim about the past. Specializations can be
  --    edited (by the technician themselves), an account can be suspended, and an
  --    administrator can remove somebody from one rotation — and none of those
  --    release the request they already accepted. Without this check a booking is
  --    written for a technician the platform's own rules forbid from taking the
  --    job, and where they were the last member of that queue, for an appliance
  --    type nobody can service at all.
  --
  --    Nothing is mutated here: the refusal happens before the advisory lock and
  --    before every write, so the request keeps its state, no counter moves and the
  --    rotation does not change.
  --
  --    A READ IS NOT ENOUGH ON ITS OWN. `technician_qualification_failure()` reads
  --    three rows and locks none of them, so without the block below a concurrent
  --    commit could land between this read and this transaction's commit: the
  --    technician is eligible when checked and ineligible when the booking becomes
  --    visible. Same invalid booking, narrower window.
  --
  --    The coordination is a lock on each row the decision reads — the account, the
  --    technician, and this appliance's queue membership. It blocks no reader and no
  --    other booking, but it does block every WRITER of those rows until this
  --    transaction ends. All five paths that can invalidate qualification take a
  --    conflicting row lock on one of them, because the sync triggers they fire
  --    (`trg_sync_queue_membership` on technicians,
  --    `trg_sync_queue_membership_user` on users) update exactly these rows: a
  --    specialization edit, an approval change, a suspension, an account
  --    deactivation, and `admin_queue_override(..., 'remove')`. So only two orders
  --    are possible, and both are safe:
  --
  --      * the change commits first → this read sees it and the booking is refused;
  --      * this read commits first  → the change waits, and the booking was made
  --                                   while the technician was still eligible.
  --
  --    THE STRENGTH DIFFERS PER ROW, and that is deliberate:
  --
  --      * `users` and `technician_queue_state` are only ever READ by this
  --        transaction, so FOR SHARE is exactly enough — and it is the weakest lock
  --        that conflicts with the UPDATE a qualification change performs.
  --      * `technicians` is WRITTEN later in this same transaction (step 12 moves
  --        `active_job_load`, and step 13 refreshes the operational status), and both
  --        of those take FOR NO KEY UPDATE. Taking FOR SHARE here and upgrading later
  --        is the classic lock-upgrade deadlock: a qualification writer that queued
  --        behind our share lock would be ahead of our own upgrade request, and
  --        PostgreSQL does not let a lock upgrade jump the queue. Taking the strength
  --        this transaction will need anyway means there is nothing left to upgrade.
  --        It also means two concurrent bookings for the SAME technician serialize on
  --        this row before the advisory lock below, which is why the order is safe in
  --        both directions.
  --
  --    Lock order stays acyclic and follows the existing writers: request →
  --    users → technicians → technician_queue_state → the per-technician advisory
  --    lock. The membership sync writes technicians before queue_state, and the user
  --    trigger writes users before technicians, so nothing acquires them backwards.
  perform 1 from public.users u
   where u.id = r.assigned_technician_id
     for share;

  perform 1 from public.technicians t
   where t.id = r.assigned_technician_id
     for no key update;

  perform 1 from public.technician_queue_state qs
   where qs.technician_id = r.assigned_technician_id
     and qs.appliance_type = public.normalize_appliance_type(r.appliance_type)
     for share;

  v_qualification := public.technician_qualification_failure(
    r.assigned_technician_id, r.appliance_type
  );
  if v_qualification is not null then
    return jsonb_build_object(
      'outcome', 'technician_not_eligible',
      'reason', v_qualification,
      'message', public.queue_reason_message(v_qualification),
      'request_id', r.id,
      'technician_id', r.assigned_technician_id,
      'appliance_type', public.normalize_appliance_type(r.appliance_type),
      'qualified_technician_available',
        public.appliance_has_qualified_technician(r.appliance_type)
    );
  end if;

  -- 6. The estimate must be the CURRENT APPROVED version of THIS request, made by
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

  -- 7. The appointment window. The duration falls back to what the customer asked
  --    for when they submitted the request, then to the platform default; a whole
  --    day is the ceiling, because a longer "appointment" is a data error rather
  --    than a booking.
  v_minutes := coalesce(nullif(p_duration_minutes, 0), r.requested_duration_minutes, 120);
  if v_minutes is null or v_minutes < 1 or v_minutes > 1440 then
    return jsonb_build_object('outcome', 'invalid_schedule', 'reason', 'duration', 'duration_minutes', v_minutes);
  end if;
  v_end := p_scheduled_at + make_interval(mins => v_minutes);

  -- 8. Everything from here decides a scheduling question, so serialize on the
  --    technician. The same lock is taken by the overlap trigger, which is what
  --    makes a concurrent second booking see this one.
  perform pg_advisory_xact_lock(hashtext('booking_technician:' || r.assigned_technician_id::text));

  -- 9. The rules that made the technician eligible when the offer was sent are
  --    rechecked against the appointment the customer actually chose: weekly
  --    working hours, time off and existing appointments (one function, both
  --    concerns), then the workload limits. No eligibility logic is reimplemented
  --    here — these are the queue engine's own functions. Qualification itself was
  --    already settled in step 5, which is the half that must not depend on the
  --    chosen time.
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

  -- 10-12. The three writes, in one transaction. The trigger and the index re-check
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

  -- 11. The confirmed appointment replaces the preference the customer gave with the
  --     request, so the queue engine and the schedule agree on one window. The
  --     request row is already locked by this transaction.
  update public.service_requests
     set status = 'booked',
         requested_window_start = p_scheduled_at,
         requested_window_end = v_end,
         requested_duration_minutes = v_minutes,
         updated_at = now()
   where id = r.id;

  -- 12. The job-load counter moves once per successful booking, in the same
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
-- 4. Permissions
-- =========================================================
-- Both new helpers are server-only, exactly like the eligibility and capacity
-- predicates they sit beside: they reveal who is qualified for what, which is
-- queue information a customer must never read. The functions that need them
-- (`create_booking_atomic`, `assign_technician_to_request`, …) are SECURITY
-- DEFINER, so they keep working; only direct PostgREST calls are refused.
revoke all on function public.technician_qualification_failure(uuid, text)
  from public, anon, authenticated;
grant execute on function public.technician_qualification_failure(uuid, text)
  to service_role;

revoke all on function public.appliance_has_qualified_technician(text)
  from public, anon, authenticated;
grant execute on function public.appliance_has_qualified_technician(text)
  to service_role;

-- `create_booking_atomic` keeps the signature and the grants Batch 2 gave it:
-- replacing the function body does not change its ACL, but the revoke is repeated
-- so this file is self-contained and safe to re-run in any order.
revoke all on function public.create_booking_atomic(uuid, uuid, uuid, timestamptz, integer, text)
  from public, anon, authenticated;
grant execute on function public.create_booking_atomic(uuid, uuid, uuid, timestamptz, integer, text)
  to service_role;


-- =========================================================
-- 5. Verify (run these in the SQL editor after applying)
-- =========================================================
-- The shared predicate exists and is service-role only:
--
--   select has_function_privilege('authenticated',
--     'public.technician_qualification_failure(uuid,text)', 'EXECUTE');
--   -- expect: false
--
-- A request whose assigned technician is NOT in that appliance's queue is refused
-- with `technician_not_eligible` and writes nothing:
--
--   select public.create_booking_atomic('<request>', '<approved-estimate>',
--          '<customer>', '2031-03-02T01:00:00Z', 120, null);
--   -- expect outcome = technician_not_eligible, reason = not_in_queue
--
--   select count(*) from public.bookings where service_request_id = '<request>';
--   -- expect: 0, and the request is still quoted + accepted
--
-- And a request whose technician IS qualified still books normally:
--
--   -- expect outcome = booked
--
-- THE ROW LOCKS ARE HELD. One session, ROLLED BACK — a lock-visibility probe, not a
-- booking test: the booking path runs, the relation-level lock it took is visible before
-- the transaction ends, and the booking is then undone on purpose:
--
--   begin;
--   select public.create_booking_atomic('<request>', '<approved-estimate>',
--          '<customer>', '2031-05-02T01:00:00Z', 120, null) -> 'outcome';
--   -- expect: booked
--   select c.relname, l.mode
--     from pg_locks l join pg_class c on c.oid = l.relation
--    where l.locktype = 'relation'
--      and c.relname in ('users', 'technicians', 'technician_queue_state');
--   -- expect: RowShareLock on users and technician_queue_state, and RowExclusiveLock on
--   --         technicians — the strength that transaction needs for the job-load
--   --         counter it writes a moment later, taken up front so nothing is upgraded
--   rollback;
--
--   select count(*) from public.bookings where service_request_id = '<request>';
--   -- expect: 0 — the probe was rolled back
--
-- A TWO-SESSION INTERLEAVING TEST. This is the race the locks close, and it needs two
-- real connections holding transactions open at the same time. PGlite (the test harness)
-- is a single connection, so it can only prove the locks are TAKEN, never that a writer
-- WAITS — that is what these tests add.
--
-- HOW TO RUN IT, and the two things that make it work:
--
--   * TWO REAL CONNECTIONS. Two `psql` sessions against the project's direct/session
--     connection (Project Settings → Database), NOT the REST API: PostgREST runs every
--     request in its own autocommit transaction, so it cannot hold one open. A
--     transaction-mode pooler is fine as long as one whole transaction stays on one
--     backend.
--   * DISPOSABLE DATA, NEVER A LIVE TECHNICIAN OR REQUEST. These tests edit
--     `specializations`, which legitimately moves the queue rotation, and one of them
--     commits a real appointment. Use a staging project, or a throwaway technician,
--     request and approved estimate — see CLEANUP at the end.
--
-- The isolation level is PostgreSQL's default READ COMMITTED, which is what Supabase and
-- PostgREST run and what this design was reasoned about. Every expectation below depends
-- on it.
--
-- TEST 1 — LOCK HELD, THEN ROLLED BACK. Proves: a qualification writer WAITS while a
-- booking transaction is in flight. Does NOT prove: a committed booking — the rollback
-- undoes it. It is a blocking test, not a success test.
--
--     -- Session 1
--     begin;
--     select public.create_booking_atomic('<request>', '<approved-estimate>',
--            '<customer>', '2031-05-02T01:00:00Z', 120, null) -> 'outcome';
--     -- expect: booked   (NOT committed yet)
--
--     -- Session 2 (run now — it must WAIT, not fail)
--     update public.technicians set specializations = '{}' where id = '<technician>';
--
--     -- any third connection (privileged, like the direct psql session):
--     -- Session 2 is demonstrably blocked
--     select pid, state, wait_event_type, wait_event, left(query, 60) as query
--       from pg_stat_activity
--      where datname = current_database() and wait_event_type = 'Lock';
--     -- expect: Session 2 waiting on the technicians row (transactionid / tuple)
--
--     -- Session 1
--     rollback;   -- undoes the booking; Session 2 then proceeds
--
--     -- Session 2
--     commit;     -- (or roll back — either way this test asserted the WAIT)
--
--     select count(*) from public.bookings where service_request_id = '<request>';
--     -- expect: 0 — Session 1 rolled back
--
-- TEST 2 — THE COMMITTED ELIGIBILITY CHANGE WINS. Session 2 COMMITS, so when Session 1
-- resumes it re-reads the new state and must refuse. A ROLLBACK here would undo the
-- change, Session 1 would see the original eligible state and legitimately return
-- `booked` — the opposite of what this test is for. Commit is what makes it meaningful.
--
--     -- Session 2
--     begin;
--     update public.technicians set specializations = '{}' where id = '<technician>';
--     -- (the sync trigger has deactivated this appliance's queue membership, uncommitted)
--
--     -- Session 1 (run now — it must WAIT here)
--     begin;
--     select public.create_booking_atomic('<request>', '<approved-estimate>',
--            '<customer>', '2031-05-02T01:00:00Z', 120, null) -> 'outcome';
--     -- (still waiting: confirm with the pg_stat_activity query from TEST 1)
--
--     -- Session 2
--     commit;     -- RELEASE the change. Do NOT roll back.
--
--     -- Session 1 resumes on its own and returns:
--     -- expect: technician_not_eligible, reason = not_in_queue
--     commit;     -- nothing was written, so there is nothing to undo
--
--   TEST 2 must be shown to have written NOTHING. Session 2 takes the snapshot INSIDE its
--   own transaction, BEFORE it commits — only Session 2 can see its own uncommitted change,
--   which is what makes this the "armed" state. Then it commits, Session 1 resumes, and the
--   same three queries are re-run afterwards (now visible to everyone) and compared:
--
--     select status, assignment_status, assigned_technician_id,
--            requested_window_start, requested_window_end, requested_duration_minutes
--       from public.service_requests where id = '<request>';
--     select active_job_load from public.technicians where id = '<technician>';
--     select appliance_type, technician_id, is_active, queue_position
--       from public.technician_queue_state order by appliance_type, queue_position;
--
--   And after Session 1 returns `technician_not_eligible`:
--
--     select count(*) from public.bookings where service_request_id = '<request>';
--     -- expect: 0 — the refused attempt created no booking
--     -- and the three queries above are unchanged: the request is still 'quoted' +
--     -- 'accepted' with the same technician and the same window, `active_job_load` is
--     -- untouched, and the rotation is exactly as the attempt found it.
--     --
--     -- Compare against that ARMED snapshot, not the pre-test one: the specialization
--     -- change itself legitimately moves the rotation, and the claim here is only that the
--     -- REFUSED BOOKING left it alone.
--
-- TEST 3 (optional) — A COMMITTED BOOKING, THEN A LATER CHANGE. This one commits the
-- booking, so it leaves a real appointment behind. It is kept separate because its
-- outcome is NOT the defect and must not be read as one.
--
--     -- Session 1
--     begin;
--     select public.create_booking_atomic(...) -> 'outcome';   -- booked, not committed
--     -- Session 2: update public.technicians set specializations = '{}' ...;  (waits)
--     -- Session 1
--     commit;     -- the appointment is now real
--     -- Session 2 resumes and commits its change
--
--   The technician now holds a live appointment for an appliance they are no longer in
--   the queue for. That is a VALID booking followed by a later change, which is a
--   different thing from a booking created for an already-ineligible technician: at the
--   moment it was written the technician was eligible, and no guard can un-write that.
--   Silently cancelling a real customer's appointment would be worse than leaving it, so
--   step 5 deliberately does not — the residual state is the stale-assignment follow-up
--   in section 6, and `npm run audit:bookings` lists exactly these rows so a human
--   decides per case (keep it and let the technician finish, or cancel it through the
--   normal UI). Do NOT delete the row to make a sweep come back clean.
--
-- CLEANUP — restoring the test technician, safely:
--
--   1. BEFORE anything, record the original state (this is what you must put back):
--        select specializations, approved, operational_status
--          from public.technicians where id = '<technician>';
--        select is_active from public.users where id = '<technician>';
--   2. AFTER the tests, restore it exactly:
--        update public.technicians
--           set specializations = array['<original appliance>', ...]
--         where id = '<technician>';
--      The sync trigger reactivates the membership — AT THE END OF THE QUEUE, which is
--      the documented behaviour for a returning technician. That side effect on the
--      rotation is precisely why this runs on a disposable technician in a staging
--      project, never on somebody carrying real work.
--   3. Any appointment TEST 3 committed: cancel it through the normal UI (which releases
--      the slot and returns the request to `quoted`), or leave it for the assigned
--      technician to finish. Never delete it.
--   4. Confirm you are back where you started:
--        select specializations from public.technicians where id = '<technician>';
--        select count(*) from public.bookings where service_request_id = '<request>';
--
--   Afterwards the invariant holds — no live booking whose technician is not in that
--   appliance's queue:
--
--     select count(*)
--       from public.bookings b
--       join public.service_requests r on r.id = b.service_request_id
--      where b.status <> 'cancelled'
--        and public.technician_qualification_failure(b.technician_id, r.appliance_type) is not null;
--     -- expect: 0
--     -- TEST 3 is the one case that can legitimately leave a row here, because it
--     -- committed a valid booking and the change came after. Any OTHER row is a real
--     -- finding: step 5 did not refuse something it should have.
--
-- A read-only sweep for requests that are ALREADY in this state — an accepted
-- assignment whose technician is no longer qualified. Nothing here changes them;
-- they are candidates for the follow-up below:
--
--   select r.id, r.appliance_type, r.assigned_technician_id,
--          public.technician_qualification_failure(r.assigned_technician_id, r.appliance_type) as reason,
--          public.appliance_has_qualified_technician(r.appliance_type) as somebody_else_can_take_it
--     from public.service_requests r
--    where r.assignment_status = 'accepted'
--      and r.status in ('quoted', 'open')
--      and public.technician_qualification_failure(r.assigned_technician_id, r.appliance_type) is not null;


-- =========================================================
-- 6. The follow-up this file deliberately does NOT perform
-- =========================================================
-- A stale assignment now refuses the booking, but it also means the customer cannot
-- book until somebody deals with it: the request stays `accepted` by a technician
-- who can no longer take it, and the queue walk never revisits an accepted request.
--
-- Releasing that assignment (back to `waiting` so the sweep re-offers it to the next
-- eligible technician) is a WORKFLOW decision, not a guard, and it changes rows on a
-- path the customer did not ask for. It belongs in its own migration with its own
-- tests, alongside the admin surface that should be able to trigger it — the read-only
-- sweep above is what that work starts from. Until then the API tells the customer the
-- truth and asks them to contact support, and no false booking is written.
