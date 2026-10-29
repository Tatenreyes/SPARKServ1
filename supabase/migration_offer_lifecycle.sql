-- =========================================================
-- Migration: offer lifecycle hardening
-- ---------------------------------------------------------
-- TWO HOLES THIS CLOSES
--
--   A. A CANCELLED request could still be accepted — and even re-offered.
--      Nothing checked `service_requests.status`:
--        * `respond_to_offer()` accepted an offer on a cancelled request and left
--          it 'accepted' + 'cancelled', a state /api/estimates then refuses — the
--          technician held a job that could never proceed;
--        * `assign_technician_to_request()` would offer a cancelled request again
--          as soon as its assignment_status was 'matching' / 'waiting';
--        * an outstanding offer survived a cancellation until its TTL sweep.
--
--   B. A LAPSED offer froze the whole rotation until the cron sweep ran.
--      `uniq_active_offer_per_technician` counts any row with
--      assignment_status = 'offered' as live, so a technician holding an offer
--      nobody answered was skipped forever with SKIPPED_DUE_TO_ACTIVE_OFFER.
--      `expire_stale_offers()` is only called by GET /api/cron/assignment-tick,
--      so wherever that never runs, every new request ended in 'waiting' and no
--      offer was ever sent to anyone.
--
-- WHAT THIS MIGRATION CHANGES
--
--   1. `lapse_offer(request, reason, new_status)` — the ONE way to release a live
--      offer: history row marked rejected, EXPIRED audit event, assignment
--      cleared. It never re-offers; the caller decides what happens next.
--   2. A trigger on `service_requests`: cancelling a request releases its live
--      offer immediately instead of waiting for the TTL.
--   3. `respond_to_offer()` refuses to process an offer on a cancelled (or
--      completed) request. It releases the offer and answers
--      `outcome = 'cancelled'` so the technician is told why.
--   4. `assign_technician_to_request()` (a) never offers a cancelled/completed
--      request, and (b) releases offers whose TTL has already passed BEFORE
--      walking the queue — so a dead offer can no longer freeze the rotation
--      even if the scheduled sweep has not run. Those requests become 'waiting'
--      (the state the sweep re-matches), never 'matching', so nothing is left
--      stranded and nothing is re-offered by accident from inside the walk.
--
-- WHAT DELIBERATELY DOES NOT CHANGE
--   * Queue positions, rotation order, eligibility, availability, capacity and
--     offer TTL semantics. A lapse still moves nobody: it is the same
--     "position untouched" rule as a skip.
--   * `expire_stale_offers()` keeps its behaviour (lapse + immediate re-offer +
--     notification) for the scheduled sweep. The new pre-walk release is a
--     safety net, not a replacement: it does not notify, because an offer that
--     lapsed in the background is not news the technician can act on.
--
-- Safe to run more than once: every statement is create-or-replace or guarded.
-- =========================================================


-- ---------- 1. The single way to release a live offer ----------
-- Server-only (SECURITY DEFINER, granted to service_role): a client can never
-- release somebody else's offer, and `respond_to_offer`, the sweep and this
-- file's trigger all funnel through it so the history row, the audit event and
-- the request columns can never disagree.
create or replace function public.lapse_offer(
  p_request_id uuid,
  p_reason text,
  p_new_status text default 'matching'
)
returns uuid
language plpgsql
security definer set search_path = public
as $lapse$
declare
  v_current public.service_requests%rowtype;
  v_type text;
begin
  -- Lock first: two concurrent releases must not both act on the same offer.
  select * into v_current
  from public.service_requests
  where id = p_request_id
  for update;

  -- Nothing live to release. Also the recursion stop for the cancellation
  -- trigger: by the time it re-enters, the offer is already gone.
  if v_current.id is null or v_current.assignment_status <> 'offered' then
    return null;
  end if;

  v_type := public.normalize_appliance_type(v_current.appliance_type);

  update public.technician_offer_history
     set status = 'rejected',
         reason = coalesce(p_reason, reason, 'Offer lapsed')
   where service_request_id = p_request_id
     and technician_id = v_current.assigned_technician_id
     and status = 'offered';

  perform public.log_queue_event(
    v_current.assigned_technician_id, v_type, p_request_id, 'EXPIRED', null, null,
    coalesce(p_reason, 'Offer lapsed'), null
  );

  update public.service_requests
     set assigned_technician_id = null,
         assignment_status = p_new_status,
         offers_expires_at = null,
         updated_at = now()
   where id = p_request_id;

  return v_current.assigned_technician_id;
end;
$lapse$;

-- ---------- 2. Cancelling a request releases its live offer ----------
-- A trigger rather than an API-only step: cancellation can come from the customer
-- route, an administrator or a direct SQL fix, and in every case the offer must
-- not outlive the request it belongs to.
create or replace function public.lapse_offer_on_cancel()
returns trigger
language plpgsql
security definer set search_path = public
as $cancel$
begin
  -- Only the transition INTO 'cancelled', and only while an offer is live. The
  -- release below updates this same row; on that second pass `old.status` is
  -- already 'cancelled', so this condition is false and the trigger stops.
  if new.status = 'cancelled'
     and old.status is distinct from new.status
     and new.assignment_status = 'offered' then
    perform public.lapse_offer(new.id, 'Request cancelled', 'matching');
  end if;

  return null; -- AFTER trigger: the row is already written
end;
$cancel$;

drop trigger if exists lapse_offer_on_cancel on public.service_requests;
create trigger lapse_offer_on_cancel
  after update on public.service_requests
  for each row
  execute procedure public.lapse_offer_on_cancel();


-- ---------- 3. The walk: never offer a closed request, never be blocked by a dead offer ----------
-- Copied from migration_queue_redesign.sql with TWO additions, both marked
-- "ADDED HERE". Everything else — the lock, the skip rules, the claim, the
-- waiting fallback, the audit events — is the tested engine unchanged.
create or replace function public.assign_technician_to_request(p_request_id uuid)
returns jsonb
language plpgsql
security definer set search_path = public
as $assign$
declare
  r public.service_requests%rowtype;
  v_type text;
  v_start timestamptz;
  v_end timestamptz;
  v_ttl integer;
  v_reason text;
  v_conflict boolean;
  v_claimed public.service_requests%rowtype;
  v_skipped text[] := '{}';
  v_stale record;
  cand record;
begin
  select * into r from public.service_requests where id = p_request_id for update;

  if r.id is null then
    raise exception 'assign_technician_to_request: request % not found', p_request_id;
  end if;

  -- Someone already offered/accepted it (concurrent call) — do not interfere.
  if r.assignment_status not in ('matching', 'waiting') then
    return jsonb_build_object(
      'outcome', 'unchanged',
      'request_id', r.id,
      'assignment_status', r.assignment_status,
      'assigned_technician_id', r.assigned_technician_id,
      'offers_expires_at', r.offers_expires_at
    );
  end if;

  -- ADDED HERE (1/2): a withdrawn or finished request must never be offered
  -- again. Without this, a cancelled request whose offer had been released went
  -- back into the rotation and a technician could take a job that can never be
  -- estimated, booked or repaired.
  if r.status in ('cancelled', 'completed') then
    return jsonb_build_object(
      'outcome', 'unchanged',
      'request_id', r.id,
      'assignment_status', r.assignment_status,
      'assigned_technician_id', r.assigned_technician_id,
      'reason', 'request_closed'
    );
  end if;

  -- ADDED HERE (2/2): release offers whose TTL has already passed, so a technician
  -- who ignored an offer cannot freeze the rotation when the scheduled sweep has
  -- not run. Their requests become 'waiting' — the state the sweep re-matches —
  -- and nothing is re-offered from inside this walk, which is what keeps this
  -- from recursing into itself. The current request is excluded: a caller may be
  -- re-walking it right after its own offer lapsed.
  for v_stale in
    select s.id
    from public.service_requests s
    where s.assignment_status = 'offered'
      and s.offers_expires_at is not null
      and s.offers_expires_at <= now()
      and s.id <> r.id
    order by s.created_at
  loop
    perform public.lapse_offer(v_stale.id, 'Offer expired without a response', 'waiting');
  end loop;

  v_type := public.normalize_appliance_type(r.appliance_type);


  v_start := r.requested_window_start;
  v_end := coalesce(
    r.requested_window_end,
    case when r.requested_window_start is not null
         then r.requested_window_start + make_interval(mins => coalesce(r.requested_duration_minutes, 120))
    end
  );
  v_ttl := greatest(1, public.queue_setting_int('queue_offer_ttl_minutes', 15));

  perform public.sync_appliance_queue_memberships(v_type);

  for cand in
    select qs.technician_id, qs.queue_position
    from public.technician_queue_state qs
    join public.technicians t on t.id = qs.technician_id
    join public.users u on u.id = t.id
    where qs.appliance_type = v_type
      and qs.is_active
      and t.approved
      and u.is_active
      and not exists (
        select 1 from public.technician_offer_history h
        where h.service_request_id = r.id and h.technician_id = qs.technician_id
      )
    order by coalesce(qs.queue_position, 2147483647) asc,
             qs.last_assigned_at asc nulls first,
             u.name asc
  loop
    v_reason := public.technician_eligibility_failure(
      cand.technician_id, v_type, r.location, v_start, v_end, r.id
    );

    if v_reason is not null then
      v_skipped := v_skipped || (cand.technician_id::text || '=' || v_reason);

      perform public.log_queue_event(
        cand.technician_id, v_type, r.id,
        public.queue_event_action_for_reason(v_reason),
        cand.queue_position, cand.queue_position,
        public.queue_reason_message(v_reason), null
      );

      continue; -- position untouched: a skip is not an exit
    end if;

    -- Claim the request for this technician. The partial unique index
    -- uniq_active_offer_per_technician raises unique_violation when they are
    -- already holding a live offer for a different request; the flag keeps that
    -- decision outside the exception handler.
    v_conflict := false;
    v_claimed := null;

    begin
      update public.service_requests
         set assigned_technician_id = cand.technician_id,
             assignment_status = 'offered',
             offers_expires_at = now() + make_interval(mins => v_ttl),
             updated_at = now()
       where id = r.id
         and assignment_status in ('matching', 'waiting')
      returning * into v_claimed;
    exception when unique_violation then
      v_conflict := true;
    end;

    if v_conflict then
      v_skipped := v_skipped || (cand.technician_id::text || '=holding_offer');

      perform public.log_queue_event(
        cand.technician_id, v_type, r.id, 'SKIPPED_DUE_TO_ACTIVE_OFFER',
        cand.queue_position, cand.queue_position,
        public.queue_reason_message('holding_offer'), null
      );

      continue;
    end if;

    if v_claimed.id is null then
      -- Lost the race: another caller moved this request on.
      return jsonb_build_object(
        'outcome', 'unchanged',
        'request_id', r.id,
        'assignment_status', r.assignment_status
      );
    end if;

    insert into public.technician_offer_history (service_request_id, technician_id, status)
    values (r.id, cand.technician_id, 'offered');

    perform public.log_queue_event(
      cand.technician_id, v_type, r.id, 'OFFERED',
      cand.queue_position, cand.queue_position,
      'Offer sent; expires at ' || to_char(v_claimed.offers_expires_at, 'YYYY-MM-DD HH24:MI'),
      null
    );

    perform public.refresh_technician_operational_status(cand.technician_id);

    return jsonb_build_object(
      'outcome', 'offered',
      'request_id', r.id,
      'assigned_technician_id', cand.technician_id,
      'assignment_status', 'offered',
      'offers_expires_at', v_claimed.offers_expires_at,
      'queue_position', cand.queue_position,
      'skipped', to_jsonb(v_skipped)
    );
  end loop;

  -- Nobody in the queue could take it right now. The request WAITS; it is not
  -- rejected, and nobody lost their place.
  update public.service_requests
     set assigned_technician_id = null,
         assignment_status = 'waiting',
         offers_expires_at = null,
         updated_at = now()
   where id = r.id
     and assignment_status in ('matching', 'waiting');

  perform public.log_queue_event(
    null, v_type, r.id, 'WAITING_FOR_TECHNICIAN', null, null,
    case when array_length(v_skipped, 1) is null
         then 'No eligible technician in this queue'
         else 'Every eligible technician was skipped: ' || array_to_string(v_skipped, ', ')
    end,
    null
  );

  return jsonb_build_object(
    'outcome', 'waiting',
    'request_id', r.id,
    'assignment_status', 'waiting',
    'assigned_technician_id', null,
    'skipped', to_jsonb(v_skipped)
  );

end;
$assign$;


-- ---------- 4. Responding to an offer on a closed request ----------
-- Copied from migration_queue_redesign.sql with ONE addition, marked
-- "ADDED HERE": the cancelled/completed guard.
create or replace function public.respond_to_offer(
  p_request_id uuid,
  p_technician_id uuid,
  p_action text,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer set search_path = public
as $respond$
declare
  v_caller uuid := auth.uid();
  r public.service_requests%rowtype;
  v_type text;
  v_position integer;
  v_next jsonb;
  v_decline_consumes boolean;
begin
  if p_action not in ('accept', 'decline') then
    raise exception 'respond_to_offer: p_action must be accept or decline';
  end if;

  if v_caller is not null and v_caller <> p_technician_id and not public.is_admin() then
    raise exception 'respond_to_offer: not allowed to respond for another technician';
  end if;

  select * into r from public.service_requests where id = p_request_id for update;

  if r.id is null then
    raise exception 'respond_to_offer: request % not found', p_request_id;
  end if;

  v_type := public.normalize_appliance_type(r.appliance_type);

  if r.assignment_status <> 'offered' or r.assigned_technician_id is distinct from p_technician_id then
    return jsonb_build_object(
      'outcome', 'not_offered',
      'request_id', r.id,
      'assignment_status', r.assignment_status,
      'assigned_technician_id', r.assigned_technician_id
    );
  end if;

  -- ADDED HERE: the customer withdrew the request (or it is already finished), so
  -- there is nothing to accept. Before this, an accept left the row 'accepted'
  -- AND 'cancelled' — a state /api/estimates then refuses — and the technician was
  -- holding a job that could never proceed. The offer is released and the caller
  -- is told why.
  if r.status in ('cancelled', 'completed') then
    perform public.lapse_offer(r.id, 'Request was cancelled before a response', 'matching');

    return jsonb_build_object(
      'outcome', 'cancelled',
      'request_id', r.id,
      'request_status', r.status::text,
      'assignment_status', 'matching'
    );
  end if;


  -- Responding after the TTL is a no-op for the technician: the offer expired.
  if r.offers_expires_at is not null and r.offers_expires_at <= now() then
    update public.technician_offer_history
       set status = 'rejected', reason = coalesce(reason, 'Offer expired')
     where service_request_id = r.id and technician_id = p_technician_id and status = 'offered';

    perform public.log_queue_event(
      p_technician_id, v_type, r.id, 'EXPIRED', null, null,
      'Offer expired before a response was received', null
    );

    update public.service_requests
       set assigned_technician_id = null,
           assignment_status = 'matching',
           offers_expires_at = null,
           updated_at = now()
     where id = r.id;

    v_next := public.assign_technician_to_request(r.id);

    return jsonb_build_object(
      'outcome', 'expired',
      'request_id', r.id,
      'reassignment', v_next
    );
  end if;

  if p_action = 'accept' then
    update public.service_requests
       set assignment_status = 'accepted',
           status = case when status = 'open' then 'quoted'::public.request_status else status end,
           offers_expires_at = null,
           updated_at = now()
     where id = r.id;

    update public.technician_offer_history
       set status = 'accepted'
     where service_request_id = r.id
       and technician_id = p_technician_id
       and status = 'offered';

    -- The turn is consumed HERE — not when the job completes.
    v_position := public.consume_queue_turn(
      p_technician_id, v_type, r.id, 'Accepted a repair request'
    );

    perform public.log_queue_event(
      p_technician_id, v_type, r.id, 'ACCEPTED', v_position, v_position,
      'Assignment confirmed; queue turn consumed', null
    );

    return jsonb_build_object(
      'outcome', 'accepted',
      'request_id', r.id,
      'appliance_type', v_type,
      'assigned_technician_id', p_technician_id,
      'assignment_status', 'accepted',
      'queue_position', v_position
    );
  end if;

  -- decline
  update public.technician_offer_history
     set status = 'rejected', reason = coalesce(p_reason, 'Declined by technician')
   where service_request_id = r.id
     and technician_id = p_technician_id
     and status = 'offered';

  perform public.log_queue_event(
    p_technician_id, v_type, r.id, 'DECLINED', null, null,
    coalesce(p_reason, 'Declined the offer'), null
  );

  -- Configurable policy (default: a declined offer does NOT cost queue
  -- position — the rotation rewards work taken, not offers turned down).
  v_decline_consumes := public.queue_setting_bool('queue_decline_consumes_turn', false);
  if v_decline_consumes then
    perform public.consume_queue_turn(
      p_technician_id, v_type, r.id, 'Declined offer (policy: decline consumes turn)'
    );
  end if;

  update public.service_requests
     set assigned_technician_id = null,
         assignment_status = 'matching',
         offers_expires_at = null,
         updated_at = now()
   where id = r.id;

  v_next := public.assign_technician_to_request(r.id);

  return jsonb_build_object(
    'outcome', 'declined',
    'request_id', r.id,
    'decline_consumed_turn', v_decline_consumes,
    'reassignment', v_next
  );
end;
$respond$;

-- ---------- 5. Permissions ----------
-- The release helper is server-only, exactly like the engine it supports: the app
-- reaches it through respond_to_offer / the sweep / the cancellation trigger,
-- never from a browser.
revoke all on function public.lapse_offer(uuid, text, text) from public, anon, authenticated;
grant execute on function public.lapse_offer(uuid, text, text) to service_role;

revoke all on function public.lapse_offer_on_cancel() from public, anon, authenticated;

-- Re-asserted because these two are replaced above: CREATE OR REPLACE keeps
-- existing privileges, but a database that never ran the redesign migration would
-- otherwise inherit Postgres's default EXECUTE-to-PUBLIC.
revoke all on function public.assign_technician_to_request(uuid) from public, anon, authenticated;
grant execute on function public.assign_technician_to_request(uuid) to service_role;

revoke all on function public.respond_to_offer(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.respond_to_offer(uuid, uuid, text, text) to service_role;

-- ---------- 6. Keeping the sweep running ----------
-- Nothing here replaces the scheduled sweep: GET /api/cron/assignment-tick
-- (vercel.json, every 5 minutes in production) is still what lapses offers and
-- RE-OFFERS their requests, and what re-matches every 'waiting' request. The
-- pre-walk release in section 3 only stops a dead offer from freezing the
-- rotation in the meantime. For local development, `npm run cron:tick` runs the
-- same two steps against the project in .env.local.
