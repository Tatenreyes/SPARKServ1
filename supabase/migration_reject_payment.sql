-- =========================================================
-- Migration: database-enforced payment rejection (Batch 3)
-- ---------------------------------------------------------
-- WHY THIS FILE EXISTS
-- The workflow audit found one administrative decision still living only in a
-- route: rejecting a payment reference. `PATCH /api/payments/:id` performed a raw
-- service-role update of `payments`, and it wrote `confirmed_by` and
-- `confirmed_at` on the way out. Three problems followed from that:
--
--   * nothing in the database enforced that only an administrator may reject a
--     payment - the route was the only guard, and the write bypasses RLS;
--   * a rejected row claimed a verification that never happened: `payments` had
--     no rejection columns, so the rejection was recorded in the confirmation
--     columns and "who verified this" became indistinguishable from "who
--     rejected this";
--   * the customer was never told. The confirmation branch notified; the
--     rejection branch returned silently, so the resubmission the administrator
--     was promised never actually reached the customer.
--
-- Every other decision in this workflow already runs inside one database
-- function: confirm_payment(), create_booking_atomic(), submit_estimate(),
-- decide_estimate(), respond_to_offer(). This file gives rejection the same
-- shape.
--
-- WHAT THIS FILE ADDS
--   1. `payments.rejected_by`, `rejected_at`, `rejection_reason` - the decision
--      is recorded on its own columns, and confirmed_by/confirmed_at stay null
--      on a rejection.
--   2. `payments_decision_metadata_check` - the row's metadata must match its
--      status, for every writer including the service role.
--   3. `enforce_payment_decision_rules()` + trigger - a decision is final, the
--      identifying columns are immutable, and a rejection can never be recorded
--      as a verification.
--   4. `reject_payment(p_payment_id, p_actor, p_reason)` - the only writer of a
--      rejection. Server-only (service_role), like every other state change.
--   5. The existing `customer submits own payment` INSERT policy is recreated
--      with the same rule extended to the new columns: a submission cannot carry
--      decision metadata of any kind.
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
--   * It does not touch `confirm_payment()`. Every path in that function already
--     satisfies the trigger below, so verification behaves exactly as it did.
--   * It does not touch the booking, the service request, the technician's slot
--     counter or `service_history`. A rejection says "this reference is not
--     accepted"; the repair stays where it is, at the payment step, and the
--     customer can submit a new reference. Rejecting a pending payment whose
--     booking is already `completed` (a repair closed under the pre-policy
--     path) is allowed for the same reason: the payment row is the only row
--     involved.
--   * It does not introduce refunds, fees or penalties. None exist in SPARKServ.
--
-- Idempotent: columns are `if not exists`, the constraint and the policy are
-- dropped before they are recreated, and both functions are `create or replace`.
-- =========================================================


-- =========================================================
-- 1. Preflight - fail safely, with the offending rows named
-- =========================================================
-- The CHECK constraint below cannot be created while existing data violates it,
-- and the raw PostgreSQL error would not say which payments to look at. This
-- block refuses the migration up front and prints the ids, so the decision stays
-- yours: nothing here rewrites, confirms or rejects a real payment.

do $preflight$
declare
  v_no_metadata uuid[];
  v_mislabelled uuid[];
begin
  select array_agg(id) into v_no_metadata
  from (
    select id
    from public.payments
    where status = 'confirmed'
      and (confirmed_by is null or confirmed_at is null)
    limit 25
  ) bad;

  if v_no_metadata is not null then
    raise exception using
      errcode = 'P0001',
      message = format(
        'Batch 3 preflight: %s confirmed payment(s) have no confirmation metadata, so payments_decision_metadata_check cannot be created. Affected payment ids: %s',
        array_length(v_no_metadata, 1),
        array_to_string(v_no_metadata, ', ')
      ),
      hint = 'Read-only review first: select id, booking_id, status, amount, confirmed_by, confirmed_at, created_at from public.payments where id = any of the ids above; then decide by hand what that row should say. Do not delete it.',
      detail = 'Nothing was changed by this migration.';
  end if;

  -- Historical rows written by the old route: a rejection recorded in the
  -- confirmation columns. Reported, never rewritten.
  select array_agg(id) into v_mislabelled
  from (
    select id
    from public.payments
    where status = 'rejected'
      and (confirmed_by is not null or confirmed_at is not null)
    limit 25
  ) legacy;

  if v_mislabelled is not null then
    raise notice 'Batch 3 preflight: % rejected payment(s) were recorded by the old route as verified, so confirmed_by/confirmed_at are set on a rejected row. They are left exactly as they are - this migration does not rewrite history. Affected payment ids: %',
      array_length(v_mislabelled, 1),
      array_to_string(v_mislabelled, ', ');
  end if;
end
$preflight$;


-- =========================================================
-- 2. Rejection metadata - its own columns, never the confirmation ones
-- =========================================================
alter table public.payments
  add column if not exists rejected_by uuid references public.users(id),
  add column if not exists rejected_at timestamptz,
  add column if not exists rejection_reason text;


-- =========================================================
-- 3. The metadata must match the decision
-- =========================================================
-- A `confirmed` row must name its verifier and carry no rejection metadata; a
-- `rejected` row must name its administrator, carry a reason and claim no
-- verification; a pending row must carry neither. This is a CHECK rather than
-- trigger logic on purpose: it holds for the service role too, which is the
-- writer the old route used.
alter table public.payments drop constraint if exists payments_decision_metadata_check;
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
      -- the set does not depend on how a PostgreSQL build reads that escape. An
      -- unrecognised escape would silently add the letter `v` to the set, which
      -- would trim a legitimate reason such as 'voucher not received'.
      and btrim(rejection_reason, E' \t\n\r\f' || chr(11)) <> ''
      and char_length(rejection_reason) <= 500
    )
  );


-- =========================================================
-- 4. A decision is final, and a rejection is not a verification
-- =========================================================
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

  if old.status <> 'pending_verification' then
    -- A decided payment is frozen: its status AND every piece of decision
    -- metadata. Without the metadata half of this check, a rejection reason, the
    -- administrator who refused it or the timestamp could be rewritten after the
    -- fact while the row still said `rejected` — which is exactly the audit-trail
    -- hole this batch exists to close. `confirm_payment()` and `reject_payment()`
    -- are unaffected: both only ever write a row that is still pending.
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

drop trigger if exists enforce_payment_decision_rules on public.payments;
create trigger enforce_payment_decision_rules
  before update on public.payments
  for each row execute procedure public.enforce_payment_decision_rules();


-- =========================================================
-- 5. reject_payment() - the only writer of a rejection
-- =========================================================
-- Structured outcomes for the conditions a caller can act on (`forbidden`,
-- `invalid_input`, `not_found`, `not_pending`) and `rejected` for success, so the
-- route can answer with a readable 403/400/404/409 instead of a generic 500.
-- confirm_payment() raises instead for a non-administrator; the difference is
-- deliberate and documented in DATABASE.md - a rejection is a decision about a
-- row the administrator can already see, and "it changed under you" is a normal
-- race rather than a programming error.
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
  -- The administrator's role is re-read from the database, never trusted from a
  -- claim or from the route (the same rule confirm_payment() follows).
  select u.role into v_role from public.users u where u.id = p_actor;
  if v_role is null or v_role not in ('admin', 'super_admin') then
    return jsonb_build_object(
      'outcome', 'forbidden',
      'reason', 'role',
      'payment_id', p_payment_id
    );
  end if;

  -- The reason is customer-facing text, so it is required and bounded. Checked
  -- before the row is locked: a malformed call touches nothing at all.
  -- `btrim(x)` alone removes SPACES only, so a reason of tabs and newlines would
  -- slip through and reach the customer as a blank explanation. The explicit set
  -- strips every whitespace form, spelled the same way in the CHECK constraint and
  -- the trigger: chr(11) is the vertical tab, written out rather than as E'\v' so
  -- the set never depends on how a PostgreSQL build reads that escape.
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

  -- The same lock confirm_payment() takes, so a rejection and a verification of
  -- the same reference can never both succeed.
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

  -- ONE row moves. `confirmed_by`/`confirmed_at` are deliberately not mentioned:
  -- a rejection is not a verification, and the two must never be conflated.
  update public.payments
     set status = 'rejected',
         rejected_by = p_actor,
         rejected_at = now(),
         rejection_reason = v_reason
   where id = r.id
  returning * into r;

  -- Read-only, for the response. The booking, the service request, the
  -- technician's slot counter and service_history are NOT touched: the repair
  -- stays exactly where it is (normally the payment step) and the customer can
  -- submit a new reference.
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


-- =========================================================
-- 6. Permissions
-- =========================================================
-- Rejection is an administrative decision, so it is server-only like every other
-- state change in this workflow (submit_estimate, decide_estimate,
-- respond_to_offer, confirm_payment, create_booking_atomic). The route
-- authenticates the caller and passes that id in; the function then re-reads the
-- actor's role from the database, so a forged p_actor cannot reject anything.
revoke all on function public.reject_payment(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.reject_payment(uuid, uuid, text) to service_role;

-- The application service role does not write payment rows at all.
--
-- A decision is made by ONE SECURITY DEFINER function (confirm_payment() or
-- reject_payment(), both owned by the database owner, which is what makes their
-- privileges the caller's privileges), so the service role never needs INSERT,
-- UPDATE or DELETE here. Leaving UPDATE granted left a second, unguarded writer:
-- Supabase creates `service_role` with BYPASSRLS, so RLS could not stop it, and a
-- direct `update` could decide a payment without the RPC - or mark one verified
-- while the booking stayed at the payment step, which is the inconsistency these
-- functions exist to prevent. INSERT could fabricate an already-verified row and
-- DELETE could erase the audit record.
--
-- REVOKE ALL, not just the three write privileges: Supabase's default privileges
-- grant ALL on a new table, and TRUNCATE, REFERENCES and TRIGGER are separate table
-- privileges that a partial revoke would leave behind. TRUNCATE would empty the
-- table, which is worse than a DELETE.
--
-- SELECT is then granted back on its own: the routes read payments with the
-- service-role client (the row returned to the administrator after a decision, and
-- the "already processed" check). Both statements are idempotent, so re-running this
-- file is harmless.
revoke all privileges on table public.payments from service_role;
grant select on table public.payments to service_role;


-- =========================================================
-- 7. A submission cannot carry a decision
-- =========================================================
-- Batch 1 pinned the INSERT policy to `pending_verification` with null
-- confirmation metadata. The same rule now covers the rejection columns: without
-- this a customer could insert a pending row carrying junk rejection metadata,
-- and the trigger above would then refuse the later verification of that row -
-- stranding their own repair at the payment step. The policy is recreated with
-- three added predicates, not replaced by a different rule.
drop policy if exists "customer submits own payment" on public.payments;
create policy "customer submits own payment"
  on public.payments for insert
  with check (
    customer_id = auth.uid()
    and status = 'pending_verification'
    and confirmed_by is null
    and confirmed_at is null
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


-- =========================================================
-- 8. The client roles: only what the customer workflow needs
-- =========================================================
-- Supabase's default privileges grant ALL on a new public table to `anon` and
-- `authenticated`, and RLS is then left to decide the ROWS. For `payments` that is
-- more than the application needs, and three of those privileges are not row-scoped
-- at all: TRUNCATE ignores RLS completely, REFERENCES lets a client attach foreign
-- keys to the table, and TRIGGER lets it attach triggers. A policy cannot restrict
-- any of them.
--
-- The customer workflow only ever:
--
--   * READS its own payment records - the booking page, the dashboard, and the
--     "is a reference already pending or confirmed?" check on the submission path;
--   * SUBMITS a reference (INSERT), which the policy above pins to
--     `pending_verification`, the customer's own booking, the exact recorded cost,
--     and no decision metadata of any kind.
--
-- So `authenticated` keeps SELECT and INSERT and nothing else. `anon` is granted
-- nothing at all: every path that touches a payment row goes through
-- getCurrentUser() (or the service-role client behind it), so an unauthenticated
-- caller never reaches this table.
--
-- The POLICIES are unchanged - this narrows the table privileges, not the row rules,
-- and the two are enforced independently: a privilege the role does not hold is
-- refused before RLS is ever consulted.
revoke all privileges on table public.payments from anon, authenticated;
grant select, insert on table public.payments to authenticated;


-- =========================================================
-- 9. Verify (run these in the SQL editor after applying)
-- =========================================================
-- The three columns exist:
--
--   select column_name, data_type from information_schema.columns
--   where table_schema = 'public' and table_name = 'payments'
--     and column_name in ('rejected_by', 'rejected_at', 'rejection_reason');
--
-- The constraint and the trigger are installed:
--
--   select conname from pg_constraint where conname = 'payments_decision_metadata_check';
--
--   select t.tgname from pg_trigger t join pg_class c on c.oid = t.tgrelid
--   where c.relname = 'payments' and not t.tgisinternal;
--
-- The function is service-role only:
--
--   select has_function_privilege('authenticated', 'public.reject_payment(uuid,uuid,text)', 'EXECUTE');
--   -- expect: false
--
-- And the table privilege matrix, which is what the revokes produce:
--
--   select grantee, privilege_type from information_schema.role_table_grants
--   where table_schema = 'public' and table_name = 'payments'
--   order by grantee, privilege_type;
--   -- expect authenticated: INSERT, SELECT
--   --        service_role:  SELECT
--   --        anon:          no rows at all
--   -- and no UPDATE, DELETE, TRUNCATE, REFERENCES or TRIGGER for any of them
--
-- And a dry run of the two protections, in a transaction you roll back. Use a
-- pending payment and a real administrator id:
--
--   begin;
--     -- expect a refusal: a rejected row cannot claim a verification
--     update public.payments
--        set status = 'rejected', rejected_by = '<admin-uuid>', rejected_at = now(),
--            rejection_reason = 'dry run', confirmed_at = now()
--      where id = '<pending-payment-uuid>';
--   rollback;
--
--   begin;
--     -- expect a refusal: the identifying columns are immutable
--     update public.payments set amount = 1 where id = '<pending-payment-uuid>';
--   rollback;
