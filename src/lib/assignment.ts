import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, ServiceRequestRow } from "@/types/database";
import { notify } from "@/lib/notifications";

/**
 * Fair technician assignment by ROTATION, not by rating/experience score.
 *
 * Each appliance type has its own implicit queue: every approved technician
 * qualified for that type has a position based on when they last ACCEPTED a
 * job of that type (technician_queue_state.last_assigned_at). Never-assigned
 * technicians (no row yet) are at the very front. A technician currently
 * doing an active job of that same appliance type is temporarily excluded —
 * they rejoin the queue, at the back, only once that job clears.
 *
 * This deliberately does NOT weight by rating, experience, or distance —
 * that's the whole point: a technician with zero reviews gets the same shot
 * as a five-star veteran, in turn.
 *
 * Must be called with a service-role client — assignment is entirely
 * system-controlled, never a direct user action.
 */
export async function assignTechnician(
  supabase: SupabaseClient<Database>,
  serviceRequest: ServiceRequestRow
): Promise<ServiceRequestRow> {
  // 1. Who's already been offered/rejected THIS specific request — never re-offer them it.
  const { data: history } = await supabase
    .from("technician_offer_history")
    .select("technician_id")
    .eq("service_request_id", serviceRequest.id);
  const excludedForThisRequest = new Set((history ?? []).map((h) => h.technician_id));

  // 2. Every approved technician qualified for this appliance type.
  const { data: technicians } = await supabase
    .from("technicians")
    .select("id, specializations, approved")
    .eq("approved", true);
  const technicianIds = (technicians ?? []).map((technician) => technician.id);
  const { data: activeUsers } = technicianIds.length
    ? await supabase.from("users").select("id").in("id", technicianIds).eq("is_active", true)
    : { data: [] };
  const activeTechnicianIds = new Set((activeUsers ?? []).map((user) => user.id));
  const qualified = (technicians ?? []).filter(
    (t) =>
      activeTechnicianIds.has(t.id) &&
      t.specializations.includes(serviceRequest.appliance_type) &&
      !excludedForThisRequest.has(t.id)
  );

  if (!qualified.length) {
    return finalize(supabase, serviceRequest.id, null, "waiting");
  }

  // 3. Exclude anyone currently doing ANY active job — a technician is
  // temporarily unavailable for every appliance type while a job is active.
  const qualifiedIds = qualified.map((t) => t.id);
  const { data: activeBookings } = await supabase
    .from("bookings")
    .select("technician_id")
    .in("technician_id", qualifiedIds)
    .in("status", ["pending", "in_progress", "awaiting_inspection"]);

  const busyTechnicianIds = new Set((activeBookings ?? []).map((b) => b.technician_id));

  const eligible = qualified.filter((t) => !busyTechnicianIds.has(t.id));

  if (!eligible.length) {
    return finalize(supabase, serviceRequest.id, null, "waiting");
  }

  // 4. Order by queue position: last_assigned_at ascending, nulls (never
  // assigned) first — that's genuinely the front of the queue.
  const eligibleIds = eligible.map((t) => t.id);
  const { data: queueRows } = await supabase
    .from("technician_queue_state")
    .select("technician_id, last_assigned_at")
    .eq("appliance_type", serviceRequest.appliance_type)
    .in("technician_id", eligibleIds);

  const lastAssignedMap = new Map(
    (queueRows ?? []).map((q) => [q.technician_id, q.last_assigned_at])
  );

  const sorted = [...eligible].sort((a, b) => {
    const aTime = lastAssignedMap.get(a.id);
    const bTime = lastAssignedMap.get(b.id);
    if (!aTime && !bTime) return 0;
    if (!aTime) return -1; // never assigned = front of queue
    if (!bTime) return 1;
    return new Date(aTime).getTime() - new Date(bTime).getTime();
  });

  const next = sorted[0];

  const updated = await finalize(supabase, serviceRequest.id, next.id, "offered");

  await supabase
    .from("technician_offer_history")
    .insert({ service_request_id: serviceRequest.id, technician_id: next.id, status: "offered" });

  await notify(supabase, {
    userId: next.id,
    type: "job_offered",
    title: "New job offer",
    body: `A ${serviceRequest.appliance_type.replace(/_/g, " ")} repair is available — respond to claim it.`,
    link: "/technician/estimate-requests",
  });

  return updated;
}

async function finalize(
  supabase: SupabaseClient<Database>,
  requestId: string,
  technicianId: string | null,
  status: "offered" | "waiting"
): Promise<ServiceRequestRow> {
  const { data, error } = await supabase
    .from("service_requests")
    .update({ assigned_technician_id: technicianId, assignment_status: status })
    .eq("id", requestId)
    .select()
    .single();
  if (error) throw error;
  return data;
}

/**
 * Called when a technician ACCEPTS an offer — this is the moment they're
 * sent to the back of their appliance-type queue (matching the spec: the
 * queue-ordering timestamp updates on acceptance, and the existing "currently
 * active" exclusion in assignTechnician already keeps them out of rotation
 * for the duration of the job — no separate "on completion" hook is needed).
 */
export async function markQueuePosition(
  supabase: SupabaseClient<Database>,
  technicianId: string,
  applianceType: string
) {
  await supabase.from("technician_queue_state").upsert(
    {
      technician_id: technicianId,
      appliance_type: applianceType,
      last_assigned_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "technician_id,appliance_type" }
  );
}

/**
 * Re-runs assignment for every request currently stuck "waiting" — call
 * this after a technician is newly approved or their specializations
 * change, since a previously-unmatchable request might now have a fit.
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
