-- =========================================================
-- Migration: appliance-centric service request flow
-- =========================================================

-- Extend appliances with richer fields
alter table public.appliances
  add column if not exists appliance_type text not null default 'refrigerator',
  add column if not exists brand text,
  add column if not exists model_number text,
  add column if not exists serial_number text,
  add column if not exists purchase_date date,
  add column if not exists warranty_status text not null default 'unknown' check (warranty_status in ('yes', 'no', 'unknown')),
  add column if not exists warranty_type text,
  add column if not exists warranty_expiry_date date,
  add column if not exists warranty_proof_url text,
  add column if not exists notes text;

-- Recreate service_requests around appliance_id instead of free-text appliance_type
create table public.service_requests_new (
  id uuid primary key default uuid_generate_v4(),
  customer_id uuid not null references public.users(id) on delete cascade,
  appliance_id uuid references public.appliances(id) on delete set null,
  appliance_type text not null,
  issue_category text,
  problem_description text not null,
  photos text[] not null default '{}',
  service_type text not null default 'repair',
  status request_status not null default 'open',
  chatbot_resolved boolean not null default false,
  location text,
  latitude double precision,
  longitude double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.service_requests_new enable row level security;

create policy "customer manages own service requests"
  on public.service_requests_new for all
  using (customer_id = auth.uid() or public.is_admin())
  with check (customer_id = auth.uid() or public.is_admin());

create policy "technicians can view relevant requests"
  on public.service_requests_new for select
  using (
    exists (
      select 1 from public.estimates e
      where e.service_request_id = service_requests_new.id and e.technician_id = auth.uid()
    )
    or exists (
      select 1 from public.bookings b
      where b.service_request_id = service_requests_new.id and b.technician_id = auth.uid()
    )
    or public.technician_linked_to_request(id)
  );

create index idx_service_requests_customer on public.service_requests_new(customer_id);
create index idx_service_requests_status on public.service_requests_new(status);

-- Migrate data if old table exists
do $$
begin
  if exists (select 1 from information_schema.tables where table_name = 'service_requests' and table_schema = 'public') then
    insert into public.service_requests_new (id, customer_id, appliance_id, problem_description, status, chatbot_resolved, created_at, updated_at)
    select id, customer_id, null, issue_description, status, chatbot_resolved, created_at, updated_at
    from public.service_requests;
  end if;
end $$;

drop table if exists public.service_requests cascade;
alter table public.service_requests_new rename to service_requests;

create index if not exists idx_service_requests_customer on public.service_requests(customer_id);
create index if not exists idx_service_requests_status on public.service_requests(status);
