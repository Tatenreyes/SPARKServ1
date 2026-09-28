-- =========================================================
-- Migration: assignment flow hardening
-- ---------------------------------------------------------
-- Adds:
--   1. Offer expiry (offers_expires_at) so an ignored job offer can never
--      leave a request stuck in "offered" forever.
--   2. A partial unique index guaranteeing a technician can hold at most
--      one *active* offer at a time (closes the read->write race in
--      lib/assignment.ts).
--   3. Inspection confirmation on bookings (the customer signs off that the
--      repair actually works before a job is closed).
--   4. A non-recursive technician SELECT policy, using the SECURITY DEFINER
--      helper instead of raw cross-table subqueries.
--
-- Safe to run more than once (every statement is guarded).
-- =========================================================

-- ---------- 1. Offer expiry ----------
alter table public.service_requests
  add column if not exists offers_expires_at timestamptz;

create index if not exists idx_service_requests_offer_expiry
  on public.service_requests (offers_expires_at)
  where assignment_status = 'offered';

-- ---------- 2. One active offer per technician ----------
-- A technician may only ever be "offered" one job at a time. Combined with
-- the conditional UPDATE in lib/assignment.ts this makes double-offering a
-- hard error instead of a silent last-write-wins.
create unique index if not exists uniq_active_offer_per_technician
  on public.service_requests (assigned_technician_id)
  where assignment_status = 'offered' and assigned_technician_id is not null;

-- ---------- 3. Inspection confirmation ----------
alter table public.bookings
  add column if not exists inspection_confirmed_at timestamptz,
  add column if not exists inspection_note text;

-- ---------- 4. Non-recursive technician request visibility ----------
-- The helper is declared here as well as in schema.sql, because none of the
-- other migration files define it — they only *use* it. A database built from
-- migrations alone would otherwise fail on the policy below with
-- "function public.technician_linked_to_request(uuid) does not exist".
create or replace function public.technician_linked_to_request(request_id uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.estimates e
    where e.service_request_id = request_id and e.technician_id = auth.uid()
  ) or exists (
    select 1 from public.bookings b
    where b.service_request_id = request_id and b.technician_id = auth.uid()
  );
$$;

-- Uses the SECURITY DEFINER helper rather than raw cross-table subqueries, so
-- the policy never triggers "infinite recursion detected in policy for
-- relation service_requests" the way a raw subquery does.
drop policy if exists "technicians can view relevant requests" on public.service_requests;

drop policy if exists "technicians can view open/assigned requests" on public.service_requests;

create policy "technicians can view open/assigned requests"
  on public.service_requests for select
  using (
    assigned_technician_id = auth.uid() or public.technician_linked_to_request(id)
  );

-- ---------- Convenience: expire an offer ----------
-- Marks the pending offer as rejected in history (so the same technician is
-- never re-offered this request) and clears the assignment so the API layer
-- can immediately re-run assignTechnician().
create or replace function public.expire_offer(request_id uuid)
returns void
language sql
security definer set search_path = public
as $$
  update public.technician_offer_history
    set status = 'rejected', reason = coalesce(reason, 'Offer expired')
    where service_request_id = request_id and status = 'offered';

  update public.service_requests
    set assigned_technician_id = null,
        assignment_status = 'matching',
        offers_expires_at = null,
        updated_at = now()
    where id = request_id and assignment_status = 'offered';
$$;
