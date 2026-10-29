import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { getCurrentUser, AuthError } from "@/lib/auth";
import type { BookingStatus } from "@/types/database";

const VALID_STATUSES: BookingStatus[] = [
  "pending",
  "in_progress",
  "awaiting_inspection",
  "awaiting_payment",
  "completed",
  "cancelled",
];

// PATCH /api/bookings/:id — drive the repair lifecycle.
//
//   pending → in_progress → awaiting_inspection   (technician, or staff)
//   pending → cancelled                            (the customer, before work
//                                                   starts; staff any time)
//   awaiting_inspection → awaiting_payment         (the CUSTOMER only: their
//                                                   written sign-off, with the
//                                                   inspection note)
//   awaiting_payment → completed                   (NOT here — an administrator
//                                                   verifying the payment, via
//                                                   confirm_payment())
//
// The database enforces every one of these rules independently
// (enforce_booking_update_rules + the RLS policies in
// supabase/migration_rls_workflow_enforcement.sql), so this route is the
// friendly-message layer rather than the boundary.
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
        // The customer attests their own inspection, which advances the repair to
        // the payment step — it does not complete it. Cancelling their own booking
        // is allowed only while it is still `pending` (before work starts); after
        // that they use support or an administrator.
        (isCustomer &&
          ((booking.status === "awaiting_inspection" && status === "awaiting_payment") ||
            (booking.status === "pending" && status === "cancelled"))) ||
        (isStaff &&
          ((booking.status === "pending" && status === "in_progress") ||
            (booking.status === "in_progress" && status === "awaiting_inspection") ||
            (booking.status !== "completed" && status === "cancelled")));
      if (!allowed) {
        return NextResponse.json({ error: "Invalid booking status transition" }, { status: 409 });
      }
    }

    if (final_cost != null && !isTechnician && !isStaff) {
      throw new AuthError("Only the technician or staff can set the final cost", 403);
    }

    if (final_cost != null && (!Number.isFinite(Number(final_cost)) || Number(final_cost) < 0)) {
      return NextResponse.json(
        { error: "final_cost must be a non-negative number" },
        { status: 400 }
      );
    }

    // The customer's payment step pays exactly `final_cost`, and /api/payments
    // refuses to accept a payment while it is null. So a technician must record
    // the cost before handing the job to the customer for inspection.
    if (
      status === "awaiting_inspection" &&
      booking.final_cost == null &&
      final_cost == null
    ) {
      return NextResponse.json(
        { error: "Enter the final repair cost before sending the job for inspection." },
        { status: 400 }
      );
    }

    // Confirming a satisfactory inspection is the customer attesting that the
    // repair actually works. Requiring a written confirmation makes an accidental
    // click recoverable and gives the archived service_history row something
    // meaningful to say. The confirmation advances to the payment step — it does
    // not complete the repair; an administrator's payment verification does that.
    if (status === "awaiting_payment" && isCustomer && !String(inspection_note ?? "").trim()) {
      return NextResponse.json(
        { error: "Please confirm what you inspected before continuing to payment." },
        { status: 400 }
      );
    }

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (status) updates.status = status;
    if (final_cost != null) updates.final_cost = final_cost;
    if (status === "awaiting_payment" && isCustomer) {
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
    //
    // Completion is deliberately absent here: it happens inside confirm_payment(),
    // together with the service_history row, the request status and the technician
    // counters, in one transaction. A status change that reaches `completed`
    // through this route is refused above and by the database.
    const serviceRole = createServiceRoleClient();

    // Cancelling does NOT release the technician's slot here any more. Step 18's
    // AFTER UPDATE trigger on `bookings` (`release_slot_after_booking_cancel`) does
    // it inside the same transaction as this status change, so the counter cannot
    // drift when a second call fails — and a cancellation written anywhere else
    // (an administrator, a service-role script) releases too. See
    // supabase/migration_cancel_release.sql.

    // That trigger also refreshes the cached operational status for a cancellation,
    // so this call is only for the other transitions. Re-issuing it here would be a
    // second round trip for a value the database has just written.
    if (status && status !== "cancelled" && booking.technician_id) {
      await serviceRole.rpc("refresh_technician_operational_status", {
        p_technician_id: booking.technician_id,
      });
    }

    return NextResponse.json({ data: updated });
  } catch (err) {
    return handleError(err);
  }
}

// The technician-slot release used to live here, as a second RPC call AFTER the
// status change had already committed. That is exactly what step 18 removes: the
// release is now the `release_slot_after_booking_cancel` trigger on `bookings`, in
// the same transaction as the cancellation, for every writer. See
// supabase/migration_cancel_release.sql.
//
// Completion never lived here either: it runs inside `confirm_payment()` — the same
// transaction that verifies the payment — so a repair can never be closed without a
// verified payment, and a half-failed completion is impossible. See
// `supabase/migration_rls_workflow_enforcement.sql`.

function handleError(err: unknown) {
  if (err instanceof AuthError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error(err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
