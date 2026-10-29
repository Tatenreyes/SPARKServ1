-- =========================================================
-- Migration: RLS + trigger enforcement of the workflow rules (STEP 2 of 2)
-- ---------------------------------------------------------
-- WHY THIS FILE EXISTS
-- The audit found the API routes consistently stricter than the Row Level
-- Security policies underneath them. Every rule below was enforced only in
-- TypeScript, so a client holding the anon key and a valid JWT could call
-- PostgREST directly and break it:
--
--   * `bookings`  INSERT checked only `customer_id = auth.uid()` — a booking
--                 could be created with no estimate, any technician, and
--                 `status = 'completed'`.
--   * `bookings`  UPDATE had no WITH CHECK at all — a customer could set their
--                 own booking to `completed`, or write `final_cost` by hand.
--   * `payments`  INSERT checked only `customer_id = auth.uid()` — a customer
--                 could insert a payment already marked `confirmed` (self
--                 verification) against anybody's booking.
--   * `estimates` INSERT checked only `technician_id = auth.uid()` — a technician
--                 could create a row for ANY request, which also made
--                 `technician_linked_to_request()` true and so exposed that
--                 customer's address and coordinates.
--   * `service_requests` granted customers `for all` — `status`,
--                 `assignment_status` and `assigned_technician_id` were all
--                 writable from the browser.
--
-- THE RULES THIS FILE ENFORCES (confirmed business decisions)
--   1. Completion follows VERIFIED PAYMENT:
--        pending → in_progress → awaiting_inspection → awaiting_payment
--                                                             ↓ customer pays
--                                                             ↓ admin verifies
--                                                        completed
--      Nobody reaches `completed` through a policy or a plain UPDATE. The only
--      writer is `confirm_payment()`, which an administrator invokes and which
--      records the service history in the same transaction.
--   2. A customer may cancel their own booking only BEFORE work starts
--      (`pending`). After that, cancellation is an administrator action or a
--      support request. No fees, no penalties.
--
-- HOW THE ENFORCEMENT IS SPLIT
--   * RLS decides WHICH ROW a caller may touch, and pins the values that must be
--     true of a row they create (`status`, `estimate_id`, ownership).
--   * Triggers decide WHICH TRANSITION and WHICH COLUMNS are legal, because RLS
--     cannot see the OLD row: `USING` sees only the old row and `WITH CHECK` only
--     the new one, so "final_cost may not change" is not expressible in a policy.
--   * `service_role` (the server routes, the cron sweeps, the queue and estimate
--     RPCs, and a direct database session such as the SQL editor) bypasses both,
--     exactly as before. This file weakens no existing control, adds no table and
--     introduces no second status system.
--
-- Requires `migration_booking_payment_status.sql` (the enum value) to be applied
-- first. Safe to re-run: every policy is dropped before it is recreated, every
-- function is `create or replace`, and every trigger is dropped first.
-- =========================================================

-- =========================================================
-- 1. Helpers the policies call
-- =========================================================
-- SECURITY DEFINER, like `technician_linked_to_request()`: a policy on `bookings`
-- that selects from `estimates` would otherwise be filtered by the ESTIMATES
-- policies for the invoking customer, and "the estimate exists" would silently
-- become "the estimate is one this caller may read".

create or replace function public.booking_creation_allowed(
  p_request_id uuid,
  p_estimate_id uuid,
  p_technician_id uuid,
  p_customer_id uuid
)
returns boolean
language sql stable
security definer set search_path = public
as $$
  select exists (
    select 1
    from public.service_requests sr
    join public.estimates e on e.id = p_estimate_id
    where sr.id = p_request_id
      and sr.customer_id = p_customer_id
      and sr.assigned_technician_id = p_technician_id
      and sr.assignment_status = 'accepted'
      and sr.status not in ('cancelled', 'completed')
      and e.service_request_id = sr.id
      and e.technician_id = p_technician_id
      and e.status = 'accepted'
      and e.superseded_by is null
  );
$$;

-- Does this request already have a live booking? Keeps a customer from writing
-- `status = 'booked'` on a request with nothing booked.
create or replace function public.request_has_live_booking(p_request_id uuid)
returns boolean
language sql stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.bookings b
    where b.service_request_id = p_request_id
      and b.status <> 'cancelled'
  );
$$;
-- =========================================================
-- 2. bookings — creation is gated on the CURRENT approved estimate
-- =========================================================

drop policy if exists "customer creates booking from own request" on public.bookings;

-- A customer's booking must name the approved version they reviewed, for the
-- request that is actually assigned to that technician, and it must start as
-- `pending`. Before this, `estimate_id` could be null (no approval at all) and
-- `status` could be anything, including 'completed'.
create policy "customer creates booking from own request"
  on public.bookings for insert
  with check (
    customer_id = auth.uid()
    and status = 'pending'
    and estimate_id is not null
    and public.booking_creation_allowed(
      service_request_id, estimate_id, technician_id, customer_id
    )
  );

-- Administrative scheduling is a separate, trusted concern (the
-- `require_approved_estimate_for_booking` trigger deliberately leaves a booking
-- with no estimate alone), so staff keep an explicit policy rather than having to
-- invent an estimate to book a slot by hand.
drop policy if exists "admin creates bookings" on public.bookings;
create policy "admin creates bookings"
  on public.bookings for insert
  with check (public.is_admin());

-- =========================================================
-- 3. bookings — the transition matrix
-- =========================================================
-- `participants update their bookings` had no WITH CHECK, so RLS let a
-- participant write any column and any status. RLS still decides which row; the
-- trigger below decides what may change on it.

drop policy if exists "participants update their bookings" on public.bookings;
create policy "participants update their bookings"
  on public.bookings for update
  using (customer_id = auth.uid() or technician_id = auth.uid() or public.is_admin())
  with check (
    customer_id = auth.uid() or technician_id = auth.uid() or public.is_admin()
  );

create or replace function public.enforce_booking_update_rules()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_role public.user_role;
  v_staff boolean;
begin
  -- Trusted server paths keep full control: the service-role client used by the
  -- API routes, the cron sweeps, the queue RPCs and confirm_payment().
  if coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role' then
    return new;
  end if;

  -- A direct database session is trusted too: the SQL editor, psql, a migration,
  -- or the PGlite harness. This is NOT an HTTP hole — PostgREST always sets the
  -- role claim from the JWT, so a request from the browser arrives with it set
  -- ('anon' or 'authenticated') and never reaches this branch.
  if current_setting('request.jwt.claim.role', true) is null and auth.uid() is null then
    return new;
  end if;

  if v_actor is null then
    raise exception 'A booking can only be changed by its customer, its technician or an administrator';
  end if;

  v_role := public.current_role();
  v_staff := v_role in ('admin', 'super_admin');

  if not v_staff and old.customer_id <> v_actor and old.technician_id <> v_actor then
    raise exception 'A booking can only be changed by its customer, its technician or an administrator';
  end if;

  -- Identity and schedule are set by the workflow, never by hand. Rescheduling and
  -- reassignment are their own reviewed workflows (a later batch): until then,
  -- moving an appointment is a cancellation plus a new booking.
  if new.customer_id is distinct from old.customer_id
     or new.service_request_id is distinct from old.service_request_id
     or new.technician_id is distinct from old.technician_id
     or new.estimate_id is distinct from old.estimate_id
     or new.scheduled_at is distinct from old.scheduled_at
     or new.duration_minutes is distinct from old.duration_minutes then
    raise exception 'A booking''s customer, request, technician, estimate and appointment time are fixed by the booking workflow';
  end if;

  if old.status = 'completed' then
    raise exception 'A completed repair is final and cannot be edited';
  end if;


  if v_staff then
    -- Staff drive the repair forward and may cancel, but they may NOT attest the
    -- customer's inspection and they may NOT complete: completion is the verified
    -- payment, an administrator decision made through confirm_payment().
    if new.status is distinct from old.status
       and not (
         (old.status = 'pending' and new.status = 'in_progress')
         or (old.status = 'in_progress' and new.status = 'awaiting_inspection')
         or new.status = 'cancelled'
       ) then
      raise exception 'Invalid booking transition for an administrator: % -> %', old.status, new.status;
    end if;
    return new;
  end if;

  if v_role = 'technician' then
    if new.status is distinct from old.status
       and not (
         (old.status = 'pending' and new.status = 'in_progress')
         or (old.status = 'in_progress' and new.status = 'awaiting_inspection')
       ) then
      raise exception 'Invalid booking transition for the technician: % -> %', old.status, new.status;
    end if;

    if new.inspection_confirmed_at is distinct from old.inspection_confirmed_at
       or new.inspection_note is distinct from old.inspection_note then
      raise exception 'Only the customer signs off their own inspection';
    end if;
    return new;
  end if;

  -- The customer on this booking.
  if new.final_cost is distinct from old.final_cost then
    raise exception 'Only the technician or an administrator records the final cost';
  end if;

  if new.status is distinct from old.status
     and not (
       -- Decision 2: cancel before the work starts. Once the repair is under way,
       -- cancellation is a staff action or a support request.
       (old.status = 'pending' and new.status = 'cancelled')
       -- Decision 1: a satisfactory inspection advances to the payment step. It
       -- does NOT complete the repair, and it must carry the written attestation
       -- that service_history archives.
       or (
         old.status = 'awaiting_inspection'
         and new.status = 'awaiting_payment'
         and coalesce(btrim(new.inspection_note), '') <> ''
       )
     ) then
    raise exception 'Invalid booking transition for the customer: % -> %', old.status, new.status;
  end if;

  -- The sign-off timestamp is the database's, not the caller's: the route sends its
  -- own, and this keeps a hand-written request from back-dating the attestation that
  -- service_history archives. Never overwrite an existing one.
  if old.status = 'awaiting_inspection' and new.status = 'awaiting_payment' then
    new.inspection_confirmed_at := coalesce(old.inspection_confirmed_at, now());
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_booking_update_rules on public.bookings;
create trigger enforce_booking_update_rules
  before update on public.bookings
  for each row execute procedure public.enforce_booking_update_rules();

-- =========================================================
-- 3b. Cancelling a booking returns its request to "ready to book"
-- =========================================================
-- `POST /api/bookings` accepts only a request in `quoted` or `open`, so a request
-- left at `booked` with a cancelled booking could never be booked again — the
-- customer would have to raise a NEW request and lose both the approved estimate
-- and the technician who accepted the job. This keeps the two rows consistent
-- instead: when the last live booking goes away, the request reopens.
--
-- What is deliberately NOT touched: `assignment_status` and
-- `assigned_technician_id` (the technician keeps the job they accepted, so no queue
-- turn is re-spent — the turn was consumed at acceptance and a cancellation never
-- refunds or re-charges one), the approved estimate (still the current version, so
-- the customer re-books the price they agreed to), and the cancelled booking row
-- itself (it stays as history).
--
-- AFTER UPDATE and not restricted to a role: whoever cancels a booking — the
-- customer, an administrator, or a server route — the request ends in the same
-- state.

create or replace function public.reopen_request_after_booking_cancel()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    -- Only when nothing else still holds the request: a duplicate live booking
    -- (possible until the booking-uniqueness work lands) must keep it booked.
    if not exists (
      select 1 from public.bookings b
      where b.service_request_id = new.service_request_id
        and b.id <> new.id
        and b.status <> 'cancelled'
    ) then
      update public.service_requests
         set status = 'quoted', updated_at = now()
       where id = new.service_request_id
         and status = 'booked';
    end if;
  end if;

  return null;
end;
$$;

drop trigger if exists reopen_request_after_booking_cancel on public.bookings;
create trigger reopen_request_after_booking_cancel
  after update on public.bookings
  for each row execute procedure public.reopen_request_after_booking_cancel();

-- =========================================================
-- 4. payments — submission can never be verification
-- =========================================================
-- The old policy was `with check (customer_id = auth.uid())`, which allowed a
-- customer to insert a payment already marked `confirmed` (self-verification),
-- with any amount, against anybody's booking. Verification is an administrator
-- action; the row a customer may create is pinned to `pending_verification` and to
-- the exact amount the booking records.

drop policy if exists "customer submits own payment" on public.payments;
create policy "customer submits own payment"
  on public.payments for insert
  with check (
    customer_id = auth.uid()
    and status = 'pending_verification'
    and confirmed_by is null
    and confirmed_at is null
    and amount > 0
    and exists (
      select 1 from public.bookings b
      where b.id = payments.booking_id
        and b.customer_id = auth.uid()
        and b.final_cost is not null
        and payments.amount = b.final_cost
        and (
          -- The normal path: the customer accepted the inspection, so the repair
          -- is waiting for this payment.
          b.status = 'awaiting_payment'
          -- A booking completed under the pre-verification policy may still owe
          -- its reference. Accepting it does not re-open a closed repair, and the
          -- duplicate guard stops a second payment for the same booking.
          or (
            b.status = 'completed'
            and not exists (
              select 1 from public.payments p
              where p.booking_id = b.id and p.status = 'confirmed'
            )
          )
        )
    )
  );

-- =========================================================
-- 5. estimates — a technician may only quote their OWN accepted request
-- =========================================================
-- The old policy checked `technician_id = auth.uid()` and nothing else, so any
-- technician could insert an estimate row for any request id. That was not only a
-- forged quote: `technician_linked_to_request()` returns true for a technician
-- with any estimate on the request, so it also unlocked the customer's address and
-- coordinates in the service_requests read policy — the exact disclosure
-- migration_service_location.sql exists to prevent.

drop policy if exists "technician creates own estimates" on public.estimates;
create policy "technician creates own estimates"
  on public.estimates for insert
  with check (
    technician_id = auth.uid()
    and status in ('draft', 'pending')
    and superseded_by is null
    and exists (
      select 1 from public.service_requests sr
      where sr.id = estimates.service_request_id
        and sr.assigned_technician_id = auth.uid()
        and sr.assignment_status = 'accepted'
        and sr.status not in ('cancelled', 'completed')
    )
  );

-- =========================================================
-- 6. service_requests — a customer owns the row, not the queue state
-- =========================================================
-- `for all` let a customer rewrite `assignment_status`, `assigned_technician_id`
-- and `status` on their own request from the browser: they could claim to be
-- assigned, mark themselves booked with nothing booked, or close a request the
-- queue still holds. Ownership is split into one policy per command, and a trigger
-- pins the columns that belong to the assignment engine.

drop policy if exists "customer manages own service requests" on public.service_requests;

drop policy if exists "customer creates own service requests" on public.service_requests;
create policy "customer creates own service requests"
  on public.service_requests for insert
  with check (customer_id = auth.uid());

drop policy if exists "customer reads own service requests" on public.service_requests;
create policy "customer reads own service requests"
  on public.service_requests for select
  using (customer_id = auth.uid() or public.is_admin());

drop policy if exists "customer updates own service requests" on public.service_requests;
create policy "customer updates own service requests"
  on public.service_requests for update
  using (customer_id = auth.uid() or public.is_admin())
  with check (customer_id = auth.uid() or public.is_admin());

create or replace function public.enforce_service_request_customer_update()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role' then
    return new;
  end if;

  -- Direct database session (SQL editor, psql, the harness): trusted, and never
  -- reachable over HTTP — see the note in enforce_booking_update_rules().
  if current_setting('request.jwt.claim.role', true) is null and auth.uid() is null then
    return new;
  end if;

  -- Staff are trusted here, as before.
  if public.is_admin() then
    return new;
  end if;

  -- The assignment engine owns these columns: assign_technician_to_request(),
  -- respond_to_offer(), lapse_offer() and the admin override all write them as
  -- service_role. A customer must never be able to say "this is mine and I am
  -- assigned to it".
  if new.assignment_status is distinct from old.assignment_status
     or new.assigned_technician_id is distinct from old.assigned_technician_id
     or new.offers_expires_at is distinct from old.offers_expires_at
     or new.customer_id is distinct from old.customer_id then
    raise exception 'The queue assignment of a request is changed by the assignment engine, not by the customer';
  end if;

  if old.status in ('cancelled', 'completed') and new.status is distinct from old.status then
    raise exception 'A closed request is final';
  end if;

  -- What a customer may move a request's status to — three transitions, no more:
  --   * `booked`    — they just booked the appointment this request now has;
  --   * `quoted`    — their last live booking was cancelled, so the request is back
  --                   to "ready to book". This is the transition
  --                   reopen_request_after_booking_cancel() performs, and it has to
  --                   be permitted here because that trigger runs in the cancelling
  --                   user's session (the definer rights bypass RLS, not triggers);
  --   * `cancelled` — they are abandoning the request, which is only coherent while
  --                   nothing is booked on it: with a live booking they cancel the
  --                   BOOKING (while it is still `pending`), which reopens the
  --                   request first. After the repair has started, cancellation is
  --                   an administrator action or a support request.
  -- `completed` is written only when a verified payment closes the booking.
  if new.status is distinct from old.status
     and not (
       (new.status = 'booked' and public.request_has_live_booking(new.id))
       or (
         new.status = 'quoted'
         and old.status = 'booked'
         and not public.request_has_live_booking(new.id)
       )
       or (new.status = 'cancelled' and not public.request_has_live_booking(new.id))
     ) then
    raise exception 'A customer may book, re-book or cancel an unstarted request, not set it to %', new.status;
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_service_request_customer_update on public.service_requests;
create trigger enforce_service_request_customer_update
  before update on public.service_requests
  for each row execute procedure public.enforce_service_request_customer_update();

-- =========================================================
-- 7. confirm_payment() — the ONLY path to a completed repair
-- =========================================================
-- One transaction: verify the payment, close the booking, archive the service
-- history, close the request and free the technician's slot. Doing this in the API
-- route would be four independent writes that can half-fail, and it would leave
-- "completed" reachable by anything that can update `bookings`.
--
-- Returns jsonb so the caller can distinguish outcomes without parsing errors:
--   confirmed         — verified, booking completed (completed_now = true)
--   confirmed_legacy  — verified on a booking already completed before this policy
--   not_pending       — already verified or rejected; changes nothing (idempotent)
--   booking_cancelled — the appointment was cancelled while the reference was
--                       waiting; the payment is left pending for the administrator
--                       to reject, and no repair is closed
--
-- Everything is validated BEFORE the payment is written, so an outcome that does
-- not close a repair leaves the payment exactly as it was found.

create or replace function public.confirm_payment(p_payment_id uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  r public.payments%rowtype;
  b public.bookings%rowtype;
  v_role public.user_role;
  v_tech public.technicians%rowtype;
  v_completed integer;
begin
  -- The verifier's role is re-read from the database, never trusted from a claim
  -- (the same rule decide_estimate() follows).
  select u.role into v_role from public.users u where u.id = p_actor;
  if v_role is null or v_role not in ('admin', 'super_admin') then
    raise exception 'confirm_payment: only an administrator can verify a payment';
  end if;

  select * into r from public.payments where id = p_payment_id for update;
  if r.id is null then
    raise exception 'confirm_payment: payment % not found', p_payment_id;
  end if;

  if r.status <> 'pending_verification' then
    return jsonb_build_object(
      'outcome', 'not_pending',
      'payment_id', r.id,
      'payment_status', r.status
    );
  end if;

  -- The booking is read and validated FIRST: every outcome below that does not close
  -- a repair must leave the payment untouched, so nothing is written until the state
  -- machine has agreed.
  select * into b from public.bookings where id = r.booking_id for update;
  if b.id is null then
    raise exception 'confirm_payment: booking % not found', r.booking_id;
  end if;

  -- A booking already completed before this policy existed: verify the reference and
  -- stop. Re-running completion would rewrite history.
  if b.status = 'completed' then
    update public.payments
       set status = 'confirmed',
           confirmed_by = p_actor,
           confirmed_at = now()
     where id = r.id;

    return jsonb_build_object(
      'outcome', 'confirmed_legacy',
      'payment_id', r.id,
      'payment_status', 'confirmed',
      'booking_id', b.id,
      'booking_status', b.status,
      'completed_now', false
    );
  end if;

  -- The appointment was cancelled while the reference was waiting (the customer
  -- cancelled, or an administrator did). There is no repair left to close, so the
  -- payment stays pending for the administrator to reject — silently confirming it
  -- would record money against a job that no longer exists.
  if b.status = 'cancelled' then
    return jsonb_build_object(
      'outcome', 'booking_cancelled',
      'payment_id', r.id,
      'payment_status', r.status,
      'booking_id', b.id,
      'booking_status', b.status,
      'completed_now', false
    );
  end if;

  if b.status <> 'awaiting_payment' then
    raise exception 'confirm_payment: booking % is %, not awaiting payment', b.id, b.status;
  end if;

  update public.payments
     set status = 'confirmed',
         confirmed_by = p_actor,
         confirmed_at = now()
   where id = r.id;


  update public.bookings
     set status = 'completed',
         inspection_confirmed_at = coalesce(b.inspection_confirmed_at, now()),
         updated_at = now()
   where id = b.id;

  -- The archive row the old customer-driven completion wrote, with the same
  -- summary wording. `on conflict do nothing` keeps it a no-op for a booking that
  -- already has one (service_history.booking_id is UNIQUE).
  insert into public.service_history (
    booking_id, customer_id, technician_id, appliance_type, final_cost, summary
  )
  values (
    b.id,
    b.customer_id,
    b.technician_id,
    coalesce(
      (select sr.appliance_type from public.service_requests sr where sr.id = b.service_request_id),
      'unknown'
    ),
    b.final_cost,
    case
      when b.inspection_note is not null
        then 'Repair completed. Customer inspection: ' || b.inspection_note
      else 'Repair completed.'
    end
  )
  on conflict (booking_id) do nothing;

  update public.service_requests
     set status = 'completed', updated_at = now()
   where id = b.service_request_id
     and status <> 'cancelled';

  -- Free the technician's slot and count the finished job. Done here, with definer
  -- rights, because the actor is an administrator rather than the customer who used
  -- to trigger completion — and because a customer must never be able to write the
  -- technicians table.
  select * into v_tech from public.technicians where id = b.technician_id for update;
  if v_tech.id is not null then
    v_completed := v_tech.jobs_completed + 1;
    update public.technicians
       set active_job_load = greatest(0, v_tech.active_job_load - 1),
           jobs_completed = v_completed,
           is_new = v_completed < 5
     where id = v_tech.id;

    perform public.refresh_technician_operational_status(v_tech.id);
  end if;

  return jsonb_build_object(
    'outcome', 'confirmed',
    'payment_id', r.id,
    'payment_status', 'confirmed',
    'booking_id', b.id,
    'booking_status', 'completed',
    'completed_now', true
  );
end;
$$;

-- =========================================================
-- 8. Permissions
-- =========================================================
-- Verification is server-only: revoked from anon/authenticated and granted to
-- service_role, exactly like submit_estimate() and decide_estimate(). The two
-- policy helpers stay executable by authenticated, because a policy runs as the
-- invoking user and would otherwise fail to evaluate.

revoke all on function public.confirm_payment(uuid, uuid) from public, anon, authenticated;
grant execute on function public.confirm_payment(uuid, uuid) to service_role;

revoke all on function public.booking_creation_allowed(uuid, uuid, uuid, uuid) from anon;
grant execute on function public.booking_creation_allowed(uuid, uuid, uuid, uuid) to authenticated, service_role;

revoke all on function public.request_has_live_booking(uuid) from anon;
grant execute on function public.request_has_live_booking(uuid) to authenticated, service_role;

-- =========================================================
-- 9. Verify (run these in the SQL editor after applying)
-- =========================================================
-- The enum value exists:
--
--   select unnest(enum_range(null::public.booking_status));
--   -- expect: pending, in_progress, completed, cancelled, awaiting_inspection,
--   --         awaiting_payment
--
-- The verification function exists with definer rights:
--
--   select p.proname, p.prosecdef
--   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
--   where n.nspname = 'public' and p.proname = 'confirm_payment';
--
-- The enforced policies are the ones installed (expect 4 on bookings, 3 on
-- service_requests, 1 on payments, 1 on estimates):
--
--   select tablename, policyname, cmd
--   from pg_policies
--   where schemaname = 'public'
--     and tablename in ('bookings', 'payments', 'estimates', 'service_requests')
--   order by tablename, policyname;
--
-- The triggers are installed:
--
--   select t.tgname, c.relname
--   from pg_trigger t join pg_class c on c.oid = t.tgrelid
--   where not t.tgisinternal and c.relname in ('bookings', 'service_requests');


