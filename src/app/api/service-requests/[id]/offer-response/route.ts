import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getCurrentUser, AuthError } from "@/lib/auth";
import { respondToOffer } from "@/lib/assignment";
import { notify } from "@/lib/notifications";

// POST /api/service-requests/:id/offer-response — technician accepts or rejects
// the request currently offered to them.
//
// Both paths run inside ONE Postgres transaction (respond_to_offer):
//
//   accept  → assignment confirmed, and the technician's queue turn is consumed
//             exactly once (they move to the end of that appliance rotation).
//             The request row is locked, so two technicians can never both
//             accept the same job.
//   decline → reason recorded, no queue position change by default (see the
//             queue_decline_consumes_turn setting), and the request is passed to
//             the next eligible technician in the same transaction.
//
// Skipping/declining never removes anyone from the queue, and completing a job
// never re-rotates it — see QUEUE-SYSTEM.md.
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
    if (action !== "accept" && action !== "decline" && action !== "reject") {
      return NextResponse.json({ error: "action must be 'accept' or 'decline'" }, { status: 400 });
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

    // Only the technician the request is actually offered to may respond — the
    // function re-checks this under the row lock (defence in depth).
    if (
      serviceRequest.assigned_technician_id !== user.id ||
      serviceRequest.assignment_status !== "offered"
    ) {
      throw new AuthError("This request is not currently offered to you", 403);
    }

    const outcome = await respondToOffer(supabase, {
      requestId: params.id,
      technicianId: user.id,
      action: action === "accept" ? "accept" : "decline",
      reason: typeof reason === "string" && reason.trim() ? reason.trim() : null,
    });

    if (outcome.outcome === "accepted") {
      await notify(supabase, {
        userId: serviceRequest.customer_id,
        type: "technician_assigned",
        title: "Technician accepted your request",
        body: `${user.name} has accepted your ${serviceRequest.appliance_type.replace(/_/g, " ")} repair request.`,
        link: `/customer/service-request/${serviceRequest.id}`,
      });
    }

    await supabase
      .from("service_requests")
      .update({ updated_at: new Date().toISOString() })
      .eq("id", params.id);

    const { data: current } = await supabase
      .from("service_requests")
      .select("*")
      .eq("id", params.id)
      .single();

    return NextResponse.json({ data: current, outcome });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
