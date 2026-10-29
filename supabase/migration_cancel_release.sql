-- =========================================================
-- Migration: atomic cancellation release (step 18)
-- ---------------------------------------------------------
-- WHY THIS FILE EXISTS
-- The counter half of a cancellation was the last part of the booking lifecycle
-- still owned by a route. `create_booking_atomic()` moved
-- `technicians.active_job_load` inside the database (step 15), but the RELEASE
-- happened after the fact:
--
--     PATCH /api/bookings/:id
--       1. update bookings set status = 'cancelled'    -- one transaction
--       2. rpc release_technician_slot(technician)     -- a SECOND transaction,
--                                                      -- whose failure was logged
--                                                      -- and then swallowed
--
-- Two failures followed from that:
--
--   * if the second call failed — a network error, a PostgREST 5xx, a revoked
--     grant, the function missing — the booking was cancelled, the request was
--     reopened by `reopen_request_after_booking_cancel`, and the technician's load
--     stayed inflated for good. Nothing reconciles it, because the counter is not
--     derivable from the booking rows: there is no "released" flag to compare
--     against, so a wrong value is indistinguishable from a right one.
--   * any cancellation that did NOT go through that route — an administrator in the
--     SQL editor, a service-role script, a future server action — decremented
--     nothing at all.
--
-- The request half of a cancellation has been a trigger since Batch 1
-- (`reopen_request_after_booking_cancel`, AFTER UPDATE on `bookings`). This file
-- makes the counter half symmetric: the same event, in the same transaction, from
-- every writer.
--
-- WHAT THIS FILE DOES
--   1. `booking_status_holds_slot()` — the slot-holding vocabulary in ONE place:
--      which booking statuses have a technician's slot reserved. Read-only,
--      reusable, and it is also the object `db:check` probes, because a trigger
--      function returning `trigger` is not reachable through PostgREST.
--   2. `release_slot_after_booking_cancel()` — the AFTER UPDATE trigger function.
--      On the transition into `cancelled` from a slot-holding status it calls the
--      existing `release_technician_slot()` primitive and then
--      `refresh_technician_operational_status()`, both inside the cancelling
--      transaction. A failure in either aborts the cancellation with it.
--   3. The trigger itself, dropped before it is created, so the file is idempotent.
--   4. Permissions: the predicate is service-role only, like every other predicate
--      in this schema. NO table privilege is granted to any role, and
--      `release_technician_slot()` keeps the grants step 15 gave it — the trigger
--      calls it as the function owner, which is exactly why widening that grant is
--      neither necessary nor done.
--
-- WHY A TRIGGER AND NOT AN ATOMIC CANCELLATION RPC
--   An RPC would close the route's window and leave the second failure open: a
--   cancellation written by anybody else would still decrement nothing. A trigger
--   closes both, and it mirrors the trigger that already owns the request half. The
--   route keeps its authorization and status restrictions; only the counter stops
--   being its business.
--
-- WHAT DELIBERATELY DOES NOT CHANGE
--   * `confirm_payment()` — completion is a different transition
--     (`awaiting_payment -> completed`) and keeps its own decrement, together with
--     `jobs_completed` and the `service_history` row. The trigger here fires only
--     for `-> cancelled`, so the two can never both fire for one booking.
--   * The transition matrix (`enforce_booking_update_rules`, BEFORE UPDATE) and the
--     request-reopening trigger (`reopen_request_after_booking_cancel`, AFTER
--     UPDATE): untouched. The release deliberately does NOT depend on the matrix
--     having run — a service-role writer bypasses it entirely (it returns early for
--     that role), and this guard is about the booking's own status transition, not
--     about who was allowed to make it.
--   * `technician_queue_state` — a cancellation does not re-rotate the queue
--     (QUEUE-SYSTEM.md §18-§20): the turn was spent when the technician ACCEPTED.
--     The release touches `technicians` only.
--   * The booking row, the request, the assignment, the approved estimate and the
--     cancelled booking's history: untouched. `reopen_request_after_booking_cancel`
--     still owns the request side.
--
-- Idempotent: both functions are `create or replace`, the trigger is dropped before
-- it is created, and the permission block only revokes and grants. Re-running is a
-- no-op.
-- =========================================================


-- =========================================================
-- 1. The slot-holding vocabulary, in one place
-- =========================================================
-- A booking holds a technician's slot from the moment `create_booking_atomic()`
-- writes it until that slot is given back. There are exactly two ways out:
--
--   * cancelled  -> this file (the trigger in section 3)
--   * completed  -> `confirm_payment()`, which frees the slot as it closes the job
--
-- So `completed` and `cancelled` hold nothing: a cancelled booking gave its slot
-- back when it was cancelled, and a completed one gave it back when it was
-- completed. That is what stops a `completed -> cancelled` write — which the
-- transition matrix permits for staff today, see section 5 — from releasing a
-- second time and driving the counter below the number of live jobs.
--
-- `stable` rather than `immutable`: the answer is fixed for a given value, but this is a
-- lookup in a vocabulary, not a computation, and a folded constant would be the wrong
-- shape if the vocabulary ever grows.
--
-- It takes TEXT, like every other predicate in this schema
-- (`technician_qualification_failure(uuid, text)`, `appliance_has_qualified_technician(text)`),
-- and the caller passes `status::text`. That is deliberate on two counts:
--
--   * a literal coerced to the enum type would make THIS definition fail to load when it
--     is created in the same transaction that adds `awaiting_inspection` /
--     `awaiting_payment` to the type — which is exactly what a fresh install does
--     (`schema.sql` adds both values and defines this function inside one transaction).
--     The harness caught that before it could reach a deployment;
--   * an enum-typed argument is one more thing `db:check` has to be able to see through
--     PostgREST's OpenAPI document, and this function IS step 18's presence signal. A
--     text argument cannot be mis-mapped.
create or replace function public.booking_status_holds_slot(p_status text)
returns boolean
language sql
stable
as $$
  select p_status in ('pending', 'in_progress', 'awaiting_inspection', 'awaiting_payment');
$$;


-- =========================================================
-- 2. The release, as an AFTER UPDATE trigger function
-- =========================================================
-- AFTER, not BEFORE: the release must run inside the same transaction as the status
-- change but only once the row change is real, and if either call below raises, the
-- whole statement — the cancellation included — is rolled back. That is the atomicity
-- this file exists for: there is no window in which the booking is cancelled and the
-- counter is not released, or the other way round.
--
-- The transition test (`old.status is distinct from 'cancelled'`) is what makes the
-- release idempotent per booking: a second cancellation write, a retried PATCH, or an
-- unrelated `updated_at` touch on an already-cancelled row finds the guard false and
-- releases nothing. It is the same shape `reopen_request_after_booking_cancel` uses.
--
-- SECURITY DEFINER is required, not decorative: the trigger fires in the cancelling
-- user's session (a customer cancelling their own appointment over PostgREST), and
-- that user has no UPDATE on `technicians`. The definer context is what lets the
-- database do the two writes the customer is not allowed to do themselves — the same
-- reason the request-reopening trigger can write `service_requests` for them.
create or replace function public.release_slot_after_booking_cancel()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  if new.status = 'cancelled'
     and old.status is distinct from 'cancelled'
     and public.booking_status_holds_slot(old.status::text) then
    -- OLD, not NEW, and that is the whole point of this block.
    --
    -- The slot was attributed by `create_booking_atomic()` to the technician the
    -- booking was assigned to when it was written, so OLD is the technician holding
    -- it. The two are the same in every application path —
    -- `enforce_booking_update_rules` pins `technician_id` as immutable for every
    -- client role, and the column is NOT NULL — but they are NOT the same for a
    -- trusted writer, which the matrix deliberately lets through (it returns early
    -- for the service role and for a direct database session). Releasing NEW would
    -- then decrement a technician whose counter never took the +1 and leave the real
    -- one inflated: the same defect this file closes, reached from the other side.
    --
    -- There is no null case to guard: `bookings.technician_id` is NOT NULL (asserted
    -- in group 27 of the SQL suite), so an early return on NEW — or on OLD — could
    -- only ever skip a release that was genuinely owed. `release_technician_slot()`
    -- tolerates a null argument regardless.
    --
    -- The shared primitive from step 15: one statement, floored at zero, so two
    -- cancellations for one technician cannot undo each other.
    perform public.release_technician_slot(old.technician_id);

    -- The cached status is derived from booking ROWS (compute_technician_status),
    -- so the cancellation that just happened is exactly the input that changed. It is
    -- refreshed for the technician whose slot was released — the same technician, for
    -- the same reason.
    perform public.refresh_technician_operational_status(old.technician_id);
  end if;

  return null;
end;
$$;


-- =========================================================
-- 3. The trigger
-- =========================================================
-- AFTER UPDATE, for every row, and it touches `technicians` only: the request side
-- stays with `reopen_request_after_booking_cancel` (also AFTER UPDATE, disjoint
-- table, so the order the two fire in is irrelevant and nothing here depends on it).
drop trigger if exists release_slot_after_booking_cancel on public.bookings;
create trigger release_slot_after_booking_cancel
  after update on public.bookings
  for each row execute procedure public.release_slot_after_booking_cancel();


-- =========================================================
-- 4. Permissions
-- =========================================================
-- The predicate reveals nothing about any row, but it is a queue-engine concept, so
-- it follows the same boundary as every other predicate in this schema: server-side
-- only. That is also what makes it visible to `db:check`, which discovers functions
-- from PostgREST's OpenAPI document.
revoke all on function public.booking_status_holds_slot(text)
  from public, anon, authenticated;
grant execute on function public.booking_status_holds_slot(text)
  to service_role;

-- The trigger function is not callable as an RPC (a `returns trigger` function can
-- only run as a trigger), and it is revoked anyway so nobody can try.
revoke all on function public.release_slot_after_booking_cancel() from public, anon, authenticated;

-- `release_technician_slot()` and `refresh_technician_operational_status()` keep the
-- grants they already had. The trigger calls them as the function owner, which has
-- EXECUTE as the owner — widening either grant to make the trigger work would be a
-- privilege change this fix does not need.


-- =========================================================
-- 5. Verify (run these in the SQL editor after applying)
-- =========================================================
-- The predicate answers for the whole vocabulary (four true, two false):
--
--   select s.status::text,
--          public.booking_status_holds_slot(s.status::text) as holds_a_slot
--     from unnest(enum_range(null::public.booking_status)) as s(status);
--   -- expect: pending/in_progress/awaiting_inspection/awaiting_payment -> true
--   --         completed/cancelled                                     -> false
--
-- The trigger is installed, AFTER UPDATE, on bookings:
--
--   select t.tgname, pg_get_triggerdef(t.oid)
--     from pg_trigger t join pg_class c on c.oid = t.tgrelid
--    where c.relname = 'bookings' and not t.tgisinternal
--    order by t.tgname;
--   -- expect five: enforce_booking_update_rules (BEFORE UPDATE),
--   --              reopen_request_after_booking_cancel (AFTER UPDATE),
--   --              release_slot_after_booking_cancel (AFTER UPDATE),
--   --              require_approved_estimate_for_booking (BEFORE INSERT),
--   --              trg_booking_no_overlap (BEFORE INSERT)
--
-- The assignment is fixed, which is what lets the release trust OLD. The column cannot
-- be cleared, and the transition matrix pins it for every client role:
--
--   select is_nullable from information_schema.columns
--    where table_schema = 'public' and table_name = 'bookings'
--      and column_name = 'technician_id';
--   -- expect: NO
--
--   select position('new.technician_id is distinct from old.technician_id'
--                   in pg_get_functiondef('public.enforce_booking_update_rules()'::regprocedure)) > 0
--            as assignment_is_pinned;
--   -- expect: true — and that check runs BEFORE every role branch, so it applies to the
--   --         customer, the technician, an administrator and a super admin alike. Only a
--   --         trusted writer (service role, direct session) can move a booking to another
--   --         technician, and that is the case the trigger's OLD/OLD calls are written for.
--
-- The predicate is service-role only; the release primitive's grants are unchanged:
--
--   select has_function_privilege('authenticated',
--            'public.booking_status_holds_slot(text)', 'EXECUTE') as authenticated_can,
--          has_function_privilege('service_role',
--            'public.booking_status_holds_slot(text)', 'EXECUTE') as service_role_can,
--          has_function_privilege('authenticated',
--            'public.release_technician_slot(uuid)', 'EXECUTE') as release_authenticated_can;
--   -- expect: false, true, false
--
-- The cancellation and its release are one transaction. Rolled back, so it changes
-- nothing — the counter must move down by one inside the transaction and be back
-- where it started afterwards:
--
--   select active_job_load from public.technicians where id = '<technician>';
--   begin;
--     update public.bookings set status = 'cancelled' where id = '<live-booking>';
--     select active_job_load from public.technicians where id = '<technician>';
--     -- expect: one lower
--   rollback;
--   select active_job_load from public.technicians where id = '<technician>';
--   -- expect: the original value
--
-- A cancelled booking releases once. Running the same statement twice inside one
-- transaction must leave the counter one lower, not two:
--
--   begin;
--     update public.bookings set status = 'cancelled' where id = '<live-booking>';
--     update public.bookings set status = 'cancelled' where id = '<live-booking>';
--     update public.bookings set updated_at = now() where id = '<live-booking>';
--     select active_job_load from public.technicians where id = '<technician>';
--     -- expect: exactly one lower than it started
--   rollback;
--
-- READ-ONLY: rows written before this file. The counter cannot be reconciled from
-- the data (there is no "released" flag), so this only NAMES the drift; it changes
-- nothing and it is not a repair. Compare the counter against the live bookings:
--
--   select t.id, u.name, t.active_job_load,
--          (select count(*) from public.bookings b
--            where b.technician_id = t.id
--              and public.booking_status_holds_slot(b.status::text)) as live_bookings
--     from public.technicians t
--     join public.users u on u.id = t.id
--    where t.active_job_load <> (select count(*) from public.bookings b
--                                 where b.technician_id = t.id
--                                   and public.booking_status_holds_slot(b.status::text));
--   -- expect: zero rows once the counter is consistent. Rows here are the historical
--   --         cancellation-release gap (or a legitimate legacy difference) — decide
--   --         per case; do NOT decrement blindly, and do not let this file rewrite
--   --         live rows.
--
-- A TWO-SESSION TEST lives in TESTING.md §1 ("What group 27 cannot prove"): two
-- concurrent cancellations for one technician, and a cancellation racing a payment
-- completion. PGlite is a single connection, so the test suite can only prove the
-- mechanism, never the blocking.


-- =========================================================
-- 6. The follow-up this file deliberately does NOT perform
-- =========================================================
-- An earlier draft of this file claimed that `enforce_booking_update_rules` lets STAFF
-- move a booking to `cancelled` from any status, including `completed`. Re-reading the
-- function, that was wrong, and the correction changes what is actually left to do:
--
--   * the `completed` guard sits BEFORE every role branch — `if old.status = 'completed'
--     then raise exception 'A completed repair is final and cannot be edited'` — so
--     `completed -> cancelled` is refused for the customer, the technician, an
--     administrator and a super admin alike. Group 27 asserts it with an
--     administrator's own session;
--   * what the staff branch does allow is `any OTHER status -> cancelled`, which is the
--     documented staff power rather than a hole;
--   * the only writer that can still cancel a completed booking is a TRUSTED one — the
--     service role or a direct database session — because the matrix returns early for
--     both by design ("Trusted server paths keep full control"). No application path
--     does that, and none should.
--
-- So the transition-policy question is narrower than it first looked: not a hole in the
-- API, but the documented trust boundary for server-side writers. What this file
-- guarantees regardless is that the COUNTER is unaffected either way — `completed` is
-- not a slot-holding status, so a trusted `completed -> cancelled` write releases
-- nothing, and `confirm_payment()` already freed that slot.
--
-- What such a write would still leave behind is a `cancelled` booking for a repair that
-- was completed and archived in `service_history`. Whether `completed` should be terminal
-- even for a trusted writer is a transition-policy decision, so it stays a separate,
-- tracked follow-up instead of being bundled into this counter fix.
