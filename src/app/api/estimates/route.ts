import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { getCurrentUser, AuthError } from "@/lib/auth";
import { notify } from "@/lib/notifications";
import { formatMoney, validateEstimate } from "@/lib/estimate-costs";
import type { EstimateSubmissionOutcome } from "@/types/database";

// POST /api/estimates — the assigned technician submits an estimate.
//
// Itemized (labour / parts / additional charges) and versioned: the total is
// computed server-side from those lines (never taken from the browser), and a
// revision is stored as a NEW version so the one the customer reviewed is never
// overwritten. The state machine lives in submit_estimate() — see
// supabase/migration_estimate_workflow.sql.
//
// body: {
//   service_request_id, scope, labor_cost, parts_cost, other_cost,
//   other_description?, notes?, submit?: boolean   // false = save as a draft
// }
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) throw new AuthError("Not authenticated", 401);
    if (user.role !== "technician") {
      throw new AuthError("Only technicians can submit estimates", 403);
    }

    const body = await request.json();
    const { service_request_id } = body;

    if (!service_request_id) {
      return NextResponse.json({ error: "service_request_id is required" }, { status: 400 });
    }

    // Validate and normalize the money BEFORE the database sees it. The same
    // function powers the form's live total, so the two can never disagree; the
    // database checks the sum again with estimates_amounts_check.
    const validation = validateEstimate({
      scope: body.scope,
      labor: body.labor_cost,
      parts: body.parts_cost,
      other: body.other_cost,
      otherDescription: body.other_description,
    });

    if (!validation.ok || !validation.amounts || validation.total === undefined) {
      return NextResponse.json(
        { error: validation.message ?? "Invalid estimate", code: validation.code ?? null },
        { status: 400 }
      );
    }

    const submit = body.submit === true;
    const serviceRole = createServiceRoleClient();

    const { data, error } = await serviceRole.rpc("submit_estimate", {
      p_request_id: service_request_id,
      p_technician_id: user.id,
      p_scope: String(body.scope).trim(),
      p_labor: validation.amounts.labor,
      p_parts: validation.amounts.parts,
      p_other: validation.amounts.other,
      p_other_description:
        typeof body.other_description === "string" ? body.other_description : null,
      p_notes: typeof body.notes === "string" ? body.notes : null,
      p_submit: submit,
    });

    if (error) throw error;

    const outcome = data as unknown as EstimateSubmissionOutcome;

    // The function re-checks the assignment against the data; these are the
    // refusals it reports instead of writing a row.
    if (outcome.outcome === "not_assigned") {
      return NextResponse.json(
        { error: "You are not the accepted technician for this request", outcome },
        { status: 403 }
      );
    }
    if (outcome.outcome === "request_closed") {
      return NextResponse.json(
        { error: "This request is no longer open for an estimate", outcome },
        { status: 409 }
      );
    }

    // Read the stored row back (RLS-safe with the service-role client) so the
    // caller can render exactly what was saved.
    const { data: saved } = await serviceRole
      .from("estimates")
      .select("*")
      .eq("id", outcome.estimate_id as string)
      .single();

    // Notify only for a submitted version, and only AFTER the state change has
    // committed. A retried request cannot reach this line twice: the second call
    // either edits the same draft in place or supersedes it as a new version, and
    // the notification is keyed to the version number it reports.
    if (submit) {
      const { data: serviceRequest } = await serviceRole
        .from("service_requests")
        .select("customer_id, appliance_type")
        .eq("id", service_request_id)
        .single();

      if (serviceRequest) {
        const revised = outcome.outcome === "revised";
        try {
          await notify(serviceRole, {
            userId: serviceRequest.customer_id,
            type: revised ? "estimate_revised" : "estimate_received",
            title: revised ? "Revised estimate received" : "Estimate received",
            body: `${formatMoney(validation.total)} for your ${String(
              serviceRequest.appliance_type
            ).replace(/_/g, " ")} repair (version ${outcome.version}). Review it and approve, decline or ask for changes.`,
            link: `/customer/service-request/${service_request_id}`,
          });
        } catch (notifyError) {
          // The estimate is already saved and awaiting a decision: a notification
          // failure must never change that.
          console.error("Estimate notification failed", notifyError);
        }
      }
    }

    return NextResponse.json({ data: saved, outcome }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}

// GET /api/estimates?service_request_id=... — list estimates for a request
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) throw new AuthError("Not authenticated", 401);

    const serviceRequestId = request.nextUrl.searchParams.get("service_request_id");
    if (!serviceRequestId) {
      return NextResponse.json(
        { error: "service_request_id query param is required" },
        { status: 400 }
      );
    }

    const supabase = createClient();
    const { data, error } = await supabase
      .from("estimates")
      .select("*")
      .eq("service_request_id", serviceRequestId)
      .order("created_at", { ascending: true });

    if (error) throw error;

    return NextResponse.json({ data });
  } catch (err) {
    return handleError(err);
  }
}

function handleError(err: unknown) {
  if (err instanceof AuthError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error(err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
