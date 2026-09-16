-- =========================================================
-- SPARKServ — Supabase Postgres schema
-- Run this in Supabase SQL Editor (Project > SQL Editor > New query)
-- =========================================================

-- ---------- Extensions ----------
create extension if not exists "uuid-ossp";

-- ---------- Enums ----------
create type user_role as enum ('customer', 'technician', 'admin', 'super_admin');
create type request_status as enum ('open', 'quoted', 'booked', 'in_progress', 'completed', 'cancelled');
create type booking_status as enum ('pending', 'in_progress', 'completed', 'cancelled');
create type estimate_status as enum ('pending', 'accepted', 'rejected');

-- =========================================================
-- users  — mirrors auth.users, holds app-level profile + role
-- =========================================================
create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null,
  email text not null unique,
  role user_role not null default 'customer',
  phone text,
  location text,
  latitude double precision,
  longitude double precision,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- =========================================================
-- technicians — extra profile fields, 1:1 with users where role = technician
-- =========================================================
create table public.technicians (
  id uuid primary key references public.users(id) on delete cascade,
  specializations text[] not null default '{}',   -- e.g. {'refrigerator','washing_machine'}
  experience_years numeric not null default 0,
  rating numeric not null default 0,               -- 0.0 - 5.0, normalized average
  availability boolean not null default true,
  is_new boolean not null default true,            -- flips false after first 5 jobs / 30 days
  active_job_load integer not null default 0,       -- current concurrent jobs
  jobs_completed integer not null default 0,
  approved boolean not null default false,          -- admin must approve before visible to customers
  approved_at timestamptz,
  approved_by uuid references public.users(id),
  created_at timestamptz not null default now()
);

-- =========================================================
-- service_requests — customer's initial appliance issue submission
-- =========================================================
create table public.service_requests (
  id uuid primary key default uuid_generate_v4(),
  customer_id uuid not null references public.users(id) on delete cascade,
  appliance_type text not null,
  issue_description text not null,
  location text not null,
  latitude double precision,
  longitude double precision,
  status request_status not null default 'open',
  chatbot_resolved boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =========================================================
-- estimates — technician's proposed cost for a service_request
-- =========================================================
create table public.estimates (
  id uuid primary key default uuid_generate_v4(),
  service_request_id uuid not null references public.service_requests(id) on delete cascade,
  technician_id uuid not null references public.technicians(id) on delete cascade,
  estimated_cost numeric(10, 2) not null,
  notes text,
  status estimate_status not null default 'pending',
  created_at timestamptz not null default now()
);

-- =========================================================
-- bookings — confirmed job once customer accepts an estimate
-- =========================================================
create table public.bookings (
  id uuid primary key default uuid_generate_v4(),
  service_request_id uuid not null references public.service_requests(id) on delete cascade,
  estimate_id uuid references public.estimates(id),
  customer_id uuid not null references public.users(id) on delete cascade,
  technician_id uuid not null references public.technicians(id) on delete cascade,
  scheduled_at timestamptz not null,
  status booking_status not null default 'pending',
  final_cost numeric(10, 2),
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =========================================================
-- messages — simple chat scoped to a booking
-- =========================================================
create table public.messages (
  id uuid primary key default uuid_generate_v4(),
  booking_id uuid not null references public.bookings(id) on delete cascade,
  sender_id uuid not null references public.users(id) on delete cascade,
  receiver_id uuid not null references public.users(id) on delete cascade,
  content text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

-- =========================================================
-- ratings — customer feedback after a completed booking
-- =========================================================
create table public.ratings (
  id uuid primary key default uuid_generate_v4(),
  booking_id uuid not null unique references public.bookings(id) on delete cascade,
  customer_id uuid not null references public.users(id) on delete cascade,
  technician_id uuid not null references public.technicians(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  comment text,
  created_at timestamptz not null default now()
);

-- =========================================================
-- service_history — archived record of a completed booking
-- =========================================================
create table public.service_history (
  id uuid primary key default uuid_generate_v4(),
  booking_id uuid not null unique references public.bookings(id) on delete cascade,
  customer_id uuid not null references public.users(id) on delete cascade,
  technician_id uuid not null references public.technicians(id) on delete cascade,
  appliance_type text not null,
  final_cost numeric(10, 2),
  completed_at timestamptz not null default now(),
  summary text
);

-- ---------- Indexes ----------
create index idx_service_requests_customer on public.service_requests(customer_id);
create index idx_service_requests_status on public.service_requests(status);
create index idx_estimates_request on public.estimates(service_request_id);
create index idx_bookings_customer on public.bookings(customer_id);
create index idx_bookings_technician on public.bookings(technician_id);
create index idx_messages_booking on public.messages(booking_id);
create index idx_technicians_approved on public.technicians(approved, availability);

-- =========================================================
-- Trigger: auto-create a public.users row when someone signs up via Supabase Auth
-- Role and name are passed through user_metadata at signUp() time.
-- =========================================================
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, name, email, role)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.email,
    case
      when new.raw_user_meta_data->>'role' in ('customer', 'technician')
        then (new.raw_user_meta_data->>'role')::user_role
      else 'customer'::user_role
    end
  );

  -- if they signed up as a technician, seed their technicians row too
  if coalesce(new.raw_user_meta_data->>'role', 'customer') = 'technician' then
    insert into public.technicians (id) values (new.id);
  end if;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- =========================================================
-- Row Level Security
-- =========================================================
alter table public.users enable row level security;
alter table public.technicians enable row level security;
alter table public.service_requests enable row level security;
alter table public.estimates enable row level security;
alter table public.bookings enable row level security;
alter table public.messages enable row level security;
alter table public.ratings enable row level security;
alter table public.service_history enable row level security;

-- Helper: read the caller's role without recursive RLS lookups
create or replace function public.current_role()
returns user_role
language sql stable
security definer set search_path = public
as $$
  select role from public.users where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql stable
security definer set search_path = public
as $$
  select public.current_role() in ('admin', 'super_admin');
$$;

-- ---------- users ----------
create policy "users can view their own profile"
  on public.users for select
  using (id = auth.uid() or public.is_admin());

create policy "users can update their own profile"
  on public.users for update
  using (id = auth.uid());

create or replace function public.prevent_role_change()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if new.role is distinct from old.role
    and coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
    and not public.is_admin() then
    raise exception 'Only an administrator can change user roles';
  end if;
  return new;
end;
$$;

create trigger protect_user_role
  before update on public.users
  for each row execute procedure public.prevent_role_change();

-- technicians need to be visible (name/email) to customers browsing recommendations
create policy "authenticated users can view technician-role profiles"
  on public.users for select
  using (role = 'technician');

-- ---------- technicians ----------
create policy "anyone authenticated can view approved technicians"
  on public.technicians for select
  using (approved = true or id = auth.uid() or public.is_admin());

create policy "technician can update own profile"
  on public.technicians for update
  using (id = auth.uid());

create policy "admin can update any technician (approval)"
  on public.technicians for update
  using (public.is_admin());

create policy "technician row created via signup trigger or admin"
  on public.technicians for insert
  with check (id = auth.uid() or public.is_admin());

-- ---------- service_requests ----------
create policy "customer manages own service requests"
  on public.service_requests for all
  using (customer_id = auth.uid() or public.is_admin())
  with check (customer_id = auth.uid() or public.is_admin());

create policy "technicians can view open/assigned requests"
  on public.service_requests for select
  using (
    status = 'open'
    or exists (
      select 1 from public.estimates e
      where e.service_request_id = service_requests.id and e.technician_id = auth.uid()
    )
    or exists (
      select 1 from public.bookings b
      where b.service_request_id = service_requests.id and b.technician_id = auth.uid()
    )
  );

-- ---------- estimates ----------
create policy "technician creates own estimates"
  on public.estimates for insert
  with check (technician_id = auth.uid());

create policy "technician updates own estimates"
  on public.estimates for update
  using (technician_id = auth.uid());

create policy "customer and technician view relevant estimates"
  on public.estimates for select
  using (
    technician_id = auth.uid()
    or public.is_admin()
    or exists (
      select 1 from public.service_requests sr
      where sr.id = estimates.service_request_id and sr.customer_id = auth.uid()
    )
  );

-- ---------- bookings ----------
create policy "participants view their bookings"
  on public.bookings for select
  using (customer_id = auth.uid() or technician_id = auth.uid() or public.is_admin());

create policy "customer creates booking from own request"
  on public.bookings for insert
  with check (customer_id = auth.uid());

create policy "participants update their bookings"
  on public.bookings for update
  using (customer_id = auth.uid() or technician_id = auth.uid() or public.is_admin());

-- ---------- messages ----------
create policy "participants view booking messages"
  on public.messages for select
  using (
    sender_id = auth.uid() or receiver_id = auth.uid() or public.is_admin()
  );

create policy "participants send messages on their bookings"
  on public.messages for insert
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.bookings b
      where b.id = messages.booking_id
        and (b.customer_id = auth.uid() or b.technician_id = auth.uid())
    )
  );

-- ---------- ratings ----------
create policy "customer creates rating for own completed booking"
  on public.ratings for insert
  with check (customer_id = auth.uid());

create policy "relevant users view ratings"
  on public.ratings for select
  using (customer_id = auth.uid() or technician_id = auth.uid() or public.is_admin() or true);
  -- ratings are shown publicly on technician profiles; tighten `or true` if you want it private

-- ---------- service_history ----------
create policy "relevant users view service history"
  on public.service_history for select
  using (customer_id = auth.uid() or technician_id = auth.uid() or public.is_admin());

create policy "system inserts service history"
  on public.service_history for insert
  with check (customer_id = auth.uid() or technician_id = auth.uid() or public.is_admin());

-- =========================================================
-- The block below was added after the initial release (see
-- migration_appliances_tickets.sql) — included here too so a fresh
-- install only has to run one file.
-- =========================================================

create type ticket_status as enum ('open', 'in_progress', 'resolved', 'closed');

create table public.appliances (
  id uuid primary key default uuid_generate_v4(),
  customer_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  appliance_type text not null,
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

-- =========================================================
-- The block below was added after the initial release (see
-- migration_visits_payments.sql) — included here too so a fresh
-- install only has to run one file.
-- =========================================================

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

create type ticket_type as enum ('product_inquiry', 'billing_inquiry', 'technical_issue', 'other');
create type ticket_priority as enum ('low', 'medium', 'high', 'critical');

alter table public.support_tickets
  add column type ticket_type not null default 'other',
  add column priority ticket_priority not null default 'medium';

-- =========================================================
-- Added after initial release (see migration_system_settings.sql) —
-- included here too so a fresh install only needs one file.
-- =========================================================

create table public.system_settings (
  key text primary key,
  value text not null default '',
  updated_at timestamptz not null default now(),
  updated_by uuid references public.users(id)
);

alter table public.system_settings enable row level security;

create policy "anyone can read settings"
  on public.system_settings for select
  using (true);

create policy "admins manage settings"
  on public.system_settings for all
  using (public.is_admin())
  with check (public.is_admin());

insert into public.system_settings (key, value) values
  ('maintenance_mode', 'false'),
  ('platform_announcement', '');

-- =========================================================
-- Added after initial release (see migration_profile_photos.sql) —
-- included here too so a fresh install only needs one file.
-- =========================================================

alter table public.users add column if not exists avatar_url text;

insert into storage.buckets (id, name, public)
values ('profile-photos', 'profile-photos', true)
on conflict (id) do update set public = true;

create policy "profile photos are publicly readable"
  on storage.objects for select
  using (bucket_id = 'profile-photos');

create policy "users can upload their profile photo"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'profile-photos' and (storage.foldername(name))[1] = (select auth.uid()::text));

-- =========================================================
-- Added after initial release (see migration_security_hardening.sql) —
-- strengthens the "users can update own profile" policy with an
-- explicit WITH CHECK. Supersedes the weaker version above.
-- =========================================================

drop policy if exists "users can update their own profile" on public.users;
create policy "users can update their own profile"
  on public.users for update
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- =========================================================
-- RLS recursion fix (applied live in Supabase previously, never
-- captured in this file). The original "technicians can view
-- open/assigned requests" policy does raw cross-table subqueries
-- directly in USING, which caused "infinite recursion detected in
-- policy for relation service_requests" in production. This replaces
-- it with a SECURITY DEFINER function, which bypasses RLS internally
-- and breaks the recursion cycle.
-- =========================================================

create or replace function public.technician_linked_to_request(request_id uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from estimates e
    where e.service_request_id = request_id and e.technician_id = auth.uid()
  ) or exists (
    select 1 from bookings b
    where b.service_request_id = request_id and b.technician_id = auth.uid()
  );
$$;

drop policy if exists "technicians can view open/assigned requests" on public.service_requests;

-- =========================================================
-- Added after initial release (see migration_technician_queue.sql) —
-- fair ROTATION-based technician queue per appliance type (not a
-- rating/experience score — see file comments for the exact model).
-- =========================================================

alter table public.service_requests
  add column if not exists assigned_technician_id uuid references public.users(id),
  add column if not exists assignment_status text not null default 'matching'
    check (assignment_status in ('matching', 'offered', 'accepted', 'waiting'));

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

create policy "technicians can view open/assigned requests"
  on public.service_requests for select
  using (
    assigned_technician_id = auth.uid() or public.technician_linked_to_request(id)
  );

alter type booking_status add value if not exists 'awaiting_inspection';
-- Run this in the Supabase SQL Editor. Adds in-app notifications (bell icon,
-- real-time) and stored browser push subscriptions (so notifications can
-- reach a user even when the SPARKServ tab is closed).

create table public.notifications (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  type text not null,
  title text not null,
  body text,
  link text,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

alter table public.notifications enable row level security;

create policy "user views own notifications"
  on public.notifications for select
  using (user_id = auth.uid() or public.is_admin());

create policy "user marks own notifications read"
  on public.notifications for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Inserts always happen server-side via the service-role client (a
-- notification is a system event, not something a user creates directly).
create policy "admin manages notifications"
  on public.notifications for all
  using (public.is_admin())
  with check (public.is_admin());

create index idx_notifications_user on public.notifications(user_id, created_at desc);
create index idx_notifications_unread on public.notifications(user_id) where read = false;

create table public.push_subscriptions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.users(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

alter table public.push_subscriptions enable row level security;

create policy "user manages own push subscriptions"
  on public.push_subscriptions for all
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());

create index idx_push_subscriptions_user on public.push_subscriptions(user_id);

