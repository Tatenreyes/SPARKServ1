import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { getCurrentUser, AuthError } from "@/lib/auth";
import type { BookingStatus, Database } from "@/types/database";

const VALID_STATUSES: BookingStatus[] = ["pending", "in_progress", "awaiting_inspection", "completed", "cancelled"];

// PATCH /api/bookings/:id — drive the repair lifecycle.
//   pending → in_progress → awaiting_inspection   (technician)
//   awaiting_inspection → completed               (customer signs off)
//   anything active → cancelled                   (staff)
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) throw new AuthError("Not authenticated", 401);

    const body = await request.json();
    const { status, final_cost, inspection_note } = body;

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
            (booking.status !== "completed" && status === "cancelled")));
      if (!allowed) {
        return NextResponse.json({ error: "Invalid booking status transition" }, { status: 409 });
      }
    }

    if (final_cost != null && !isTechnician && !isStaff) {
      throw new AuthError("Only the technician or staff can set the final cost", 403);
    }

    // Closing a job is the customer attesting that the repair actually works.
    // Requiring a written confirmation makes an accidental click recoverable
    // and gives the archived service_history row something meaningful to say.
    if (status === "completed" && isCustomer && !String(inspection_note ?? "").trim()) {
      return NextResponse.json(
        { error: "Please confirm what you inspected before closing this repair." },
        { status: 400 }
      );
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (status) updates.status = status;
    if (final_cost != null) updates.final_cost = final_cost;
    if (status === "completed" && isCustomer) {
      updates.inspection_confirmed_at = new Date().toISOString();
      updates.inspection_note = String(inspection_note).trim();
    }

    const { data: updated, error } = await supabase
      .from("bookings")
      .update(updates)
      .eq("id", params.id)
      .select()
      .single();

    if (error) throw error;

    // NOTE: completing or cancelling a job must NOT re-rotate the queue. The
    // technician's turn was consumed when they ACCEPTED the request, so there is
    // deliberately no queue call anywhere in this handler (QUEUE-SYSTEM.md §18-§20).
    // What does need updating is their cached operational status, so the queue
    // screens show ON_JOB/AVAILABLE/SCHEDULED correctly after a transition.
    const serviceRole = createServiceRoleClient();

    if (status === "completed") {
      await handleCompletion(supabase, serviceRole, updated);
    } else if (status === "cancelled") {
      await handleCancellation(serviceRole, updated);
    }

    if (status && booking.technician_id) {
      await serviceRole.rpc("refresh_technician_operational_status", {
        p_technician_id: booking.technician_id,
      });
    }

    return NextResponse.json({ data: updated });
  } catch (err) {
    return handleError(err);
  }
}

/**
 * Releases the technician's job slot when a booking is cancelled. Without
 * this, active_job_load only ever grows and the technician's "current load"
 * never reflects reality.
 *
 * Note the deliberate absence of any queue call: a cancellation does not reset
 * the technician to the front of the rotation, and does not cost them a second
 * turn either (§18).
 */
async function handleCancellation(
  supabase: SupabaseClient<Database>,
  booking: { technician_id: string }
) {
  const { data: tech } = await supabase
    .from("technicians")
    .select("active_job_load")
    .eq("id", booking.technician_id)
    .single();

  if (tech) {
    await supabase
      .from("technicians")
      .update({ active_job_load: Math.max(0, tech.active_job_load - 1) })
      .eq("id", booking.technician_id);
  }
}

async function handleCompletion(
  supabase: ReturnType<typeof createClient>,
  serviceRole: SupabaseClient<Database>,
  booking: {
    id: string;
    customer_id: string;
    technician_id: string;
    service_request_id: string;
    final_cost: number | null;
    inspection_note: string | null;
  }
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
    summary: booking.inspection_note
      ? `Repair completed. Customer inspection: ${booking.inspection_note}`
      : "Repair completed.",
  });

  await supabase
    .from("service_requests")
    .update({ status: "completed", updated_at: new Date().toISOString() })
    .eq("id", booking.service_request_id);

  // free up the technician's job slot and bump their completed count. Done with
  // the service-role client: when the CUSTOMER closes the job, RLS blocks them
  // from updating the technicians table, which is why this counter used to drift.
  const { data: tech } = await serviceRole
    .from("technicians")
    .select("active_job_load, jobs_completed")
    .eq("id", booking.technician_id)
    .single();

  if (tech) {
    const completed = tech.jobs_completed + 1;
    await serviceRole
      .from("technicians")
      .update({
        active_job_load: Math.max(0, tech.active_job_load - 1),
        jobs_completed: completed,
        // once a tech clears 5 completed jobs they graduate out of "new" status
        is_new: completed < 5,
      })
      .eq("id", booking.technician_id);
  }

  // Deliberately NOTHING queue-related here. The technician moved to the end of
  // the rotation when they accepted this request; completing it must not move
  // them again (§20).
}

function handleError(err: unknown) {
  if (err instanceof AuthError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error(err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
