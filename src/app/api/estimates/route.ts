import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { getCurrentUser, AuthError } from "@/lib/auth";
import { notify } from "@/lib/notifications";

// POST /api/estimates — technician submits a cost estimate for a service request
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) throw new AuthError("Not authenticated", 401);
    if (user.role !== "technician") {
      throw new AuthError("Only technicians can submit estimates", 403);
    }

    const body = await request.json();
    const { service_request_id, estimated_cost, notes } = body;

    if (!service_request_id || estimated_cost == null) {
      return NextResponse.json(
        { error: "service_request_id and estimated_cost are required" },
        { status: 400 }
      );
    }


    if (!Number.isFinite(Number(estimated_cost)) || Number(estimated_cost) < 0) {
      return NextResponse.json({ error: "estimated_cost must be a non-negative number" }, { status: 400 });
    }
    const supabase = createClient();
    const { data: serviceRequest, error: requestError } = await supabase
      .from("service_requests")
      .select("id, assigned_technician_id, assignment_status, status")
      .eq("id", service_request_id)
      .single();

    if (requestError || !serviceRequest) {
      return NextResponse.json({ error: "Service request not found" }, { status: 404 });
    }
    if (
      serviceRequest.assigned_technician_id !== user.id ||
      serviceRequest.assignment_status !== "accepted" ||
      !["open", "quoted"].includes(serviceRequest.status)
    ) {
      return NextResponse.json({ error: "You do not own an accepted offer for this request" }, { status: 403 });
    }

    const { data, error } = await supabase
      .from("estimates")
      .insert({
        service_request_id,
        technician_id: user.id,
        estimated_cost,
        notes: notes ?? null,
        status: "pending",
      })
      .select()
      .single();

    if (error) throw error;

    // Move the parent request into "quoted" status
    const { data: updatedRequest } = await supabase
      .from("service_requests")
      .update({ status: "quoted", updated_at: new Date().toISOString() })
      .eq("id", service_request_id)
      .select("customer_id, appliance_type")
      .single();

    if (updatedRequest) {
      const serviceRoleClient = createServiceRoleClient();
      await notify(serviceRoleClient, {
        userId: updatedRequest.customer_id,
        type: "estimate_received",
        title: "Estimate received",
        body: `You received a ₱${estimated_cost.toFixed(2)} estimate for your ${updatedRequest.appliance_type.replace(/_/g, " ")} repair.`,
        link: `/customer/service-request/${service_request_id}`,
      });
    }

    return NextResponse.json({ data }, { status: 201 });
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
