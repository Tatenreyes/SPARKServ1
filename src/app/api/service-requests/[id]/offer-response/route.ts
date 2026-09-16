import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getCurrentUser, AuthError } from "@/lib/auth";
import { assignTechnician, markQueuePosition } from "@/lib/assignment";
import { notify } from "@/lib/notifications";

// POST /api/service-requests/:id/offer-response — technician accepts or
// rejects the request currently offered to them.
//
// Accept: sends them to the back of that appliance type's queue
// (technician_queue_state.last_assigned_at = now) and marks the request
// accepted, so the estimate flow can continue.
//
// Reject: immediately re-runs assignment to offer the next technician in
// line — this technician will never be re-offered this same request, but
// their queue position for OTHER future requests is untouched (they only
// move to the back by actually taking a job, not by turning one down).
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) throw new AuthError("Not authenticated", 401);
    if (user.role !== "technician") {
      throw new AuthError("Only technicians can respond to an assignment offer", 403);
    }

    const { action, reason } = await request.json();
    if (action !== "accept" && action !== "reject") {
      return NextResponse.json({ error: "action must be 'accept' or 'reject'" }, { status: 400 });
    }

    const supabase = createServiceRoleClient();

    const { data: serviceRequest, error: fetchError } = await supabase
      .from("service_requests")
      .select("*")
      .eq("id", params.id)
      .single();

    if (fetchError || !serviceRequest) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }

    if (serviceRequest.assigned_technician_id !== user.id || serviceRequest.assignment_status !== "offered") {
      throw new AuthError("This request is not currently offered to you", 403);
    }

    if (action === "accept") {
      const { data: updated, error } = await supabase
        .from("service_requests")
        .update({ assignment_status: "accepted", status: "quoted" })
        .eq("id", params.id)
        .eq("assigned_technician_id", user.id)
        .eq("assignment_status", "offered")
        .select()
        .single();
      if (error) throw error;

      await supabase
        .from("technician_offer_history")
        .update({ status: "accepted" })
        .eq("service_request_id", params.id)
        .eq("technician_id", user.id)
        .eq("status", "offered");

      // The moment they take the job — send them to the back of this
      // appliance type's queue.
      await markQueuePosition(supabase, user.id, serviceRequest.appliance_type);

      await notify(supabase, {
        userId: serviceRequest.customer_id,
        type: "technician_assigned",
        title: "Technician assigned",
        body: `${user.name} has accepted your ${serviceRequest.appliance_type.replace(/_/g, " ")} repair request.`,
        link: `/customer/service-request/${serviceRequest.id}`,
      });

      return NextResponse.json({ data: updated });
    }

    // reject
    await supabase
      .from("technician_offer_history")
      .update({ status: "rejected", reason: reason ?? null })
      .eq("service_request_id", params.id)
      .eq("technician_id", user.id)
      .eq("status", "offered");

    // Rejecting an offer carries the same queue-position penalty as accepting.
    await markQueuePosition(supabase, user.id, serviceRequest.appliance_type);

    const reassigned = await assignTechnician(supabase, serviceRequest);

    return NextResponse.json({ data: reassigned });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
