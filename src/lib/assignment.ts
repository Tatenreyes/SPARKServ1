import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AssignmentOutcome,
  Database,
  ExpiredOffersOutcome,
  OfferResponseOutcome,
  ServiceRequestRow,
  TechnicianQueueSnapshotRow,
} from "@/types/database";
import { notify } from "@/lib/notifications";

/**
 * Fallback offer lifetime, in minutes. The authoritative value is the
 * `queue_offer_ttl_minutes` row in `system_settings` (read by
 * assign_technician_to_request); this constant is what a fresh install seeds
 * that setting with and what the UI quotes.
 */
export const OFFER_TTL_MINUTES = 15;

function applianceLabel(applianceType: string) {
  return applianceType.replace(/_/g, " ");
}

/**
 * QUEUE MODEL v2 — see QUEUE-SYSTEM.md.
 *
 * The whole decision lives server-side in Postgres (transactional, race-safe),
 * and everything in here is a thin, typed wrapper around it:
 *
 *   assign_technician_to_request()  walks the queue: eligibility -> requested
 *                                   time availability -> capacity. Skipped
 *                                   technicians keep their position; the first
 *                                   technician who can take it gets the offer.
 *   respond_to_offer()              accept (consumes the turn, moves them to
 *                                   the end) or decline (recorded, re-offered).
 *   expire_stale_offers()           lapses ignored offers and re-offers them.
 *
 * What this deliberately does NOT do any more (that was the old bug): remove a
 * technician from the rotation because they hold a *future* booking, or because
 * they are busy right now, or keep queue order in React at all.
 *
 * These calls need the service-role client — they are revoked from anon /
 * authenticated precisely so a client can never move itself in the queue.
 */

/**
 * Runs the queue walk for a request and returns the request's new state.
 * Keeps the original signature so existing callers are unaffected.
 */
export async function assignTechnician(
  supabase: SupabaseClient<Database>,
  serviceRequest: ServiceRequestRow
): Promise<ServiceRequestRow> {
  const { data, error } = await supabase.rpc("assign_technician_to_request", {
    p_request_id: serviceRequest.id,
  });
  if (error) throw error;

  const outcome = data as unknown as AssignmentOutcome;

  if (outcome?.outcome === "offered" && outcome.assigned_technician_id) {
    await notify(supabase, {
      userId: outcome.assigned_technician_id,
      type: "job_offered",
      title: "New job offer",
      body: `A ${applianceLabel(serviceRequest.appliance_type)} repair is available — respond within ${OFFER_TTL_MINUTES} minutes to claim it.`,
      link: "/technician/estimate-requests",
    });
  }

  const { data: current, error: readError } = await supabase
    .from("service_requests")
    .select("*")
    .eq("id", serviceRequest.id)
    .single();
  if (readError) throw readError;
  return current;
}
/**
 * Accept or decline the offer currently held by a technician.
 *
 * Accepting consumes that technician's queue turn for the appliance type
 * (they move to the end of the rotation) — once, at acceptance, not when the
 * job completes. Declining records the reason and immediately re-offers the
 * request to the next eligible technician; whether a decline also costs the
 * turn is governed by the `queue_decline_consumes_turn` setting (off by
 * default: the rotation rewards work taken, not offers turned down).
 */
export async function respondToOffer(
  supabase: SupabaseClient<Database>,
  params: {
    requestId: string;
    technicianId: string;
    action: "accept" | "decline";
    reason?: string | null;
  }
): Promise<OfferResponseOutcome> {
  const { data, error } = await supabase.rpc("respond_to_offer", {
    p_request_id: params.requestId,
    p_technician_id: params.technicianId,
    p_action: params.action,
    p_reason: params.reason ?? null,
  });
  if (error) throw error;
  return data as unknown as OfferResponseOutcome;
}

/**
 * `true` when the configured decline policy costs the technician their queue
 * turn. respondToOffer() already applies the rule; this exists so UI copy can
 * tell technicians what declining will do.
 */
export async function declineConsumesTurn(supabase: SupabaseClient<Database>): Promise<boolean> {
  const { data } = await supabase
    .from("system_settings")
    .select("value")
    .eq("key", "queue_decline_consumes_turn")
    .maybeSingle();
  return String(data?.value ?? "false").toLowerCase() === "true";
}

/**
 * Consumes a technician's queue turn without going through an offer. Only for
 * administrative/manual assignment paths — the normal path consumes the turn
 * inside respond_to_offer() when the technician accepts.
 */
export async function markQueuePosition(
  supabase: SupabaseClient<Database>,
  technicianId: string,
  applianceType: string,
  options: { requestId?: string | null; reason?: string | null } = {}
) {
  const { data, error } = await supabase.rpc("consume_queue_turn", {
    p_technician_id: technicianId,
    p_appliance_type: applianceType,
    p_request_id: options.requestId ?? null,
    p_reason: options.reason ?? null,
  });
  if (error) throw error;
  return data as number;
}

/** Recomputes and caches a technician's operational status. */
export async function refreshOperationalStatus(
  supabase: SupabaseClient<Database>,
  technicianId: string
) {
  const { data, error } = await supabase.rpc("refresh_technician_operational_status", {
    p_technician_id: technicianId,
  });
  if (error) throw error;
  return data as string;
}

/**
 * The full queue for one appliance type (or every queue the caller belongs to
 * when `applianceType` is null). Must be called with a client that carries the
 * technician's/admin's JWT — the function refuses customers and anonymous
 * callers, and returns only non-sensitive fields.
 */
export async function getTechnicianQueue(
  supabase: SupabaseClient<Database>,
  applianceType: string | null = null
): Promise<TechnicianQueueSnapshotRow[]> {
  const { data, error } = await supabase.rpc("technician_queue_snapshot", {
    p_appliance_type: applianceType,
  });
  if (error) throw error;
  return (data ?? []) as unknown as TechnicianQueueSnapshotRow[];
}

/**
 * Re-runs assignment for every request currently stuck "waiting" — call this
 * after a technician is newly approved or their specializations change, since a
 * previously-unmatchable request might now have a fit.
 */
export async function rematchWaitingRequests(supabase: SupabaseClient<Database>) {
  const { data: waiting } = await supabase
    .from("service_requests")
    .select("*")
    .eq("assignment_status", "waiting");

  for (const request of waiting ?? []) {
    await assignTechnician(supabase, request);
  }
}

/**
 * Lapses every offer whose TTL has run out and immediately re-offers the
 * request to the next technician in the queue. This is what stops a request
 * from being stranded in "offered" forever when a technician ignores the
 * notification, and it leaves the ignoring technician's queue position alone.
 *
 * Driven by /api/cron/assignment-tick (see vercel.json — every 5 minutes).
 */
export async function expireStaleOffers(
  supabase: SupabaseClient<Database>
): Promise<ExpiredOffersOutcome> {
  const { data, error } = await supabase.rpc("expire_stale_offers");
  if (error) throw error;

  const outcome = (data ?? { count: 0, expired: [] }) as unknown as ExpiredOffersOutcome;

  for (const lapsed of outcome.expired ?? []) {
    if (!lapsed.technician_id) continue;
    await notify(supabase, {
      userId: lapsed.technician_id,
      type: "offer_expired",
      title: "Job offer expired",
      body: `Your offer for a ${applianceLabel(lapsed.appliance_type)} repair lapsed and was passed to the next technician.`,
      link: "/technician/estimate-requests",
    });
  }

  return outcome;
}

/**
 * Does this appointment slot clash with the technician's real schedule
 * (existing appointments or time off)? Used when a customer books a slot, so a
 * conflicting time is refused with a clear message instead of being stored.
 */
export async function hasScheduleConflict(
  supabase: SupabaseClient<Database>,
  technicianId: string,
  start: string,
  end: string
): Promise<boolean> {
  const { data, error } = await supabase.rpc("technician_schedule_conflict", {
    p_technician_id: technicianId,
    p_start: start,
    p_end: end,
  });
  if (error) throw error;
  return Boolean(data);
}
