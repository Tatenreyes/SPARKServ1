-- =========================================================
-- Migration: appliance-centric service request flow
-- ---------------------------------------------------------
-- ⚠️ HISTORICAL. `supabase/schema.sql` is now the canonical single-file
-- install and already describes service_requests in its appliance-centric
-- shape (appliance_id, problem_description, photos, service_type, plus the
-- queue-assignment columns). Only run this file against a database that was
-- created from an *older* schema.sql.
--
-- It is guarded below: if service_requests already has problem_description,
-- the whole migration is skipped. Re-running it on a current database would
-- otherwise recreate the table without assigned_technician_id /
-- assignment_status / offers_expires_at and silently break the assignment
-- engine.
-- =========================================================

-- Defined outside the DO block below: nesting a dollar-quoted function body
-- inside a dollar-quoted DO block would need conflicting delimiters.
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

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'service_requests'
      and column_name = 'problem_description'
  ) then
    raise notice 'service_requests is already appliance-centric — skipping migration.';
    return;
  end if;

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

  -- Rebuild service_requests around appliance_id instead of free-text
  -- appliance_type. The assignment columns are carried over explicitly so the
  -- rotation queue keeps working after the swap.
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
    assigned_technician_id uuid references public.users(id),
    assignment_status text not null default 'matching'
      check (assignment_status in ('matching', 'offered', 'accepted', 'waiting')),
    offers_expires_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  alter table public.service_requests_new enable row level security;

  create policy "customer manages own service requests"
    on public.service_requests_new for all
    using (customer_id = auth.uid() or public.is_admin())
    with check (customer_id = auth.uid() or public.is_admin());

  -- Uses the SECURITY DEFINER helper rather than raw cross-table subqueries,
  -- which is what caused "infinite recursion detected in policy for relation
  -- service_requests" in production.
  create policy "technicians can view relevant requests"
    on public.service_requests_new for select
    using (
      assigned_technician_id = auth.uid()
      or public.technician_linked_to_request(id)
    );

  create index idx_service_requests_customer on public.service_requests_new(customer_id);
  create index idx_service_requests_status on public.service_requests_new(status);


  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'service_requests'
      and column_name = 'assigned_technician_id'
  ) then
    insert into public.service_requests_new (
      id, customer_id, appliance_id, appliance_type, problem_description,
      status, chatbot_resolved, assigned_technician_id, assignment_status,
      created_at, updated_at
    )
    select
      id, customer_id, null, appliance_type, issue_description,
      status, chatbot_resolved, assigned_technician_id, assignment_status,
      created_at, updated_at
    from public.service_requests;
  else
    insert into public.service_requests_new (
      id, customer_id, appliance_id, appliance_type, problem_description,
      status, chatbot_resolved, assignment_status, created_at, updated_at
    )
    select
      id, customer_id, null, appliance_type, issue_description,
      status, chatbot_resolved, 'matching', created_at, updated_at
    from public.service_requests;
  end if;

  drop table public.service_requests cascade;
  alter table public.service_requests_new rename to service_requests;

  create index if not exists idx_service_requests_customer on public.service_requests(customer_id);
  create index if not exists idx_service_requests_status on public.service_requests(status);
end $$;
