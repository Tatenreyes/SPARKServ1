-- =========================================================
-- SPARKServ — Supabase Postgres schema
-- Run this in Supabase SQL Editor (Project > SQL Editor > New query)
-- =========================================================

-- ---------- Extensions ----------
create extension if not exists "uuid-ossp";

-- ---------- Enums ----------
create type user_role as enum ('customer', 'technician', 'admin', 'super_admin');
create type request_status as enum ('open', 'quoted', 'booked', 'in_progress', 'completed', 'cancelled');
create type booking_status as enum ('pending', 'in_progress', 'completed', 'cancelled', 'awaiting_payment');
-- Estimate lifecycle. `pending` = awaiting the customer's decision, `accepted` =
-- approved, `rejected` = declined; `draft` is the technician's unsubmitted working
-- copy (invisible to the customer), `revision_requested` means the customer asked
-- for a change, and `superseded` marks a version replaced by a newer one.
create type estimate_status as enum (
  'draft', 'pending', 'revision_requested', 'accepted', 'rejected', 'superseded'
);

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
-- appliances — a customer's registered appliances. service_requests.appliance_id
-- points here, so this table must exist first.
-- =========================================================
create table public.appliances (
  id uuid primary key default uuid_generate_v4(),
  customer_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  appliance_type text not null,
  brand text,
  model text,
  model_number text,
  serial_number text,
  purchase_date date,
  warranty_status text not null default 'unknown'
    check (warranty_status in ('yes', 'no', 'unknown')),
  warranty_type text,
  warranty_expiry_date date,
  warranty_proof_url text,
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
-- service_requests — customer's initial appliance issue submission.
-- Appliance-centric: the request points at a row in appliances rather than
-- carrying free-text appliance fields, and carries the queue-assignment
-- columns the rotation engine (src/lib/assignment.ts) writes to.
-- =========================================================
create table public.service_requests (
  id uuid primary key default uuid_generate_v4(),
  customer_id uuid not null references public.users(id) on delete cascade,
  appliance_id uuid references public.appliances(id) on delete set null,
  appliance_type text not null,
  issue_category text,
  -- The canonical issue the customer identified (a stable id from
  -- src/lib/appliance-issues.ts), plus what they reported after the optional
  -- preliminary checks. Both are NULLABLE: a request is valid without an
  -- identified issue, and no outcome is required. See
  -- supabase/migration_troubleshooting.sql.
  issue_id text,
  troubleshooting_outcome text
    constraint service_requests_troubleshooting_outcome_check
    check (
      troubleshooting_outcome is null
      or troubleshooting_outcome in ('resolved', 'unresolved', 'skipped')
    ),
  problem_description text not null,
  photos text[] not null default '{}',
  service_type text not null default 'repair',
  status request_status not null default 'open',
  chatbot_resolved boolean not null default false,
  location text,
  -- Service location selected on the customer's map (see src/lib/geo.ts).
  -- Stored as a PAIR and range-checked in the database as well as in the API,
  -- so an out-of-range coordinate can never be persisted by any client.
  -- Named explicitly so a fresh install and a database upgraded by
  -- migration_service_location.sql end up with identical constraints.
  latitude double precision
    constraint service_requests_latitude_range_check
    check (latitude is null or (latitude >= -90 and latitude <= 90)),
  longitude double precision
    constraint service_requests_longitude_range_check
    check (longitude is null or (longitude >= -180 and longitude <= 180)),
  constraint service_requests_coordinates_paired_check
    check ((latitude is null) = (longitude is null)),
  -- Fair-rotation assignment (see migration_technician_queue.sql)
  assigned_technician_id uuid references public.users(id),
  assignment_status text not null default 'matching'
    check (assignment_status in ('matching', 'offered', 'accepted', 'waiting')),
  -- When the current offer lapses. Set by the assignment engine; powers
  -- /api/cron/assignment-tick so an ignored offer can't strand a request.
  offers_expires_at timestamptz,
  -- The time the customer asked for. The queue can only reason about "is this
  -- technician free then" if the request actually carries the window; added by
  -- migration_queue_redesign.sql and kept here so a fresh install matches an
  -- upgraded database.
  requested_window_start timestamptz,
  requested_window_end timestamptz,
  requested_duration_minutes integer,
  constraint service_requests_requested_window_check
    check (
      requested_window_end is null
      or requested_window_start is null
      or requested_window_end > requested_window_start
    ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =========================================================
-- estimates — technician's proposed cost for a service_request
--
-- Itemized (labour / parts / additional charges) and VERSIONED: a revised quote
-- is a new row, so the version the customer reviewed is never overwritten.
-- `estimated_cost` stays the authoritative total and is constraint-checked to
-- equal the itemized sum, so a browser-supplied total can never disagree.
-- The lifecycle (submit / approve / decline / request a revision) is applied by
-- submit_estimate()/decide_estimate() in
-- supabase/migration_estimate_workflow.sql — the only writers of these rows.
-- =========================================================
create table public.estimates (
  id uuid primary key default uuid_generate_v4(),
  service_request_id uuid not null references public.service_requests(id) on delete cascade,
  technician_id uuid not null references public.technicians(id) on delete cascade,
  -- Derived from labor_cost + parts_cost + other_cost (see the check below).
  estimated_cost numeric(10, 2) not null,
  notes text,
  status estimate_status not null default 'pending',
  -- What the technician proposes to do, and the itemized charges.
  scope text,
  labor_cost numeric(10, 2) not null default 0,
  parts_cost numeric(10, 2) not null default 0,
  other_cost numeric(10, 2) not null default 0,
  -- Required whenever other_cost > 0, so an additional charge is never vague.
  other_description text,
  -- Version history: `supersedes_id` points at the version this one replaces,
  -- `superseded_by` at the version that replaced it.
  version integer not null default 1,
  supersedes_id uuid references public.estimates(id),
  superseded_by uuid references public.estimates(id),
  -- The decision record. `approved_at` is set once on approval and NEVER cleared,
  -- so the approval survives being superseded by a later revision.
  revision_reason text,
  revision_requested_at timestamptz,
  decision_note text,
  submitted_at timestamptz,
  decided_at timestamptz,
  decided_by uuid references public.users(id),
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint estimates_amounts_check
    check (
      labor_cost >= 0 and parts_cost >= 0 and other_cost >= 0 and estimated_cost >= 0
      and estimated_cost = round(labor_cost + parts_cost + other_cost, 2)
    ),
  constraint estimates_other_description_check
    check (other_cost = 0 or (other_description is not null and btrim(other_description) <> '')),
  constraint estimates_version_check check (version >= 1)
);

-- One working version and one approved version per request; superseded rows are
-- the history and are deliberately unconstrained.
create unique index if not exists uniq_live_estimate_per_request
  on public.estimates (service_request_id)
  where status in ('draft', 'pending', 'revision_requested');

create unique index if not exists uniq_approved_estimate_per_request
  on public.estimates (service_request_id)
  where status = 'accepted';

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
  -- How long the appointment occupies the technician, used by the overlapping-
  -- appointment guard and the technician's daily-hours limit. Added by
  -- migration_queue_redesign.sql; kept here so a fresh install from this file alone
  -- matches an upgraded database.
  duration_minutes integer not null default 120,
  status booking_status not null default 'pending',
  final_cost numeric(10, 2),
  -- Set when the customer signs off that the repair actually works. Closing a
  -- job is the customer's attestation, so it carries their note as evidence.
  inspection_confirmed_at timestamptz,
  inspection_note text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- A booking may name only the CURRENT approved estimate (a booking with no
-- estimate is left alone — administrative scheduling is a separate concern).
-- Declared after `bookings` exists, since it is a trigger on that table.
create or replace function public.require_approved_estimate_for_booking()
returns trigger
language plpgsql
security definer set search_path = public
as $booking$
begin
  if new.estimate_id is not null and not exists (
    select 1 from public.estimates e
    where e.id = new.estimate_id
      and e.status = 'accepted'
      and e.superseded_by is null
      and e.service_request_id = new.service_request_id
  ) then
    raise exception 'A booking can only be created from the currently approved estimate';
  end if;
  return new;
end;
$booking$;

create trigger require_approved_estimate_for_booking
  before insert on public.bookings
  for each row
  execute procedure public.require_approved_estimate_for_booking();


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

-- Helper: is the caller a technician? Used by the queue RLS policies, which
-- must let technicians read a whole appliance queue but must NOT let customers
-- read it. (migration_queue_redesign.sql recreates this identically.)
create or replace function public.is_technician()
returns boolean
language sql stable
security definer set search_path = public
as $$
  select public.current_role() = 'technician';
$$;

-- Helper: does the calling technician have a link (an estimate or a booking)
-- to this request? Declared SECURITY DEFINER so it bypasses RLS internally.
-- Referencing estimates/bookings *directly* inside a service_requests policy
-- causes "infinite recursion detected in policy for relation service_requests"
-- in production, because those tables' own policies query service_requests
-- back. Funnelling it through this function breaks the cycle.
create or replace function public.technician_linked_to_request(request_id uuid)
returns boolean
language sql stable
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

-- Helper: does this booking request have the CURRENT approved estimate, for the
-- technician it names? Used by the bookings INSERT policy, and SECURITY DEFINER for
-- the same reason as technician_linked_to_request(): a policy that selects from
-- `estimates` would otherwise be filtered by the ESTIMATES policies for the
-- invoking customer, and "the estimate exists" would silently become "the estimate
-- is one this caller may read".
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

-- Helper: does this request already have a live booking? Keeps a customer from
-- writing `status = 'booked'` on a request with nothing booked.
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
  -- `request.jwt.claims` is a JSON object in current Supabase; the older
  -- singular `request.jwt.claim.role` setting no longer holds the caller's
  -- role, which meant the service-role bypass silently never fired.
  if new.role is distinct from old.role
    and coalesce(
          current_setting('request.jwt.claims', true)::jsonb ->> 'role',
          current_setting('request.jwt.claim.role', true),
          ''
        ) <> 'service_role'
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
-- A customer owns the row, not the queue state: `for all` used to let them rewrite
-- `assignment_status`, `assigned_technician_id` and `status` from the browser. The
-- column-level rules live in enforce_service_request_customer_update() below.
create policy "customer creates own service requests"
  on public.service_requests for insert
  with check (customer_id = auth.uid());

create policy "customer reads own service requests"
  on public.service_requests for select
  using (customer_id = auth.uid() or public.is_admin());

create policy "customer updates own service requests"
  on public.service_requests for update
  using (customer_id = auth.uid() or public.is_admin())
  with check (customer_id = auth.uid() or public.is_admin());

create policy "technicians can view assigned requests"
  on public.service_requests for select
  using (
    -- Precise service location (address + coordinates) is readable only once
    -- the assignment is CONFIRMED. `assigned_technician_id` is set while a
    -- request is still 'offered', so keying the policy on that column alone let
    -- an unaccepted offer expose the customer's address. See
    -- supabase/migration_service_location.sql (and technician_pending_offers()
    -- for the narrow read path the offer screens use instead).
    (assignment_status = 'accepted' and assigned_technician_id = auth.uid())
    or public.technician_linked_to_request(id)
  );

-- ---------- estimates ----------
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

create policy "technician updates own estimates"
  on public.estimates for update
  using (technician_id = auth.uid())
  -- A technician prepares and submits; deciding is the customer's, applied by
  -- decide_estimate() (service_role only). Without this WITH CHECK a technician
  -- could set their own estimate to 'accepted' from the browser.
  with check (technician_id = auth.uid() and status in ('draft', 'pending'));

create policy "technician and admin view estimates"
  on public.estimates for select
  using (technician_id = auth.uid() or public.is_admin());

-- A customer sees every version sent to them — never a DRAFT, which is the
-- technician's working copy rather than part of the quote under review.
create policy "customer views sent estimates of own requests"
  on public.estimates for select
  using (
    status <> 'draft'
    and exists (
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
create policy "admin creates bookings"
  on public.bookings for insert
  with check (public.is_admin());

create policy "participants update their bookings"
  on public.bookings for update
  using (customer_id = auth.uid() or technician_id = auth.uid() or public.is_admin())
  with check (
    customer_id = auth.uid() or technician_id = auth.uid() or public.is_admin()
  );

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
  -- The rejection decision lives on its own columns (Batch 3). A rejection is not
  -- a verification, so confirmed_by/confirmed_at stay null on a rejected row.
  rejected_by uuid references public.users(id),
  rejected_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now()
);

-- The row's decision metadata must match its status, for every writer including
-- the service role (Batch 3, see migration_reject_payment.sql).
alter table public.payments
  add constraint payments_decision_metadata_check check (
    (
      status = 'pending_verification'
      and confirmed_by is null and confirmed_at is null
      and rejected_by is null and rejected_at is null and rejection_reason is null
    )
    or (
      status = 'confirmed'
      and confirmed_by is not null and confirmed_at is not null
      and rejected_by is null and rejected_at is null and rejection_reason is null
    )
    or (
      status = 'rejected'
      and confirmed_by is null and confirmed_at is null
      and rejected_by is not null and rejected_at is not null
      and rejection_reason is not null
      -- chr(11) is the vertical tab, spelled out rather than written as E'\v' so
      -- the set does not depend on how a PostgreSQL build reads that escape.
      and btrim(rejection_reason, E' \t\n\r\f' || chr(11)) <> ''
      and char_length(rejection_reason) <= 500
    )
  );

-- The application service role never writes a payment row (Batch 3). A decision is
-- made by ONE SECURITY DEFINER function (confirm_payment() / reject_payment()), so
-- the service role needs SELECT only. Supabase creates `service_role` with
-- BYPASSRLS and grants `all` on new tables by default, so without this revoke a
-- direct write would be a second, unguarded decision path - and an INSERT could
-- fabricate an already-verified row while a DELETE could erase the record.
--
-- REVOKE ALL, not just INSERT/UPDATE/DELETE: TRUNCATE, REFERENCES and TRIGGER are
-- separate table privileges, and a partial revoke would leave TRUNCATE behind -
-- which would empty the table rather than remove one row. SELECT is granted back on
-- its own for the service-role reads the routes perform.
revoke all privileges on table public.payments from service_role;
grant select on table public.payments to service_role;

-- The client roles get only what the customer workflow needs (Batch 3).
-- Supabase's default privileges grant ALL to anon and authenticated, and RLS is then
-- left to decide the ROWS - but TRUNCATE ignores RLS entirely, REFERENCES lets a
-- client attach foreign keys and TRIGGER lets it attach triggers, and no policy can
-- restrict any of the three. The customer workflow only reads its own payment
-- records (SELECT) and submits a reference (INSERT, pinned by the policy above).
-- `anon` gets nothing: every path that touches a payment row requires a signed-in
-- user, and the customer's own submission uses the user-scoped client.
-- The policies are unchanged; this narrows the table privileges, not the row rules.
revoke all privileges on table public.payments from anon, authenticated;
grant select, insert on table public.payments to authenticated;

alter table public.payments enable row level security;

create policy "customer submits own payment"
  on public.payments for insert
  with check (
    customer_id = auth.uid()
    and status = 'pending_verification'
    and confirmed_by is null
    and confirmed_at is null
    -- Batch 3: a submission cannot carry decision metadata of any kind, so a
    -- customer can never pre-load a rejection onto a row.
    and rejected_by is null
    and rejected_at is null
    and rejection_reason is null
    and amount > 0
    and exists (
      select 1 from public.bookings b
      where b.id = payments.booking_id
        and b.customer_id = auth.uid()
        and b.final_cost is not null
        and payments.amount = b.final_cost
        and (
          b.status = 'awaiting_payment'
          -- A booking completed under the pre-verification policy may still owe
          -- its reference; accepting it does not re-open a closed repair.
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
-- NOTE: the "RLS recursion fix" that used to live here is gone — the
-- technician_linked_to_request() helper is now defined up beside
-- current_role()/is_admin(), and the service_requests technician policy
-- uses it from the start. Previously this file created the recursion-prone
-- policy first and then dropped it ~300 lines later, which meant the
-- dangerous version existed for part of the script.
-- =========================================================

-- =========================================================
-- Technician queue — fair rotation per appliance type (QUEUE-SYSTEM.md).
--
-- REQUIRED: apply supabase/migration_queue_redesign.sql after this file. The
-- queue FUNCTIONS (assign_technician_to_request, respond_to_offer, ...) are the
-- only writers of queue position and they live in that migration, so this file
-- only defines the storage. Ratings, reviews and experience play NO part in
-- ordering — the queue is a fairness mechanism, not a ranking.
--
-- REQUIRED after that: supabase/migration_offer_lifecycle.sql, which replaces
-- those two functions to release a live offer when its request is cancelled and
-- to release TTL-lapsed offers before each walk (so a dead offer cannot freeze
-- the rotation), and adds the lapse_offer()/lapse_offer_on_cancel() pair.
--
-- Four independent concepts, never collapsed into one busy/free flag:
--   queue position  -> technician_queue_state.queue_position (fairness)
--   eligibility     -> profiles + specializations + service areas (qualification)
--   availability    -> technician_availability / technician_time_off (working hours)
--   schedule        -> bookings (actual appointments)
--   capacity        -> profiles.max_daily_working_hours (workload limit)
-- =========================================================

-- NOTE: assigned_technician_id / assignment_status / offers_expires_at are
-- declared directly on service_requests in the table definition above, so no
-- ALTER is needed here (it used to be, back when the table was recreated by
-- migration_appliance_centric_flow.sql).

-- Queue membership: one row per (technician, appliance type). The primary key
-- makes duplicate memberships impossible, and a technician legitimately appears
-- in several queues (Refrigerator #1, Washing Machine #3, ...).
-- `last_assigned_at` records whose turn was last consumed — the rotation rule —
-- while `queue_position` is the inspectable 1..N rank shown to technicians.
create table public.technician_queue_state (
  technician_id uuid not null references public.users(id),
  appliance_type text not null,
  last_assigned_at timestamptz,
  id uuid,
  queue_position integer,
  is_active boolean not null default true,
  turn_count integer not null default 0,
  joined_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (technician_id, appliance_type)
);

alter table public.technician_queue_state enable row level security;

-- Technicians read the WHOLE queue for an appliance type, not just their own
-- row — that is what lets them see "#2 You" instead of an empty list. The row
-- holds no private data (technician id, appliance type, position, timestamps).
-- The old policy here was `technician_id = auth.uid() or is_admin()`, which is
-- exactly why a technician used to see only themselves.
create policy "technician and admin view queue positions"
  on public.technician_queue_state for select
  using (public.is_technician() or public.is_admin());

-- Writes stay admin-only; the rotation itself happens inside SECURITY DEFINER
-- functions that run as the owner, so a client can never rewrite its own
-- position even with a valid login.
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

-- The "technicians can view open/assigned requests" policy is NOT redefined
-- here — it's created once, up in the service_requests block. This block used
-- to recreate it, which made a fresh install fail with "policy already exists".

alter type booking_status add value if not exists 'awaiting_inspection';
-- Verified-payment step (see migration_booking_payment_status.sql): the repair is
-- not `completed` until an administrator has verified the customer's payment. The
-- base enum above already declares it, so this line is a no-op on a fresh install
-- and the upgrade step for an existing project.
alter type booking_status add value if not exists 'awaiting_payment';
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

-- =========================================================
-- Added after initial release (see migration_flow_hardening.sql) —
-- keeps the assignment flow from stranding requests. Included here so a
-- fresh install only has to run one file.
-- =========================================================

-- Find expiring offers cheaply (drives /api/cron/assignment-tick).
create index if not exists idx_service_requests_offer_expiry
  on public.service_requests (offers_expires_at)
  where assignment_status = 'offered';

-- A technician may hold at most one active offer at a time. This is what turns
-- a concurrent double-offer from a silent last-write-wins into a unique
-- violation the assignment engine can detect and skip past.
create unique index if not exists uniq_active_offer_per_technician
  on public.service_requests (assigned_technician_id)
  where assignment_status = 'offered' and assigned_technician_id is not null;

-- Marks a lapsed offer as rejected (so the same technician is never re-offered
-- the same request) and returns the request to "matching".
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


-- =========================================================
-- Added after initial release (see migration_rls_workflow_enforcement.sql) —
-- the workflow rules the API enforced but RLS did not. Included here so a fresh
-- install and an upgraded project end in the same shape. The migration file is
-- the authoritative copy: keep the two in step.
-- =========================================================

-- Transition matrix for a booking. RLS cannot see the OLD row (`USING` sees only
-- the old one, `WITH CHECK` only the new one), so "final_cost may not change" and
-- "the customer may only cancel before work starts" are not expressible in a
-- policy — they are enforced here instead.
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
  -- reassignment are their own reviewed workflows: until then, moving an
  -- appointment is a cancellation plus a new booking.
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
       -- Cancel before the work starts. Once the repair is under way, cancellation
       -- is a staff action or a support request.
       (old.status = 'pending' and new.status = 'cancelled')
       -- A satisfactory inspection advances to the payment step. It does NOT
       -- complete the repair, and it must carry the written attestation that
       -- service_history archives.
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

create trigger enforce_booking_update_rules
  before update on public.bookings
  for each row execute procedure public.enforce_booking_update_rules();

-- Cancelling a booking returns its request to "ready to book": POST /api/bookings
-- accepts only a request in `quoted` or `open`, so a request left at `booked` with a
-- cancelled booking could never be booked again. The technician's accepted
-- assignment and the approved estimate are untouched (no queue turn is re-spent),
-- and the cancelled booking row stays as history.
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

create trigger reopen_request_after_booking_cancel
  after update on public.bookings
  for each row execute procedure public.reopen_request_after_booking_cancel();

-- The same rules for a customer's own service request: the assignment engine owns
-- assignment_status / assigned_technician_id / offers_expires_at, and the status
-- vocabulary a customer may use is "leave it, cancel it, or confirm the booking".
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

  if public.is_admin() then
    return new;
  end if;

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
  -- `booked` when the appointment exists, `quoted` when their last live booking was
  -- cancelled (the transition reopen_request_after_booking_cancel() performs, which
  -- has to be permitted here because that trigger runs in the cancelling user's
  -- session), and `cancelled` only while nothing is booked on the request. After the
  -- repair has started, cancellation is an administrator action or a support request.
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

create trigger enforce_service_request_customer_update
  before update on public.service_requests
  for each row execute procedure public.enforce_service_request_customer_update();


-- The ONLY path to a completed repair. One transaction: verify the payment, close
-- the booking, archive the service history, close the request, free the
-- technician's slot. Server-only (service_role) — revoked from anon/authenticated
-- at the end of migration_rls_workflow_enforcement.sql, which is where the grants
-- live for an upgraded project.
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

  -- The appointment was cancelled while the reference was waiting. There is no repair
  -- left to close, so the payment stays pending for the administrator to reject —
  -- silently confirming it would record money against a job that no longer exists.
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
-- Batch 2 — atomic booking creation (see migration_atomic_booking.sql)
-- =========================================================
-- Booking creation is ONE transaction owned by the database. A direct INSERT from
-- the browser is no longer a path: the INSERT policies on `bookings` are dropped
-- below, and create_booking_atomic() is service-role only.

-- =========================================================

-- 2. One live booking per repair request
-- =========================================================
-- `status <> 'cancelled'` on purpose:
--   * a cancelled booking stays as history and must NOT block rebooking, which is
--     the flow Batch 1 added (cancel a pending booking -> the request returns to
--     `quoted` -> book again with the same approved estimate);
--   * a completed booking still occupies its request, so a finished repair cannot
--     collect a second appointment.

create unique index if not exists uniq_active_booking_per_request
  on public.bookings (service_request_id)
  where status <> 'cancelled';

-- =========================================================
-- 3. No overlapping appointments for one technician
-- =========================================================
-- The blocking status set is the same one technician_schedule_conflict() uses and
-- the two must stay in step:
--   pending             â€” an upcoming appointment holds the slot
--   in_progress         â€” the technician is there now
--   awaiting_inspection â€” the visit is still open
--   cancelled           â€” frees the slot (history)
--   completed           â€” history; the work is done
--   awaiting_payment    â€” the physical repair is finished and the customer owes
--                         money, so it no longer occupies the technician's time.
--                         This mirrors the existing conflict rule exactly; it is
--                         not a new policy.

create or replace function public.enforce_booking_no_overlap()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  v_start timestamptz;
  v_end timestamptz;
  v_other public.bookings%rowtype;
begin
  -- Cancelled and finished appointments never block anything.
  if new.status not in ('pending', 'in_progress', 'awaiting_inspection') then
    return new;
  end if;

  -- Serialize every writer for this technician for the rest of the transaction, so
  -- two concurrent inserts cannot both pass the check below â€” the read-then-write
  -- race the audit found. `pg_advisory_xact_lock` is re-entrant within a
  -- transaction, so create_booking_atomic() taking the same lock first is free.
  perform pg_advisory_xact_lock(hashtext('booking_technician:' || new.technician_id::text));

  v_start := new.scheduled_at;
  v_end := new.scheduled_at
           + make_interval(mins => greatest(coalesce(new.duration_minutes, 120), 1));

  select b.* into v_other
  from public.bookings b
  where b.technician_id = new.technician_id
    and b.id is distinct from new.id
    and b.status in ('pending', 'in_progress', 'awaiting_inspection')
    -- Half-open intervals: a booking that ends at 10:00 does not clash with one
    -- that starts at 10:00.
    and b.scheduled_at < v_end
    and b.scheduled_at
        + make_interval(mins => greatest(coalesce(b.duration_minutes, 120), 1)) > v_start
  limit 1;

  if v_other.id is not null then
    raise exception using
      errcode = '23P01', -- exclusion_violation: what an EXCLUDE constraint raises
      message = format(
        'This technician already has an appointment that overlaps %s to %s.',
        to_char(v_start, 'YYYY-MM-DD HH24:MI'),
        to_char(v_end, 'YYYY-MM-DD HH24:MI')
      ),
      detail = format('Overlapping booking %s is %s from %s.', v_other.id, v_other.status, to_char(v_other.scheduled_at, 'YYYY-MM-DD HH24:MI')),
      hint = 'Choose a different time, or a different technician through the queue.';
  end if;

  return new;
end;
$$;

-- Named `trg_â€¦` so it fires AFTER `require_approved_estimate_for_booking`: BEFORE
-- triggers run in alphabetical order, and an unapproved estimate should be reported
-- as such rather than as a scheduling clash.
drop trigger if exists trg_booking_no_overlap on public.bookings;
create trigger trg_booking_no_overlap
  before insert or update of technician_id, scheduled_at, duration_minutes, status
  on public.bookings
  for each row execute procedure public.enforce_booking_no_overlap();


-- =========================================================
-- =========================================================
-- 3b. The qualification predicate shared with the queue engine (step 17)
-- =========================================================
-- "Is this technician qualified for this appliance type?" - the first four checks
-- of public.technician_eligibility_failure(), extracted so the queue walk and the
-- booking transaction have exactly ONE definition of it. The queue engine arrives
-- with supabase/migration_queue_redesign.sql, which re-points its own
-- eligibility_failure() at this function; see
-- supabase/migration_booking_eligibility.sql for the whole rationale.
--
-- Returns NULL when qualified, else 'not_available' (account inactive / not
-- approved), 'suspended', or 'not_in_queue' (no ACTIVE membership of this
-- appliance's queue, which is what mirrors technicians.specializations).
create or replace function public.technician_qualification_failure(
  p_technician_id uuid,
  p_appliance_type text
)
returns text
language plpgsql
stable
security definer set search_path = public
as $qualification$
declare
  v_type text := public.normalize_appliance_type(p_appliance_type);
begin
  if not exists (
    select 1 from public.users u where u.id = p_technician_id and u.is_active
  ) then
    return 'not_available';
  end if;

  if not exists (
    select 1 from public.technicians t where t.id = p_technician_id and t.approved
  ) then
    return 'not_available';
  end if;

  if exists (
    select 1 from public.technicians t
    where t.id = p_technician_id and t.operational_status = 'SUSPENDED'
  ) then
    return 'suspended';
  end if;

  if not exists (
    select 1 from public.technician_queue_state qs
    where qs.technician_id = p_technician_id
      and qs.appliance_type = v_type
      and qs.is_active
  ) then
    return 'not_in_queue';
  end if;

  return null;
end;
$qualification$;

-- Does the platform have ANYONE who could take this appliance type right now? Read
-- only, no counts and no names: it lets the API say whether the appliance type has
-- no coverage at all, or whether the assigned technician simply lost it.
--
-- plpgsql rather than sql on purpose: this file does not carry the queue engine, so
-- the body may be created before normalize_appliance_type() exists.
create or replace function public.appliance_has_qualified_technician(p_appliance_type text)
returns boolean
language plpgsql
stable
security definer set search_path = public
as $coverage$
declare
  v_type text := public.normalize_appliance_type(p_appliance_type);
begin
  return exists (
    select 1
    from public.technician_queue_state qs
    join public.technicians t on t.id = qs.technician_id
    join public.users u on u.id = qs.technician_id
    where qs.appliance_type = v_type
      and qs.is_active
      and t.approved
      and t.operational_status <> 'SUSPENDED'
      and u.is_active
  );
end;
$coverage$;

-- 4. create_booking_atomic() â€” the ONLY writer of a booking
-- =========================================================
-- Everything a booking needs to be true happens in one transaction, in this order:
--
--   1. lock the repair request            (serializes decisions about this request)
--   2. identify the actor                 (role re-read from the database)
--   3. validate the request state         (assigned + accepted + bookable)
--   4. refuse a second live booking       (idempotent for a retry)
--   5. verify the assigned technician is still QUALIFIED for this appliance type
--                                         (the queue engine's own rule: approved,
--                                          active, not suspended, and an ACTIVE
--                                          membership of this appliance's queue)
--   6. validate the estimate              (this request, this technician, current
--                                          approved version, not superseded)
--   7. validate the appointment window    (start + a sane duration)
--   8. take the technician's scheduling lock
--   9. recheck availability / time off / conflicts / capacity  (the SAME functions
--                                          the queue walk uses â€” nothing duplicated)
--  10. insert the booking
--  11. mark the request booked (+ its confirmed window)
--  12. move the technician's job-load counter, exactly once
--
-- LOCK ORDER: the request row first, then the per-technician advisory lock, and
-- nothing else. Two bookings for one technician therefore serialize on the same
-- lock, and a booking never waits on a lock another booking holds in the opposite
-- order. Cancellation (a booking row, then the request through the Batch 1 reopen
-- trigger) touches the request last as well, so the request is always the final
-- resource and no cycle can form.
--
-- Returns jsonb, so the API route can map an expected refusal to the right status
-- without parsing error strings. `outcome` is one of:
--   booked                      booking_id, booking, request_id, scheduled_at
--   already_booked              booking_id (a live booking already exists)
--   request_not_found
--   forbidden                   the actor may not book this request
--   request_not_bookable        reason: not_assigned | status_<request status>
--   technician_not_eligible     reason: not_in_queue | not_available | suspended,
--                               plus appliance_type, technician_id and
--                               qualified_technician_available (does ANYBODY cover
--                               this appliance type?). The assignment is stale: no
--                               booking, no request change, no counter move
--   estimate_invalid            reason: wrong_request | wrong_technician |
--                               not_approved | superseded
--   invalid_input | invalid_schedule
--   outside_availability_window
--   schedule_conflict
--   capacity_concurrent_job | capacity_daily_jobs | capacity_daily_hours

create or replace function public.create_booking_atomic(
  p_request_id uuid,
  p_estimate_id uuid,
  p_actor uuid,
  p_scheduled_at timestamptz,
  p_duration_minutes integer default null,
  p_notes text default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  r public.service_requests%rowtype;
  e public.estimates%rowtype;
  b public.bookings%rowtype;
  v_role public.user_role;
  v_existing uuid;
  v_qualification text;
  v_minutes integer;
  v_end timestamptz;
  v_capacity text;
begin
  if p_request_id is null or p_estimate_id is null or p_actor is null or p_scheduled_at is null then
    return jsonb_build_object('outcome', 'invalid_input', 'reason', 'missing_parameter');
  end if;

  -- 1. The request is the unit of work: lock it for the whole transaction.
  select * into r from public.service_requests where id = p_request_id for update;
  if r.id is null then
    return jsonb_build_object('outcome', 'request_not_found', 'request_id', p_request_id);
  end if;

  -- 2. Who is asking? Read the role from public.users; never trust the caller.
  select u.role into v_role from public.users u where u.id = p_actor;
  if v_role is null or v_role not in ('customer', 'admin', 'super_admin') then
    return jsonb_build_object('outcome', 'forbidden', 'request_id', r.id, 'reason', 'role');
  end if;
  if v_role = 'customer' and r.customer_id <> p_actor then
    return jsonb_build_object('outcome', 'forbidden', 'request_id', r.id, 'reason', 'not_owner');
  end if;

  -- 3. One live booking per request, checked BEFORE the request-state rules: a
  --    retry of an attempt that already succeeded must be answered "you already
  --    have a booking" (idempotent, 409) rather than "this request is not bookable",
  --    which is what its `booked` status would otherwise report.
  select b2.id into v_existing
  from public.bookings b2
  where b2.service_request_id = r.id
    and b2.status <> 'cancelled'
  limit 1;
  if v_existing is not null then
    return jsonb_build_object('outcome', 'already_booked', 'request_id', r.id, 'booking_id', v_existing);
  end if;

  -- 4. A request is bookable once a technician has ACCEPTED it and it is still open
  --    or quoted. `booked`/`completed`/`cancelled` are refused here.
  if r.assignment_status <> 'accepted' or r.assigned_technician_id is null then
    return jsonb_build_object(
      'outcome', 'request_not_bookable',
      'reason', 'not_assigned',
      'request_id', r.id,
      'assignment_status', r.assignment_status
    );
  end if;
  if r.status not in ('quoted', 'open') then
    return jsonb_build_object(
      'outcome', 'request_not_bookable',
      'reason', 'status_' || r.status::text,
      'request_id', r.id,
      'request_status', r.status
    );
  end if;

  -- 5. THE ELIGIBILITY INVARIANT. The technician who accepted must still be
  --    qualified for THIS appliance type, by the queue engine's own rule
  --    (`technician_qualification_failure`): approved, active, not suspended, and
  --    holding an active membership of this appliance's queue - which is what
  --    mirrors `technicians.specializations`.
  --
  --    An `accepted` assignment is a claim about the past. Specializations can be
  --    edited (by the technician themselves), an account can be suspended, and an
  --    administrator can remove somebody from one rotation - and none of those
  --    release the request they already accepted. Without this check a booking is
  --    written for a technician the platform's own rules forbid from taking the
  --    job, and where they were the last member of that queue, for an appliance
  --    type nobody can service at all.
  --
  --    Nothing is mutated here: the refusal happens before the advisory lock and
  --    before every write, so the request keeps its state, no counter moves and the
  --    rotation does not change.
  --
  --    A READ IS NOT ENOUGH ON ITS OWN: the predicate locks none of the three rows
  --    it reads, so a concurrent commit could land between this read and this
  --    transaction's commit. The row locks below close that - they block no reader
  --    and no other booking, but they block every writer of these rows (a
  --    specialization edit, an approval change, a suspension, an account
  --    deactivation, an administrative queue removal) until this transaction ends,
  --    because the sync triggers those writers fire update exactly these rows.
  --
  --    The strength differs per row on purpose. `users` and
  --    `technician_queue_state` are only read here, so FOR SHARE is enough.
  --    `technicians` is written later in this transaction (the job-load counter, then
  --    the operational status), which takes FOR NO KEY UPDATE - so that is taken now,
  --    because a FOR SHARE that had to be upgraded could deadlock against a writer
  --    already queued behind it.
  perform 1 from public.users u
   where u.id = r.assigned_technician_id
     for share;

  perform 1 from public.technicians t
   where t.id = r.assigned_technician_id
     for no key update;

  perform 1 from public.technician_queue_state qs
   where qs.technician_id = r.assigned_technician_id
     and qs.appliance_type = public.normalize_appliance_type(r.appliance_type)
     for share;

  v_qualification := public.technician_qualification_failure(
    r.assigned_technician_id, r.appliance_type
  );
  if v_qualification is not null then
    return jsonb_build_object(
      'outcome', 'technician_not_eligible',
      'reason', v_qualification,
      'message', public.queue_reason_message(v_qualification),
      'request_id', r.id,
      'technician_id', r.assigned_technician_id,
      'appliance_type', public.normalize_appliance_type(r.appliance_type),
      'qualified_technician_available',
        public.appliance_has_qualified_technician(r.appliance_type)
    );
  end if;


  -- 6. The estimate must be the CURRENT APPROVED version of THIS request, made by
  --    the technician who is actually assigned to it. This is the same rule the
  --    `require_approved_estimate_for_booking` trigger enforces for any writer; it
  --    is checked here first so the API can say which of the four things is wrong.
  select * into e from public.estimates where id = p_estimate_id;
  if e.id is null or e.service_request_id <> r.id then
    return jsonb_build_object('outcome', 'estimate_invalid', 'reason', 'wrong_request', 'request_id', r.id);
  end if;
  if e.technician_id <> r.assigned_technician_id then
    return jsonb_build_object(
      'outcome', 'estimate_invalid',
      'reason', 'wrong_technician',
      'request_id', r.id,
      'estimate_technician_id', e.technician_id,
      'assigned_technician_id', r.assigned_technician_id
    );
  end if;
  -- Superseded first: it is the more specific fact, and a replaced version carries
  -- both `status = 'superseded'` and `superseded_by` (submit_estimate sets both).
  if e.status = 'superseded' or e.superseded_by is not null then
    return jsonb_build_object('outcome', 'estimate_invalid', 'reason', 'superseded', 'estimate_status', e.status);
  end if;
  if e.status <> 'accepted' then
    return jsonb_build_object('outcome', 'estimate_invalid', 'reason', 'not_approved', 'estimate_status', e.status);
  end if;

  -- 7. The appointment window. The duration falls back to what the customer asked
  --    for when they submitted the request, then to the platform default; a whole
  --    day is the ceiling, because a longer "appointment" is a data error rather
  --    than a booking.
  v_minutes := coalesce(nullif(p_duration_minutes, 0), r.requested_duration_minutes, 120);
  if v_minutes is null or v_minutes < 1 or v_minutes > 1440 then
    return jsonb_build_object('outcome', 'invalid_schedule', 'reason', 'duration', 'duration_minutes', v_minutes);
  end if;
  v_end := p_scheduled_at + make_interval(mins => v_minutes);

  -- 8. Everything from here decides a scheduling question, so serialize on the
  --    technician. The same lock is taken by the overlap trigger, which is what
  --    makes a concurrent second booking see this one.
  perform pg_advisory_xact_lock(hashtext('booking_technician:' || r.assigned_technician_id::text));

  -- 9. The rules that made the technician eligible when the offer was sent are
  --    rechecked against the appointment the customer actually chose: weekly
  --    working hours, time off and existing appointments (one function, both
  --    concerns), then the workload limits. No eligibility logic is reimplemented
  --    here â€” these are the queue engine's own functions.
  if not public.technician_within_availability(r.assigned_technician_id, p_scheduled_at, v_end) then
    return jsonb_build_object(
      'outcome', 'outside_availability_window',
      'reason', 'outside_availability_window',
      'message', public.queue_reason_message('outside_availability_window'),
      'request_id', r.id,
      'technician_id', r.assigned_technician_id
    );
  end if;

  if public.technician_schedule_conflict(r.assigned_technician_id, p_scheduled_at, v_end) then
    return jsonb_build_object(
      'outcome', 'schedule_conflict',
      'reason', 'schedule_conflict',
      'message', public.queue_reason_message('schedule_conflict'),
      'request_id', r.id,
      'technician_id', r.assigned_technician_id
    );
  end if;

  v_capacity := public.technician_capacity_failure(r.assigned_technician_id, p_scheduled_at, v_end);
  if v_capacity is not null then
    return jsonb_build_object(
      'outcome', v_capacity,
      'reason', v_capacity,
      'message', public.queue_reason_message(v_capacity),
      'request_id', r.id,
      'technician_id', r.assigned_technician_id
    );
  end if;


  -- 10-12. The three writes, in one transaction. The trigger and the index re-check
  --        the two races that a read-then-write sequence cannot close on its own, so
  --        a booking that slipped past the checks above is refused rather than
  --        stored â€” and because this block catches the violation, the request and
  --        the counter are left untouched.
  begin
    insert into public.bookings (
      service_request_id, estimate_id, customer_id, technician_id,
      scheduled_at, duration_minutes, notes, status
    )
    values (
      r.id, e.id, r.customer_id, r.assigned_technician_id,
      p_scheduled_at, v_minutes, nullif(btrim(coalesce(p_notes, '')), ''), 'pending'
    )
    returning * into b;
  exception
    when unique_violation then
      -- uniq_active_booking_per_request: another transaction booked this request
      -- while we were deciding.
      return jsonb_build_object('outcome', 'already_booked', 'request_id', r.id);
    when exclusion_violation then
      -- trg_booking_no_overlap: another transaction took the technician's window.
      return jsonb_build_object(
        'outcome', 'schedule_conflict',
        'reason', 'schedule_conflict',
        'message', public.queue_reason_message('schedule_conflict'),
        'request_id', r.id
      );
  end;

  -- 11. The confirmed appointment replaces the preference the customer gave with the
  --     request, so the queue engine and the schedule agree on one window. The
  --     request row is already locked by this transaction.
  update public.service_requests
     set status = 'booked',
         requested_window_start = p_scheduled_at,
         requested_window_end = v_end,
         requested_duration_minutes = v_minutes,
         updated_at = now()
   where id = r.id;

  -- 12. The job-load counter moves once per successful booking, in the same
  --     statement that reads it, so a retry cannot double-count and a failure
  --     cannot leave it behind.
  update public.technicians
     set active_job_load = active_job_load + 1
   where id = r.assigned_technician_id;

  perform public.refresh_technician_operational_status(r.assigned_technician_id);

  return jsonb_build_object(
    'outcome', 'booked',
    'booking_id', b.id,
    'booking', to_jsonb(b),
    'request_id', r.id,
    'technician_id', r.assigned_technician_id,
    'estimate_id', e.id,
    'scheduled_at', p_scheduled_at,
    'duration_minutes', v_minutes
  );
end;
$$;

-- =========================================================
-- 5. Booking creation happens only through the atomic function
-- =========================================================
-- Batch 1 left two INSERT policies on `bookings` so a customer (or an administrator)
-- could insert a booking straight through PostgREST. That path bypasses the
-- transaction above: no request lock, no capacity recheck, and it relied on the
-- route happening to be the only writer. No feature inserts bookings from the
-- browser â€” `POST /api/bookings` was the only writer, and it now calls
-- `create_booking_atomic()` with the service-role client â€” so the policies go.
--
-- With no INSERT policy at all, RLS denies every direct insert for `authenticated`,
-- which is what makes the atomic path unavoidable. The constraints added above stay
-- in place as defence in depth for the service role itself.

drop policy if exists "customer creates booking from own request" on public.bookings;
drop policy if exists "admin creates bookings" on public.bookings;


-- =========================================================
-- 6. Permissions
-- =========================================================
-- Booking creation is server-only, like every other state change in this workflow
-- (submit_estimate, decide_estimate, respond_to_offer, confirm_payment). The route
-- authenticates the caller with `getCurrentUser()` and passes that id in; the
-- function then re-reads the actor's role and ownership from the database, so a
-- forged `p_actor` cannot book somebody else's request.

revoke all on function public.create_booking_atomic(uuid, uuid, uuid, timestamptz, integer, text)
  from public, anon, authenticated;
grant execute on function public.create_booking_atomic(uuid, uuid, uuid, timestamptz, integer, text)
  to service_role;

-- Step 17's two helpers are server-only, exactly like the eligibility and capacity
-- predicates they sit beside: they reveal who is qualified for what, which is queue
-- information a customer must never read. The functions that use them are SECURITY
-- DEFINER, so only direct PostgREST calls are refused.
revoke all on function public.technician_qualification_failure(uuid, text)
  from public, anon, authenticated;
grant execute on function public.technician_qualification_failure(uuid, text)
  to service_role;

revoke all on function public.appliance_has_qualified_technician(text)
  from public, anon, authenticated;
grant execute on function public.appliance_has_qualified_technician(text)
  to service_role;

-- =========================================================
-- 7. Giving the slot back when a booking is cancelled
-- =========================================================
-- `create_booking_atomic()` moves `active_job_load` by exactly one, so the release
-- has to be just as atomic. The route used to read the counter, subtract in
-- JavaScript and write the result back:
--
--     const { data: tech } = await supabase.from("technicians")
--       .select("active_job_load").eq("id", ...).single();
--     await supabase.from("technicians")
--       .update({ active_job_load: Math.max(0, tech.active_job_load - 1) });
--
-- Two cancellations for the same technician finishing together both read the same
-- starting value, so the second write undid the first decrement and the technician's
-- load stayed permanently one too high. One statement closes that; `greatest(0, â€¦)`
-- keeps the counter from ever going negative if a booking is cancelled twice.
--
-- The request side of a cancellation is NOT here: the Batch 1 trigger
-- `reopen_request_after_booking_cancel` returns the request from `booked` to
-- `quoted` once its last live booking is gone, whichever writer cancelled it.
create or replace function public.release_technician_slot(p_technician_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_load integer;
begin
  if p_technician_id is null then
    return null;
  end if;

  update public.technicians
     set active_job_load = greatest(0, active_job_load - 1)
   where id = p_technician_id
  returning active_job_load into v_load;

  return v_load;
end;
$$;

revoke all on function public.release_technician_slot(uuid) from public, anon, authenticated;
grant execute on function public.release_technician_slot(uuid) to service_role;


-- =========================================================
-- Step 18 — a cancellation releases the slot in the SAME transaction
-- (see migration_cancel_release.sql)
-- =========================================================
-- The release used to be a second call from `PATCH /api/bookings/:id`, after the
-- status change had already committed: if it failed, the booking was cancelled and
-- the counter stayed inflated for good, and any cancellation that did not go through
-- that route decremented nothing at all. The request half of a cancellation has been
-- a trigger since Batch 1 (`reopen_request_after_booking_cancel`); this is the
-- counter half, and it is what makes a non-route cancellation consistent too.
--
-- `booking_status_holds_slot()` is the slot-holding vocabulary in one place. A
-- booking holds a slot from the moment `create_booking_atomic()` writes it until it
-- is given back — by this trigger when it is cancelled, or by `confirm_payment()`
-- when it is completed. `completed` and `cancelled` hold nothing, which is what stops
-- a `completed -> cancelled` write from releasing twice.
--
-- The comparison is on TEXT, like every other predicate in this schema
-- (`technician_qualification_failure(uuid, text)`, `appliance_has_qualified_technician(text)`),
-- and the caller passes `status::text`. Two reasons: this file adds
-- `awaiting_inspection`/`awaiting_payment` to `booking_status` and defines this function
-- in the same transaction, and PostgreSQL refuses to USE an enum value in the transaction
-- that adds it (a literal coerced to the enum type fails the whole load — the harness
-- proves it); and a text argument is what `db:check` can always see through PostgREST's
-- OpenAPI document, which is how this function signals that step 18 ran.
create or replace function public.booking_status_holds_slot(p_status text)
returns boolean
language sql
stable
as $$
  select p_status in ('pending', 'in_progress', 'awaiting_inspection', 'awaiting_payment');
$$;

-- AFTER UPDATE, so the release is inside the cancelling transaction and a failure in
-- either call below rolls the cancellation back with it. SECURITY DEFINER because the
-- trigger fires in the cancelling user's session and that user cannot write
-- `technicians` — the same reason `reopen_request_after_booking_cancel` can write
-- `service_requests` for them. The transition test is what makes it idempotent per
-- booking: a second cancellation write, or an `updated_at` touch, releases nothing.
create or replace function public.release_slot_after_booking_cancel()
returns trigger
language plpgsql
security definer set search_path = public, pg_temp
as $$
begin
  -- OLD, not NEW: the slot belongs to the technician the booking was assigned to
  -- (`create_booking_atomic()` attributed the +1 to them). The two differ only for a
  -- trusted writer — the matrix pins `technician_id` for every client role and lets
  -- the service role / a direct session through — and in that case NEW would decrement
  -- a technician who never took the slot. `technician_id` is NOT NULL, so there is no
  -- null case to guard.
  if new.status = 'cancelled'
     and old.status is distinct from 'cancelled'
     and public.booking_status_holds_slot(old.status::text) then
    perform public.release_technician_slot(old.technician_id);
    perform public.refresh_technician_operational_status(old.technician_id);
  end if;

  return null;
end;
$$;

drop trigger if exists release_slot_after_booking_cancel on public.bookings;
create trigger release_slot_after_booking_cancel
  after update on public.bookings
  for each row execute procedure public.release_slot_after_booking_cancel();

revoke all on function public.booking_status_holds_slot(text)
  from public, anon, authenticated;
grant execute on function public.booking_status_holds_slot(text)
  to service_role;

revoke all on function public.release_slot_after_booking_cancel() from public, anon, authenticated;

-- `release_technician_slot()` and `refresh_technician_operational_status()` keep the
-- grants they already have: the trigger calls them as the function owner.


-- =========================================================
-- Batch 3 — a payment decision is one transaction (see migration_reject_payment.sql)
-- =========================================================
-- `confirm_payment()` verifies a reference; `reject_payment()` refuses one. Both
-- run in the database, both re-read the administrator's role from `public.users`,
-- and neither can be reached by a browser: the INSERT policies still pin a
-- submission to `pending_verification`, there is no UPDATE policy on `payments`,
-- and both functions are revoked from `anon`/`authenticated`.
--
-- The columns (`rejected_by`, `rejected_at`, `rejection_reason`), the CHECK
-- constraint and the extended INSERT policy are defined next to the table above,
-- because this file is the fresh-install path and the harness loads it before the
-- migrations.

-- A decision is final, and a rejection is not a verification. This holds for the
-- service role too, which is the writer the old route used.
create or replace function public.enforce_payment_decision_rules()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- The row identifies ONE reference. A decision never rewrites what it is about.
  if new.booking_id is distinct from old.booking_id
     or new.customer_id is distinct from old.customer_id
     or new.payment_method is distinct from old.payment_method
     or new.gcash_reference is distinct from old.gcash_reference
     or new.amount is distinct from old.amount then
    raise exception using
      errcode = 'P0001',
      message = 'A payment record is immutable apart from its decision',
      hint = 'A payment row identifies one reference. Nothing about it may change after it is submitted.';
  end if;

  -- pending -> confirmed | rejected, once. A decided payment is then frozen: its
  -- status AND every piece of decision metadata, so a rejection reason, the
  -- administrator who refused it or the timestamp can never be rewritten after the
  -- fact. `confirm_payment()` and `reject_payment()` only ever write a pending row,
  -- so neither is affected.
  if old.status <> 'pending_verification' then
    if new.status is distinct from old.status
       or new.confirmed_by is distinct from old.confirmed_by
       or new.confirmed_at is distinct from old.confirmed_at
       or new.rejected_by is distinct from old.rejected_by
       or new.rejected_at is distinct from old.rejected_at
       or new.rejection_reason is distinct from old.rejection_reason then
      raise exception using
        errcode = 'P0001',
        message = format('Payment %s is already %s, and a decision is final', old.id, old.status),
        hint = 'A verified or rejected reference cannot be re-decided or re-annotated. Ask the customer to submit a new one.';
    end if;
  end if;

  if new.status = 'confirmed' then
    if new.confirmed_by is null or new.confirmed_at is null then
      raise exception 'A confirmed payment must record who verified it and when';
    end if;
    -- The RECORDED administrator is validated, not only the caller. The RPCs
    -- re-read the caller's role, but a direct writer could otherwise name a
    -- customer or a technician as the person who verified the money, and the audit
    -- trail would name someone who never had that authority.
    if not exists (
      select 1 from public.users u
       where u.id = new.confirmed_by and u.role in ('admin', 'super_admin')
    ) then
      raise exception 'A confirmed payment must be recorded against an administrator';
    end if;
    if new.rejected_by is not null or new.rejected_at is not null or new.rejection_reason is not null then
      raise exception 'A confirmed payment cannot carry rejection metadata';
    end if;
  elsif new.status = 'rejected' then
    if new.rejected_by is null or new.rejected_at is null
       or nullif(btrim(coalesce(new.rejection_reason, ''), E' \t\n\r\f' || chr(11)), '') is null then
      raise exception 'A rejected payment must record who rejected it, when, and why';
    end if;
    if not exists (
      select 1 from public.users u
       where u.id = new.rejected_by and u.role in ('admin', 'super_admin')
    ) then
      raise exception 'A rejected payment must be recorded against an administrator';
    end if;
    if new.confirmed_by is not null or new.confirmed_at is not null then
      raise exception 'A rejected payment cannot be recorded as verified: confirmed_by and confirmed_at must stay null';
    end if;
  else
    if new.confirmed_by is not null or new.confirmed_at is not null
       or new.rejected_by is not null or new.rejected_at is not null
       or new.rejection_reason is not null then
      raise exception 'A pending payment cannot carry decision metadata';
    end if;
  end if;

  return new;
end;
$$;


-- The ONLY writer of a rejection. Structured outcomes for the conditions a caller
-- can act on; `not_pending` is idempotent, so a retry changes nothing.
create or replace function public.reject_payment(
  p_payment_id uuid,
  p_actor uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_role public.user_role;
  v_reason text;
  r public.payments%rowtype;
  v_booking_status public.booking_status;
begin
  select u.role into v_role from public.users u where u.id = p_actor;
  if v_role is null or v_role not in ('admin', 'super_admin') then
    return jsonb_build_object(
      'outcome', 'forbidden',
      'reason', 'role',
      'payment_id', p_payment_id
    );
  end if;

  -- `btrim(x)` alone removes SPACES only, so a reason of tabs and newlines would
  -- slip through and reach the customer as a blank explanation. chr(11) is the
  -- vertical tab, written out rather than as E'\v' so the set never depends on how
  -- a PostgreSQL build reads that escape.
  v_reason := btrim(coalesce(p_reason, ''), E' \t\n\r\f' || chr(11));
  if v_reason = '' then
    return jsonb_build_object(
      'outcome', 'invalid_input',
      'reason', 'missing_reason',
      'payment_id', p_payment_id
    );
  end if;
  if char_length(v_reason) > 500 then
    return jsonb_build_object(
      'outcome', 'invalid_input',
      'reason', 'reason_too_long',
      'payment_id', p_payment_id,
      'max_length', 500
    );
  end if;

  select * into r from public.payments where id = p_payment_id for update;
  if r.id is null then
    return jsonb_build_object('outcome', 'not_found', 'payment_id', p_payment_id);
  end if;

  if r.status <> 'pending_verification' then
    return jsonb_build_object(
      'outcome', 'not_pending',
      'payment_id', r.id,
      'payment_status', r.status,
      'confirmed_by', r.confirmed_by,
      'rejected_by', r.rejected_by
    );
  end if;

  -- ONE row moves; confirmed_by/confirmed_at stay null.
  update public.payments
     set status = 'rejected',
         rejected_by = p_actor,
         rejected_at = now(),
         rejection_reason = v_reason
   where id = r.id
  returning * into r;

  -- Read-only: the booking, the request, the slot counter and service_history are
  -- untouched, so the repair stays where it is and can be paid for again.
  select b.status into v_booking_status from public.bookings b where b.id = r.booking_id;

  return jsonb_build_object(
    'outcome', 'rejected',
    'payment_id', r.id,
    'payment', to_jsonb(r),
    'payment_status', r.status,
    'rejection_reason', r.rejection_reason,
    'rejected_at', r.rejected_at,
    'booking_id', r.booking_id,
    'booking_status', v_booking_status,
    'customer_id', r.customer_id
  );
end;
$$;

revoke all on function public.reject_payment(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.reject_payment(uuid, uuid, text) to service_role;

drop trigger if exists enforce_payment_decision_rules on public.payments;
create trigger enforce_payment_decision_rules
  before update on public.payments
  for each row execute procedure public.enforce_payment_decision_rules();

