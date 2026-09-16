import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, AuthError } from "@/lib/auth";
import type { BookingStatus } from "@/types/database";

const VALID_STATUSES: BookingStatus[] = ["pending", "in_progress", "awaiting_inspection", "completed", "cancelled"];

// PATCH /api/bookings/:id — technician updates repair progress: Pending → In Progress → Completed
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) throw new AuthError("Not authenticated", 401);

    const body = await request.json();
    const { status, final_cost } = body;

    if (status && !VALID_STATUSES.includes(status)) {
      return NextResponse.json({ error: "Invalid status value" }, { status: 400 });
    }

    const supabase = createClient();

    const { data: booking, error: fetchError } = await supabase
      .from("bookings")
      .select("*")
      .eq("id", params.id)
      .single();

    if (fetchError || !booking) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    const isStaff = user.role === "admin" || user.role === "super_admin";
    const isTechnician = booking.technician_id === user.id && user.role === "technician";
    const isCustomer = booking.customer_id === user.id && user.role === "customer";
    if (!isTechnician && !isCustomer && !isStaff) {
      throw new AuthError("Not authorized to update this booking", 403);
    }

    if (status) {
      const allowed =
        (isTechnician &&
          ((booking.status === "pending" && status === "in_progress") ||
            (booking.status === "in_progress" && status === "awaiting_inspection"))) ||
        (isCustomer && booking.status === "awaiting_inspection" && status === "completed") ||
        (isStaff &&
          ((booking.status === "pending" && status === "in_progress") ||
            (booking.status === "in_progress" && status === "awaiting_inspection") ||
            (booking.status === "awaiting_inspection" && status === "completed") ||
            status === "cancelled"));
      if (!allowed) {
        return NextResponse.json({ error: "Invalid booking status transition" }, { status: 409 });
      }
    }

    if (final_cost != null && !isTechnician && !isStaff) {
      throw new AuthError("Only the technician or staff can set the final cost", 403);
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (status) updates.status = status;
    if (final_cost != null) updates.final_cost = final_cost;

    const { data: updated, error } = await supabase
      .from("bookings")
      .update(updates)
      .eq("id", params.id)
      .select()
      .single();

    if (error) throw error;

    if (status === "completed") {
      await handleCompletion(supabase, updated);
    }

    return NextResponse.json({ data: updated });
  } catch (err) {
    return handleError(err);
  }
}

async function handleCompletion(
  supabase: ReturnType<typeof createClient>,
  booking: { id: string; customer_id: string; technician_id: string; service_request_id: string; final_cost: number | null }
) {
  const { data: serviceRequest } = await supabase
    .from("service_requests")
    .select("appliance_type")
    .eq("id", booking.service_request_id)
    .single();

  await supabase.from("service_history").insert({
    booking_id: booking.id,
    customer_id: booking.customer_id,
    technician_id: booking.technician_id,
    appliance_type: serviceRequest?.appliance_type ?? "unknown",
    final_cost: booking.final_cost,
    summary: "Repair completed.",
  });

  await supabase
    .from("service_requests")
    .update({ status: "completed", updated_at: new Date().toISOString() })
    .eq("id", booking.service_request_id);

  // free up the technician's job slot and bump their completed count
  const { data: tech } = await supabase
    .from("technicians")
    .select("active_job_load, jobs_completed")
    .eq("id", booking.technician_id)
    .single();

  if (tech) {
    await supabase
      .from("technicians")
      .update({
        active_job_load: Math.max(0, tech.active_job_load - 1),
        jobs_completed: tech.jobs_completed + 1,
        // once a tech clears 5 completed jobs they graduate out of "new" status
        is_new: tech.jobs_completed + 1 < 5,
      })
      .eq("id", booking.technician_id);
  }
}

function handleError(err: unknown) {
  if (err instanceof AuthError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error(err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
