-- =========================================================
-- SPARKServ — migration: appliances + support_tickets
-- Run this in Supabase SQL Editor AFTER the original schema.sql.
-- Safe to run once; does not touch existing tables/data.
-- =========================================================

create type ticket_status as enum ('open', 'in_progress', 'resolved', 'closed');

-- =========================================================
-- appliances — a customer's owned appliances, referenced by service_requests
-- =========================================================
create table public.appliances (
  id uuid primary key default uuid_generate_v4(),
  customer_id uuid not null references public.users(id) on delete cascade,
  name text not null,               -- e.g. "Kitchen refrigerator"
  appliance_type text not null,      -- e.g. "refrigerator" — matches service_requests.appliance_type
  brand text,
  model text,
  purchase_date date,
  notes text,
  created_at timestamptz not null default now()
);

alter table public.appliances enable row level security;

create policy "customer manages own appliances"
  on public.appliances for all
  using (customer_id = auth.uid() or public.is_admin())
  with check (customer_id = auth.uid() or public.is_admin());

create index idx_appliances_customer on public.appliances(customer_id);

-- =========================================================
-- support_tickets — general help requests, separate from repair service_requests
-- =========================================================
create table public.support_tickets (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  subject text not null,
  message text not null,
  status ticket_status not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.support_tickets enable row level security;

create policy "user manages own tickets"
  on public.support_tickets for all
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

create index idx_support_tickets_user on public.support_tickets(user_id);
create index idx_support_tickets_status on public.support_tickets(status);
