-- =========================================================
-- Migration: interactive service location + technician route guidance
-- ---------------------------------------------------------
-- WHAT THIS ADDS
--   1. Guarantees the coordinate columns the map needs exist on
--      `service_requests` (they are already declared in supabase/schema.sql;
--      this makes an older live database match).
--   2. Validation for those columns, enforced by the DATABASE and not only by
--      the API: latitude/longitude must be in range, and must be stored as a
--      PAIR (a latitude with no longitude cannot place a marker).
--   3. Narrows the technician SELECT policy on `service_requests` so a
--      technician holding an UNACCEPTED offer can no longer read the customer's
--      precise service location (address + coordinates). Access is granted the
--      moment `assignment_status = 'accepted'` — i.e. only after the assignment
--      has actually been confirmed.
--   4. `technician_pending_offers()` — the narrow, SECURITY DEFINER read path
--      that replaces the old "technician reads the whole request row" query on
--      the offer screens. It returns the fields a technician legitimately needs
--      to decide (appliance, problem, photos, requested window, offer expiry)
--      and NOT the address, the coordinates or any customer identity.
--
-- WHAT THIS DELIBERATELY DOES NOT CHANGE
--   * The fair rotation queue, offer expiry, capacity rules, eligibility and
--     scheduling. No distance, ranking or travel-time logic is introduced —
--     see QUEUE-SYSTEM.md and ARCHITECTURE.md, "Rule 1".
--   * The customer's own access to their request (they still own it), or
--     admin/super_admin access (still covered by the existing policies).
--
-- Safe to run more than once: every statement is guarded, nothing is dropped
-- except the two old policy names this file replaces.
-- =========================================================

-- ---------- 1. Coordinates on the existing service-request table ----------
-- Reused, not duplicated: `location` (address), `latitude`, `longitude` already
-- belong to service_requests, so the selected service location is stored where
-- the rest of the request already lives.
alter table public.service_requests
  add column if not exists location text,
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;

-- ---------- 2a. Drop coordinates that are provably unusable ----------
-- A coordinate pair is the only thing that can place a marker, so a value that
-- is out of range, or a latitude with no longitude, carries no information to
-- lose. Clearing them BEFORE adding the constraints means the constraints can
-- be validated rather than merely declared, and no request row is deleted.
-- (The application never wrote these columns before this feature, so in
-- practice this touches nothing.)
update public.service_requests
   set latitude = null,
       longitude = null
 where (latitude is not null and (latitude < -90 or latitude > 90))
    or (longitude is not null and (longitude < -180 or longitude > 180))
    or ((latitude is null) <> (longitude is null));

-- ---------- 2b. Range + pairing constraints ----------
-- `add constraint ... check` is not idempotent, so each one is guarded.
do $outer$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'service_requests_latitude_range_check'
      and conrelid = 'public.service_requests'::regclass
  ) then
    alter table public.service_requests
      add constraint service_requests_latitude_range_check
      check (latitude is null or (latitude >= -90 and latitude <= 90));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'service_requests_longitude_range_check'
      and conrelid = 'public.service_requests'::regclass
  ) then
    alter table public.service_requests
      add constraint service_requests_longitude_range_check
      check (longitude is null or (longitude >= -180 and longitude <= 180));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'service_requests_coordinates_paired_check'
      and conrelid = 'public.service_requests'::regclass
  ) then
    alter table public.service_requests
      add constraint service_requests_coordinates_paired_check
      check ((latitude is null) = (longitude is null));
  end if;
end
$outer$;

-- ---------- 3. Precise location is for the ASSIGNED technician only ----------
-- The previous policy was
--     assigned_technician_id = auth.uid() or technician_linked_to_request(id)
-- and `assigned_technician_id` is set the moment a request is OFFERED — so a
-- technician who had merely been offered a job could already read the
-- customer's address and coordinates, in the UI and straight from PostgREST.
--
-- The assignment state machine (matching -> offered -> accepted -> waiting) is
-- unchanged; only the read threshold moves to the confirmed state:
--   * `assignment_status = 'accepted'`  -> the technician accepted the offer,
--     so the service location is theirs to see (technician job pages).
--   * `technician_linked_to_request(id)` -> an existing estimate or booking.
--     Estimates can only be created by the accepted technician
--     (see /api/estimates), and a booking always belongs to an assigned job, so
--     this stays a proxy for "actually assigned".
-- Customers keep their own rows, and admins are covered by the separate
-- "customer manages own service requests" policy (`or public.is_admin()`).
drop policy if exists "technicians can view relevant requests" on public.service_requests;
drop policy if exists "technicians can view open/assigned requests" on public.service_requests;
drop policy if exists "technicians can view assigned requests" on public.service_requests;

create policy "technicians can view assigned requests"
  on public.service_requests for select
  using (
    (assignment_status = 'accepted' and assigned_technician_id = auth.uid())
    or public.technician_linked_to_request(id)
  );

-- ---------- 4. The offer screen's narrow read path ----------
-- With the policy above, an offered (not yet accepted) technician can no longer
-- read the request row at all — which is correct, but the offer card still has
-- to be rendered. This SECURITY DEFINER function is the one sanctioned way to
-- read an unaccepted offer, and it returns ONLY the fields needed to decide:
-- appliance, problem, photos, requested window and the offer's expiry.
--
-- It never returns `location`, `latitude` or `longitude`, and it never returns
-- the customer's id, name or contact details — so no amount of client-side
-- tampering can turn it into a location leak. It refuses every caller that is
-- not an authenticated technician, and it can only ever describe the caller's
-- OWN offers.
create or replace function public.technician_pending_offers()
returns table (
  id uuid,
  appliance_type text,
  issue_category text,
  problem_description text,
  photos text[],
  service_type text,
  status public.request_status,
  requested_window_start timestamptz,
  requested_window_end timestamptz,
  requested_duration_minutes integer,
  assignment_status text,
  offers_expires_at timestamptz,
  created_at timestamptz
)
language plpgsql
stable
security definer set search_path = public
as $offer$
declare
  v_uid uuid := auth.uid();
  v_role public.user_role := public.current_role();
begin
  -- `v_role is null` matters: without it a caller with no JWT at all evaluates
  -- `null not in (...)` as NULL and would slip past the guard.
  if v_role is null or v_role::text <> 'technician' then
    raise exception 'technician_pending_offers: only technicians can view their job offers';
  end if;

  return query
  select
    r.id,
    r.appliance_type,
    r.issue_category,
    r.problem_description,
    r.photos,
    r.service_type,
    r.status,
    r.requested_window_start,
    r.requested_window_end,
    r.requested_duration_minutes,
    r.assignment_status,
    r.offers_expires_at,
    r.created_at
  from public.service_requests r
  where r.assigned_technician_id = v_uid
    and r.assignment_status = 'offered'
  order by r.created_at desc;
end;
$offer$;

-- Read-only helper: signed-in roles may call it (non-technicians are refused
-- inside the function), but never anonymously.
revoke all on function public.technician_pending_offers() from public;
grant execute on function public.technician_pending_offers() to authenticated;

-- ---------- 5. Realtime ----------
-- This migration deliberately does NOT add `service_requests` to the
-- `supabase_realtime` publication. Nothing in this repository does: the only
-- client subscriptions are `postgres_changes` on `messages` and
-- `notifications` (src/hooks/useRealtimeMessages.ts, useRealtimeNotifications.ts),
-- and the technician's "new job offer" notification travels on the notifications
-- channel, which carries no address. Enabling Realtime on service_requests would
-- broadcast whole rows — coordinates included — to every subscriber that passes
-- RLS at subscribe time, which is exactly the leak this migration closes.
-- If that publication is ever extended to service_requests, the location columns
-- must be reviewed first.
