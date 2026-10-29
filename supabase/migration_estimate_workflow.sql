-- =========================================================
-- Migration: estimate workflow (STEP 2 of 2)
-- ---------------------------------------------------------
-- WHAT THIS ADDS
--   1. Itemized costs on `estimates` (labour, parts, additional charges) with
--      the total DERIVED and constraint-checked, so a browser total can never
--      disagree with the parts it claims to sum.
--   2. Version history: `version`, `supersedes_id`, `superseded_by`, so a revised
--      estimate never overwrites the version the customer reviewed.
--   3. The decision record: `submitted_at`, `decided_at`, `decided_by`,
--      `approved_at`, `decision_note`, `revision_reason`, `revision_requested_at`.
--   4. `submit_estimate()` / `decide_estimate()` — the transactional state
--      machine, so two tabs (or a retry) cannot produce two versions, two
--      approvals or a superseded approval that still authorises work.
--   5. Integrity: one live version and one approved version per request; a
--      booking may only reference the CURRENT APPROVED estimate; a customer
--      cannot read a draft; a technician cannot decide.
--   6. `require_approved_estimate_for_booking` trigger on `bookings`.
--
-- WHAT DELIBERATELY DOES NOT CHANGE
--   * `estimated_cost` stays the authoritative total every existing reader uses;
--     it is now *computed* from the itemized fields (server-side, in the RPC).
--   * Booking, scheduling, capacity, payment verification and the technician
--     queue are untouched. An estimate decision never touches queue position,
--     never re-assigns a technician, and never creates a booking.
--   * No estimate-expiry policy is introduced: an unanswered estimate stays
--     `pending` indefinitely (see TESTING.md / the final report — that remains an
--     open product-policy decision).
--
-- Requires supabase/migration_estimate_status.sql to have run first.
-- Safe to run more than once: every statement is guarded.
-- =========================================================

-- ---------- 1. Itemized costs + version history + decision record ----------
alter table public.estimates
  add column if not exists scope text,
  add column if not exists labor_cost numeric(10, 2) not null default 0,
  add column if not exists parts_cost numeric(10, 2) not null default 0,
  add column if not exists other_cost numeric(10, 2) not null default 0,
  add column if not exists other_description text,
  add column if not exists version integer not null default 1,
  add column if not exists supersedes_id uuid references public.estimates(id),
  add column if not exists superseded_by uuid references public.estimates(id),
  add column if not exists revision_reason text,
  add column if not exists revision_requested_at timestamptz,
  add column if not exists decision_note text,
  add column if not exists submitted_at timestamptz,
  add column if not exists decided_at timestamptz,
  add column if not exists decided_by uuid references public.users(id),
  -- Set once when a version is approved and NEVER cleared, even if that version
  -- is later superseded: the approval record has to survive the revision.
  add column if not exists approved_at timestamptz;

-- Backfill the rows that predate itemization: the single old figure was the
-- whole quote, so it becomes the labour line (the sum still equals the total),
-- and the row was "submitted" when it was created.
update public.estimates
   set labor_cost = estimated_cost
 where labor_cost = 0 and parts_cost = 0 and other_cost = 0 and estimated_cost > 0;

update public.estimates
   set submitted_at = created_at
 where submitted_at is null and status <> 'draft';

-- ---------- 2. Constraints: the money rules, enforced by the database ----------
do $outer$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'estimates_amounts_check' and conrelid = 'public.estimates'::regclass
  ) then
    alter table public.estimates
      add constraint estimates_amounts_check
      check (
        labor_cost >= 0 and parts_cost >= 0 and other_cost >= 0 and estimated_cost >= 0
        and estimated_cost = round(labor_cost + parts_cost + other_cost, 2)
      );
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'estimates_other_description_check' and conrelid = 'public.estimates'::regclass
  ) then
    alter table public.estimates
      add constraint estimates_other_description_check
      check (other_cost = 0 or (other_description is not null and btrim(other_description) <> ''));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'estimates_version_check' and conrelid = 'public.estimates'::regclass
  ) then
    alter table public.estimates
      add constraint estimates_version_check check (version >= 1);
  end if;
end
$outer$;

-- ---------- 3. One live version, one approved version ----------
-- History (superseded rows) is deliberately unconstrained: it is the record.
create unique index if not exists uniq_live_estimate_per_request
  on public.estimates (service_request_id)
  where status in ('draft', 'pending', 'revision_requested');

create unique index if not exists uniq_approved_estimate_per_request
  on public.estimates (service_request_id)
  where status = 'accepted';


-- ---------- 4. Submit (or revise) an estimate — one transaction ----------
-- The ONLY writer of estimate rows. The route authenticates the caller and this
-- function re-checks the assignment itself, so a browser cannot quote a request
-- it was not assigned, and cannot supply its own total: `estimated_cost` is
-- computed here from the itemized fields and checked by the constraint above.
--
-- p_submit = false  → save/finish a DRAFT (editable, invisible to the customer)
-- p_submit = true   → submit it (or submit a REVISION as a new version)
create or replace function public.submit_estimate(
  p_request_id uuid,
  p_technician_id uuid,
  p_scope text,
  p_labor numeric,
  p_parts numeric,
  p_other numeric,
  p_other_description text,
  p_notes text,
  p_submit boolean
)
returns jsonb
language plpgsql
security definer set search_path = public
as $estimate$
declare
  r public.service_requests%rowtype;
  v_live public.estimates%rowtype;
  v_old record;
  v_total numeric(10,2);
  v_labor numeric(10,2);
  v_parts numeric(10,2);
  v_other numeric(10,2);
  v_version integer;
  v_id uuid;
  v_status public.estimate_status;
  v_superseded uuid[] := '{}';
  v_previous_id uuid;
begin
  -- Money first, and never from the browser's total.
  if p_labor is null or p_parts is null or p_other is null then
    raise exception 'submit_estimate: labor, parts and other costs are required (0 is fine)';
  end if;
  if p_labor < 0 or p_parts < 0 or p_other < 0 then
    raise exception 'submit_estimate: costs cannot be negative';
  end if;
  if p_labor > 99999999.99 or p_parts > 99999999.99 or p_other > 99999999.99 then
    raise exception 'submit_estimate: a cost is larger than the maximum allowed';
  end if;

  v_labor := round(p_labor, 2);
  v_parts := round(p_parts, 2);
  v_other := round(p_other, 2);
  v_total := v_labor + v_parts + v_other;

  if v_total <= 0 then
    raise exception 'submit_estimate: the total must be greater than zero';
  end if;
  if v_other > 0 and nullif(btrim(coalesce(p_other_description, '')), '') is null then
    raise exception 'submit_estimate: an additional service charge needs a description';
  end if;

  -- Lock the request: concurrent submissions for one request serialize here.
  select * into r from public.service_requests where id = p_request_id for update;
  if r.id is null then
    raise exception 'submit_estimate: request % not found', p_request_id;
  end if;

  -- Authorization is re-checked against the DATA, not against anything the
  -- caller claimed: only the technician the request is actually assigned to may
  -- quote it, and only while the assignment is accepted.
  if r.assigned_technician_id is distinct from p_technician_id then
    return jsonb_build_object('outcome', 'not_assigned', 'request_id', r.id);
  end if;
  if r.assignment_status <> 'accepted' then
    return jsonb_build_object(
      'outcome', 'not_assigned',
      'request_id', r.id,
      'assignment_status', r.assignment_status
    );
  end if;
  if r.status not in ('open', 'quoted') then
    return jsonb_build_object(
      'outcome', 'request_closed',
      'request_id', r.id,
      'request_status', r.status::text
    );
  end if;

  select * into v_live
  from public.estimates
  where service_request_id = p_request_id
    and status in ('draft', 'pending', 'revision_requested')
  order by version desc
  limit 1
  for update;

  v_status := case when p_submit then 'pending' else 'draft' end;

  -- Finishing your own unsent draft: edit it in place. The customer never saw it,
  -- so nothing is lost and no version number is burnt.
  if v_live.id is not null and v_live.status = 'draft' and v_live.technician_id = p_technician_id then
    update public.estimates
       set scope = nullif(btrim(coalesce(p_scope, '')), ''),
           labor_cost = v_labor,
           parts_cost = v_parts,
           other_cost = v_other,
           other_description = nullif(btrim(coalesce(p_other_description, '')), ''),
           notes = nullif(btrim(coalesce(p_notes, '')), ''),
           estimated_cost = v_total,
           status = v_status,
           submitted_at = case when p_submit then now() else submitted_at end
     where id = v_live.id;

    if p_submit then
      update public.service_requests
         set status = 'quoted', updated_at = now()
       where id = p_request_id and status = 'open';
    end if;

    return jsonb_build_object(
      'outcome', case when p_submit then 'submitted' else 'draft_saved' end,
      'estimate_id', v_live.id,
      'version', v_live.version,
      'status', v_status,
      'total', v_total,
      'superseded_id', null
    );
  end if;

  -- A version the customer has seen — or approved — is closed out, never
  -- overwritten. Its scope, amounts, timestamps and approval record stay on the
  -- row; `superseded_by` points at what replaced it.
  for v_old in
    select id from public.estimates
    where service_request_id = p_request_id
      and status in ('draft', 'pending', 'revision_requested', 'accepted')
    order by version desc
    for update
  loop
    update public.estimates set status = 'superseded' where id = v_old.id;
    v_superseded := v_superseded || v_old.id;
    v_previous_id := coalesce(v_previous_id, v_old.id);
  end loop;

  v_version := coalesce(
    (select max(version) from public.estimates where service_request_id = p_request_id), 0
  ) + 1;

  insert into public.estimates (
    service_request_id, technician_id, estimated_cost, notes, status,
    scope, labor_cost, parts_cost, other_cost, other_description,
    version, supersedes_id, submitted_at
  )
  values (
    p_request_id, p_technician_id, v_total,
    nullif(btrim(coalesce(p_notes, '')), ''), v_status,
    nullif(btrim(coalesce(p_scope, '')), ''), v_labor, v_parts, v_other,
    nullif(btrim(coalesce(p_other_description, '')), ''),
    v_version, v_previous_id, case when p_submit then now() else null end
  )
  returning id into v_id;

  if array_length(v_superseded, 1) is not null then
    update public.estimates set superseded_by = v_id where id = any (v_superseded);
  end if;

  if p_submit then
    update public.service_requests
       set status = 'quoted', updated_at = now()
     where id = p_request_id and status = 'open';
  end if;

  return jsonb_build_object(
    'outcome', case
      when not p_submit then 'draft_saved'
      when v_previous_id is null then 'submitted'
      else 'revised'
    end,
    'estimate_id', v_id,
    'version', v_version,
    'status', v_status,
    'total', v_total,
    'superseded_id', v_previous_id
  );
end;
$estimate$;


-- ---------- 5. Decide on the exact version awaiting a decision ----------
-- Approve / decline / request a revision. Only the version the customer is
-- looking at can be decided, and only once: the status guard IS the concurrency
-- control, so a retry or a second tab can neither double-apply nor double-notify.
create or replace function public.decide_estimate(
  p_estimate_id uuid,
  p_actor_id uuid,
  p_decision text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $decide$
declare
  e public.estimates%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if p_decision not in ('approve', 'decline', 'request_revision') then
    raise exception 'decide_estimate: p_decision must be approve, decline or request_revision';
  end if;

  select * into e from public.estimates where id = p_estimate_id for update;
  if e.id is null then
    raise exception 'decide_estimate: estimate % not found', p_estimate_id;
  end if;

  -- Defence in depth: the actor's role comes from the DATABASE, never from a
  -- client-supplied claim. Only the customer who owns the request (or an
  -- administrator) may decide.
  if not exists (
    select 1
    from public.service_requests sr
    join public.users u on u.id = p_actor_id
    where sr.id = e.service_request_id
      and (sr.customer_id = p_actor_id or u.role in ('admin', 'super_admin'))
  ) then
    raise exception 'decide_estimate: actor is not allowed to decide this estimate';
  end if;

  if e.status <> 'pending' then
    return jsonb_build_object(
      'outcome', 'not_pending',
      'estimate_id', e.id,
      'status', e.status,
      'version', e.version
    );
  end if;

  if p_decision = 'approve' then
    update public.estimates
       set status = 'accepted',
           approved_at = now(),
           decided_at = now(),
           decided_by = p_actor_id,
           decision_note = v_reason
     where id = e.id;
  elsif p_decision = 'decline' then
    update public.estimates
       set status = 'rejected',
           decided_at = now(),
           decided_by = p_actor_id,
           decision_note = v_reason
     where id = e.id;
  else
    update public.estimates
       set status = 'revision_requested',
           revision_reason = v_reason,
           revision_requested_at = now(),
           decided_at = now(),
           decided_by = p_actor_id
     where id = e.id;
  end if;

  return jsonb_build_object(
    'outcome', p_decision,
    'estimate_id', e.id,
    'version', e.version,
    'status', case
      when p_decision = 'approve' then 'accepted'
      when p_decision = 'decline' then 'rejected'
      else 'revision_requested'
    end,
    'reason', v_reason
  );
end;
$decide$;

-- ---------- 6. A booking may only be built on the current APPROVED estimate ----------
-- Deliberately scoped: a booking that references NO estimate (administrative or
-- fixture scheduling) is untouched, but a booking that names one must name the
-- live approval — never a pending, declined or superseded version.
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

drop trigger if exists require_approved_estimate_for_booking on public.bookings;
create trigger require_approved_estimate_for_booking
  before insert on public.bookings
  for each row
  execute procedure public.require_approved_estimate_for_booking();

-- ---------- 7. Row Level Security: prepare vs decide ----------
-- A technician may draft and submit — never approve, decline or supersede. The
-- decision is the customer's, and it is applied by the server-side function
-- above (which is why no policy grants it).
drop policy if exists "technician updates own estimates" on public.estimates;
create policy "technician updates own estimates"
  on public.estimates for update
  using (technician_id = auth.uid())
  with check (technician_id = auth.uid() and status in ('draft', 'pending'));

-- Split the old combined read policy so a customer can never read a DRAFT: it is
-- the technician's working copy, not part of the quote being asked to approve.
drop policy if exists "customer and technician view relevant estimates" on public.estimates;
drop policy if exists "technician and admin view estimates" on public.estimates;
drop policy if exists "customer views sent estimates of own requests" on public.estimates;

create policy "technician and admin view estimates"
  on public.estimates for select
  using (technician_id = auth.uid() or public.is_admin());

create policy "customer views sent estimates of own requests"
  on public.estimates for select
  using (
    status <> 'draft'
    and exists (
      select 1 from public.service_requests sr
      where sr.id = estimates.service_request_id and sr.customer_id = auth.uid()
    )
  );

-- ---------- 8. Permissions ----------
-- Both functions are the transactional core of the workflow and are reachable
-- only from the server routes: revoked from anon/authenticated, granted to
-- service_role.
revoke all on function public.submit_estimate(uuid, uuid, text, numeric, numeric, numeric, text, text, boolean)
  from public, anon, authenticated;
grant execute on function public.submit_estimate(uuid, uuid, text, numeric, numeric, numeric, text, text, boolean)
  to service_role;

revoke all on function public.decide_estimate(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.decide_estimate(uuid, uuid, text, text) to service_role;

revoke all on function public.require_approved_estimate_for_booking() from public, anon, authenticated;
