import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
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
    const { service_request_id, estimate_id, scheduled_at, notes, duration_minutes } = body;
    if (!service_request_id || !estimate_id || !scheduled_at) {
      return NextResponse.json(
        { error: "service_request_id, estimate_id, and scheduled_at are required" },
        { status: 400 }
      );
    }

    const supabase = createClient();
    const { data: serviceRequest, error: requestError } = await supabase
      .from("service_requests")
      .select("id, customer_id, status, assigned_technician_id, assignment_status, requested_duration_minutes")
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

    // How long the appointment occupies the technician. Conflict checks and the
    // daily-hours capacity limit both need it; two hours is the platform default.
    const bookingMinutes =
      typeof duration_minutes === "number" && duration_minutes > 0
        ? Math.round(duration_minutes)
        : (serviceRequest.requested_duration_minutes ?? 120);

    // Refuse a slot that clashes with the technician's real schedule instead of
    // storing a double-booking. This is the mirror image of the queue rule: a
    // future appointment never blocks future offers, but two appointments that
    // genuinely overlap are physically impossible.
    const scheduledStart = new Date(scheduled_at);
    if (Number.isNaN(scheduledStart.getTime())) {
      return NextResponse.json({ error: "scheduled_at must be a valid date" }, { status: 400 });
    }
    const scheduledEnd = new Date(scheduledStart.getTime() + bookingMinutes * 60_000);

    const serviceRole = createServiceRoleClient();
    const { data: conflict, error: conflictError } = await serviceRole.rpc("technician_schedule_conflict", {
      p_technician_id: estimate.technician_id,
      p_start: scheduledStart.toISOString(),
      p_end: scheduledEnd.toISOString(),
    });
    if (conflictError) throw conflictError;
    if (conflict) {
      return NextResponse.json(
        {
          error:
            "That time clashes with another appointment this technician already has. Please choose a different slot.",
        },
        { status: 409 }
      );
    }

    const { data: booking, error } = await supabase
      .from("bookings")
      .insert({
        service_request_id,
        technician_id: estimate.technician_id,
        estimate_id,
        customer_id: user.id,
        scheduled_at,
        duration_minutes: bookingMinutes,
        notes: notes ?? null,
        status: "pending",
      })
      .select()
      .single();

    if (error) throw error;

    await supabase
      .from("service_requests")
      .update({
        status: "booked",
        updated_at: new Date().toISOString(),
        // The confirmed appointment replaces the (optional) preference the
        // customer gave with the request, so the queue engine and the schedule
        // agree on one window.
        requested_window_start: scheduledStart.toISOString(),
        requested_window_end: scheduledEnd.toISOString(),
        requested_duration_minutes: bookingMinutes,
      })
      .eq("id", service_request_id);
    await supabase.from("estimates").update({ status: "accepted" }).eq("id", estimate_id);

    // Capacity is computed from real appointments, so the legacy
    // `active_job_load` counter is refreshed with the service-role client: a
    // customer updating a technician row is blocked by RLS, which is why this
    // counter used to drift.
    const { data: tech } = await serviceRole
      .from("technicians")
      .select("active_job_load")
      .eq("id", estimate.technician_id)
      .single();
    if (tech) {
      await serviceRole
        .from("technicians")
        .update({ active_job_load: tech.active_job_load + 1 })
        .eq("id", estimate.technician_id);
    }
    await serviceRole.rpc("refresh_technician_operational_status", {
      p_technician_id: estimate.technician_id,
    });

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
