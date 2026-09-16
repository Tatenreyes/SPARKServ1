-- Run this in the Supabase SQL Editor.
--
-- Replaces customer-facing technician selection with a fair, rotation-based
-- queue per appliance type — NOT a rating/experience-weighted score. Every
-- qualified, approved technician for a given appliance type has a position
-- in that type's queue based on when they last accepted a job of that type
-- (never-assigned technicians are at the very front). Accepting a job removes
-- a technician from that type's queue until the job is no longer active;
-- they rejoin at the back once it clears. This is deliberately independent
-- of rating/experience so a new technician gets real opportunities.

alter table public.service_requests
  add column if not exists assigned_technician_id uuid references public.users(id),
  add column if not exists assignment_status text not null default 'matching'
    check (assignment_status in ('matching', 'offered', 'accepted', 'waiting'));

-- One row per (technician, appliance type) they're qualified for. Tracks
-- when they last ACCEPTED a job of that type — this is the queue-ordering
-- key. A missing row (never assigned) sorts first, i.e. front of the queue.
create table public.technician_queue_state (
  technician_id uuid not null references public.users(id),
  appliance_type text not null,
  last_assigned_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (technician_id, appliance_type)
);

alter table public.technician_queue_state enable row level security;

create policy "technician views own queue position"
  on public.technician_queue_state for select
  using (technician_id = auth.uid() or public.is_admin());

create policy "admin manages queue state"
  on public.technician_queue_state for all
  using (public.is_admin())
  with check (public.is_admin());

-- Offer/accept/reject history per request — prevents re-offering a request
-- to a technician who already turned it down.
create table public.technician_offer_history (
  id uuid primary key default uuid_generate_v4(),
  service_request_id uuid not null references public.service_requests(id) on delete cascade,
  technician_id uuid not null references public.users(id),
  status text not null check (status in ('offered', 'accepted', 'rejected')),
  reason text,
  created_at timestamptz not null default now()
);

alter table public.technician_offer_history enable row level security;

create policy "technician views own offer history"
  on public.technician_offer_history for select
  using (technician_id = auth.uid() or public.is_admin());

create policy "admin manages offer history"
  on public.technician_offer_history for all
  using (public.is_admin())
  with check (public.is_admin());

create index idx_offer_history_request on public.technician_offer_history(service_request_id);
create index idx_offer_history_technician on public.technician_offer_history(technician_id);
create index idx_service_requests_assignment_status on public.service_requests(assignment_status);
create index idx_queue_state_appliance on public.technician_queue_state(appliance_type, last_assigned_at);

-- Technicians no longer browse all open requests (that model is replaced by
-- the queue) — they only see requests specifically assigned to them, plus
-- the existing estimate/booking-linked visibility.
create policy "technicians can view open/assigned requests"
  on public.service_requests for select
  using (
    assigned_technician_id = auth.uid() or public.technician_linked_to_request(id)
  );

-- Customer inspection before payment: an intermediate booking status between
-- a technician finishing the visible/physical repair and it actually closing.
alter type booking_status add value if not exists 'awaiting_inspection';
