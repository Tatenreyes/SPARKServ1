import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getCurrentUser, AuthError } from "@/lib/auth";
import type { EstimateDecision, EstimateDecisionOutcome } from "@/types/database";

/**
 * PATCH /api/estimates/:id — legacy shape, kept working.
 *
 * The estimate lifecycle now runs through POST /api/estimates/:id/decision
 * (`{ decision, reason }`). This endpoint maps the old body onto it, so a caller
 * that sent `{ status: "rejected" }` still behaves; anything else is refused with
 * a pointer at the new route. It deliberately does NOT accept `status:
 * "accepted"`: an approval is tied to the version that was reviewed, so it must
 * go through the decision endpoint (and the service-role function behind it).
 */
const LEGACY_STATUS_TO_DECISION: Record<string, EstimateDecision> = {
  rejected: "decline",
  revision_requested: "request_revision",
};

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await getCurrentUser();
    if (!user) throw new AuthError("Not authenticated", 401);

    const body = await request.json().catch(() => ({}));
    const decision = LEGACY_STATUS_TO_DECISION[body.status];

    if (!decision) {
      return NextResponse.json(
        {
          error:
            "Use POST /api/estimates/:id/decision with { decision: 'approve' | 'decline' | 'request_revision' }.",
        },
        { status: 400 }
      );
    }

    const serviceRole = createServiceRoleClient();

    const { data: estimate, error: fetchError } = await serviceRole
      .from("estimates")
      .select("id, service_request_id, technician_id, version, status, estimated_cost")
      .eq("id", params.id)
      .single();

    if (fetchError || !estimate) {
      return NextResponse.json({ error: "Estimate not found" }, { status: 404 });
    }

    const { data: serviceRequest } = await serviceRole
      .from("service_requests")
      .select("customer_id")
      .eq("id", estimate.service_request_id)
      .single();

    const isOwningCustomer = user.role === "customer" && serviceRequest?.customer_id === user.id;
    const isStaff = user.role === "admin" || user.role === "super_admin";

    if (!isOwningCustomer && !isStaff) {
      throw new AuthError("Not authorized to update this estimate", 403);
    }

    const { data, error } = await serviceRole.rpc("decide_estimate", {
      p_estimate_id: params.id,
      p_actor_id: user.id,
      p_decision: decision,
      p_reason: typeof body.reason === "string" ? body.reason : null,
    });

    if (error) throw error;

    const outcome = data as unknown as EstimateDecisionOutcome;
    if (outcome.outcome === "not_pending") {
      return NextResponse.json(
        { error: "This estimate version has already been decided.", outcome },
        { status: 409 }
      );
    }

    const { data: updated } = await serviceRole
      .from("estimates")
      .select("*")
      .eq("id", params.id)
      .single();

    return NextResponse.json({ data: updated, outcome });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
