-- Run this in the Supabase SQL Editor against your existing project.
-- Adds: multi-visit progress tracking, GCash payment verification flow,
-- and ticket type/priority. Nothing here touches existing tables' data.

-- ========== VISITS (multi-visit progress tracking) ==========

create type visit_status as enum ('upcoming', 'in_progress', 'completed');

create table public.visits (
  id uuid primary key default uuid_generate_v4(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  visit_number int not null,
  title text not null,
  description text,
  status visit_status not null default 'upcoming',
  scheduled_at timestamptz,
  technician_id uuid not null references public.users(id),
  notes text,
  photo_urls text[] not null default '{}',
  signed_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (booking_id, visit_number)
);

alter table public.visits enable row level security;

create policy "relevant users view visits"
  on public.visits for select
  using (
    technician_id = auth.uid()
    or public.is_admin()
    or exists (
      select 1 from public.bookings b
      where b.id = visits.booking_id and b.customer_id = auth.uid()
    )
  );

create policy "technician manages own visits"
  on public.visits for all
  using (technician_id = auth.uid() or public.is_admin())
  with check (technician_id = auth.uid() or public.is_admin());

create index idx_visits_booking on public.visits(booking_id);
create index idx_visits_technician on public.visits(technician_id);

-- ========== PAYMENTS (GCash reference + admin verification) ==========
-- Per re-defense feedback: only the CUSTOMER may submit a payment reference.
-- The technician never touches payment records — enforced both in RLS
-- (insert policy checks customer_id = auth.uid()) and in the app's API route.

create type payment_status as enum ('pending_verification', 'confirmed', 'rejected');

create table public.payments (
  id uuid primary key default uuid_generate_v4(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  customer_id uuid not null references public.users(id),
  payment_method text not null default 'gcash',
  gcash_reference text not null,
  amount numeric(10, 2) not null,
  status payment_status not null default 'pending_verification',
  payment_date timestamptz not null default now(),
  confirmed_by uuid references public.users(id),
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.payments enable row level security;

create policy "customer submits own payment"
  on public.payments for insert
  with check (customer_id = auth.uid());

create policy "customer and admin view payments"
  on public.payments for select
  using (customer_id = auth.uid() or public.is_admin());

create index idx_payments_booking on public.payments(booking_id);
create index idx_payments_customer on public.payments(customer_id);

-- ========== SUPPORT TICKETS: type + priority ==========

create type ticket_type as enum ('product_inquiry', 'billing_inquiry', 'technical_issue', 'other');
create type ticket_priority as enum ('low', 'medium', 'high', 'critical');

alter table public.support_tickets
  add column type ticket_type not null default 'other',
  add column priority ticket_priority not null default 'medium';
