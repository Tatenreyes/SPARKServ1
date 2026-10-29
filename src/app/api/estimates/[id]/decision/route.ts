import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getCurrentUser, AuthError } from "@/lib/auth";
import { notify } from "@/lib/notifications";
import { formatMoney } from "@/lib/estimate-costs";
import type { EstimateDecision, EstimateDecisionOutcome } from "@/types/database";

const DECISIONS: EstimateDecision[] = ["approve", "decline", "request_revision"];

/**
 * POST /api/estimates/:id/decision — the customer decides on ONE estimate version.
 *
 * body: { decision: "approve" | "decline" | "request_revision", reason?: string }
 *
 * The decision is applied by decide_estimate() (service_role only), which:
 *   * re-reads the actor's role from the database instead of trusting a claim,
 *   * requires the estimate to still be `pending`, so a retry, a double click or a
 *     second tab cannot decide the same version twice, and
 *   * records who decided and when.
 *
 * Approving NEVER creates a booking, marks a payment or moves a queue position:
 * it only makes the approved version the one the customer may then schedule
 * against (`POST /api/bookings`).
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const user = await getCurrentUser();
    if (!user) throw new AuthError("Not authenticated", 401);

    const body = await request.json().catch(() => ({}));
    const decision = body.decision as EstimateDecision;

    if (!DECISIONS.includes(decision)) {
      return NextResponse.json(
        { error: "decision must be 'approve', 'decline' or 'request_revision'" },
        { status: 400 }
      );
    }

    const reason =
      typeof body.reason === "string" && body.reason.trim() ? body.reason.trim() : null;

    const serviceRole = createServiceRoleClient();

    // Fetch first so ownership can be checked with a clear 404/403 before the
    // function's own (data-level) authorization runs.
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
      .select("id, customer_id, appliance_type")
      .eq("id", estimate.service_request_id)
      .single();

    const isOwningCustomer = user.role === "customer" && serviceRequest?.customer_id === user.id;
    const isStaff = user.role === "admin" || user.role === "super_admin";

    if (!isOwningCustomer && !isStaff) {
      throw new AuthError("You are not authorized to decide this estimate", 403);
    }

    const { data, error } = await serviceRole.rpc("decide_estimate", {
      p_estimate_id: params.id,
      p_actor_id: user.id,
      p_decision: decision,
      p_reason: reason,
    });

    if (error) throw error;

    const outcome = data as unknown as EstimateDecisionOutcome;

    // The version was already decided (or replaced) by the time this call
    // landed. Nothing changed, so nothing is notified — this is what keeps a
    // retried handler from sending a duplicate notification.
    if (outcome.outcome === "not_pending") {
      return NextResponse.json(
        {
          error: "This estimate version has already been decided.",
          outcome,
        },
        { status: 409 }
      );
    }

    // Tell the assigned technician what happened to their quote. A failure here
    // cannot change the decision: it is already committed.
    if (estimate.technician_id) {
      const appliance = String(serviceRequest?.appliance_type ?? "repair").replace(/_/g, " ");
      const amount = formatMoney(Number(estimate.estimated_cost));
      const versionLabel = `version ${estimate.version}`;
      const copy =
        decision === "approve"
          ? {
              type: "estimate_approved",
              title: "Estimate approved",
              body: `Your ${amount} estimate (${versionLabel}) for the ${appliance} repair was approved. The customer can now book a time with you.`,
            }
          : decision === "decline"
            ? {
                type: "estimate_declined",
                title: "Estimate declined",
                body: `Your ${amount} estimate (${versionLabel}) for the ${appliance} repair was declined${reason ? `: ${reason}` : "."}`,
              }
            : {
                type: "estimate_revision_requested",
                title: "Revision requested",
                body: `The customer asked for a change to your ${appliance} estimate (${versionLabel})${reason ? `: ${reason}` : "."} Submit a revised version for approval.`,
              };

      try {
        await notify(serviceRole, {
          userId: estimate.technician_id,
          type: copy.type,
          title: copy.title,
          body: copy.body,
          link: "/technician/estimate-requests",
        });
      } catch (notifyError) {
        console.error("Estimate decision notification failed", notifyError);
      }
    }

    return NextResponse.json({ data: outcome, decision });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// GET is not supported: a decision is a POST (it changes state).
export async function GET() {
  return NextResponse.json({ error: "Method not allowed" }, { status: 405 });
}
