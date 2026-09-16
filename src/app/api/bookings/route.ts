import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, AuthError } from "@/lib/auth";

// POST /api/bookings — customer confirms a technician + estimate, creating a booking
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) throw new AuthError("Not authenticated", 401);
    if (user.role !== "customer") {
      throw new AuthError("Only customers can create bookings", 403);
    }

    const body = await request.json();
    const { service_request_id, estimate_id, scheduled_at, notes } = body;
    if (!service_request_id || !estimate_id || !scheduled_at) {
      return NextResponse.json(
        { error: "service_request_id, estimate_id, and scheduled_at are required" },
        { status: 400 }
      );
    }

    const supabase = createClient();
    const { data: serviceRequest, error: requestError } = await supabase
      .from("service_requests")
      .select("id, customer_id, status, assigned_technician_id, assignment_status")
      .eq("id", service_request_id)
      .eq("customer_id", user.id)
      .single();

    if (requestError || !serviceRequest) {
      return NextResponse.json({ error: "Service request not found" }, { status: 404 });
    }
    if (serviceRequest.assignment_status !== "accepted" || !["quoted", "open"].includes(serviceRequest.status)) {
      return NextResponse.json({ error: "This service request is not ready to be booked" }, { status: 409 });
    }

    const { data: estimate, error: estimateError } = await supabase
      .from("estimates")
      .select("id, service_request_id, technician_id, status")
      .eq("id", estimate_id)
      .single();

    if (
      estimateError ||
      !estimate ||
      estimate.service_request_id !== service_request_id ||
      estimate.technician_id !== serviceRequest.assigned_technician_id ||
      estimate.status !== "pending"
    ) {
      return NextResponse.json({ error: "Estimate does not match an accepted technician offer" }, { status: 400 });
    }

    const { data: booking, error } = await supabase
      .from("bookings")
      .insert({
        service_request_id,
        technician_id: estimate.technician_id,
        estimate_id,
        customer_id: user.id,
        scheduled_at,
        notes: notes ?? null,
        status: "pending",
      })
      .select()
      .single();

    if (error) throw error;

    await supabase
      .from("service_requests")
      .update({ status: "booked", updated_at: new Date().toISOString() })
      .eq("id", service_request_id);
    await supabase.from("estimates").update({ status: "accepted" }).eq("id", estimate_id);

    const { data: tech } = await supabase
      .from("technicians")
      .select("active_job_load")
      .eq("id", estimate.technician_id)
      .single();
    if (tech) {
      await supabase
        .from("technicians")
        .update({ active_job_load: tech.active_job_load + 1 })
        .eq("id", estimate.technician_id);
    }

    return NextResponse.json({ data: booking }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}

// GET /api/bookings — list bookings scoped to the caller's role
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) throw new AuthError("Not authenticated", 401);

    const supabase = createClient();
    let query = supabase.from("bookings").select("*").order("scheduled_at", { ascending: true });

    if (user.role === "customer") {
      query = query.eq("customer_id", user.id);
    } else if (user.role === "technician") {
      query = query.eq("technician_id", user.id);
    }
    // admin / super_admin see all bookings

    const { data, error } = await query;
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
