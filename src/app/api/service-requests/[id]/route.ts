import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { getCurrentUser, AuthError } from "@/lib/auth";

export async function GET(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) throw new AuthError("Not authenticated", 401);

    const supabase = createClient();
    const { data, error } = await supabase
      .from("service_requests")
      .select("*")
      .eq("id", params.id)
      .single();

    if (error) throw error;

    return NextResponse.json({ data });
  } catch (err) {
    return handleError(err);
  }
}

// PATCH /api/service-requests/:id — update status (e.g. customer cancels, system marks booked)
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) throw new AuthError("Not authenticated", 401);

    const body = await request.json();
    const allowedFields = ["status", "chatbot_resolved"];
    const updates: Record<string, unknown> = {};
    for (const key of allowedFields) {
      if (key in body) updates[key] = body[key];
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No valid fields to update" }, { status: 400 });
    }

    updates.updated_at = new Date().toISOString();

    const supabase = createClient();
    const { data, error } = await supabase
      .from("service_requests")
      .update(updates)
      .eq("id", params.id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ data });
  } catch (err) {
    return handleError(err);
  }
}

/**
 * DELETE /api/service-requests/:id — the customer removes a request that never
 * went anywhere.
 *
 * WHY THIS IS NOT A CLIENT DELETE. There is no DELETE policy on
 * `service_requests` — every workflow table in this schema is written by a
 * trusted path — so a customer cannot remove their own row through PostgREST.
 * This route runs on the service-role client and re-does the authorization
 * itself, and it owns the refusal list, because a hard delete CASCADES:
 * `estimates`, `bookings` and `technician_offer_history` all reference the
 * request `on delete cascade`, and a booking drags its messages, visits, rating
 * and payment with it.
 *
 * So removal is allowed only while nothing real depends on the request:
 *
 *   * no booking — an appointment holds a technician's slot and can carry a
 *     payment, and a customer action never deletes a money record;
 *   * no accepted assignment — that is somebody's job, already accepted;
 *   * no estimate of any status — a technician has already done that work;
 *   * not completed — a finished repair is the customer's service history.
 *
 * Anything further along is withdrawn through support, not deleted. (Releasing an
 * in-flight request — freeing the assignment and cancelling its appointment — is a
 * workflow decision that belongs in its own migration; see the follow-up noted at
 * the end of supabase/migration_booking_eligibility.sql.)
 *
 * A request belonging to somebody else answers exactly like one that does not
 * exist, so this endpoint cannot be used to probe for ids.
 */
export async function DELETE(
  _request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) throw new AuthError("Not authenticated", 401);
    if (user.role !== "customer") {
      throw new AuthError("Only the customer can remove their own request", 403);
    }

    let serviceRole: ReturnType<typeof createServiceRoleClient> | null = null;
    try {
      serviceRole = createServiceRoleClient();
    } catch (error) {
      // A deployment without the service key cannot do this safely: say so
      // instead of falling back to a client delete the database would refuse.
      console.error("Removing a request needs the service-role client", error);
      return NextResponse.json(
        {
          error:
            "Removing a request is not available on this deployment yet. Please contact support.",
        },
        { status: 503 }
      );
    }

    const { data: request, error: fetchError } = await serviceRole
      .from("service_requests")
      .select("id, customer_id, status, assignment_status")
      .eq("id", params.id)
      .maybeSingle();

    if (fetchError) throw fetchError;
    if (!request || request.customer_id !== user.id) {
      return NextResponse.json({ error: "Request not found" }, { status: 404 });
    }

    if (request.status === "completed") {
      return NextResponse.json(
        {
          code: "request_completed",
          error:
            "This repair is finished, so it stays in your service history. Contact support if something is wrong with it.",
        },
        { status: 409 }
      );
    }

    if (request.assignment_status === "accepted") {
      return NextResponse.json(
        {
          code: "request_in_progress",
          error:
            "A technician has already accepted this request, so it cannot be removed. Contact support to withdraw it.",
        },
        { status: 409 }
      );
    }

    // Both checks run BEFORE the delete: an appointment or a prepared estimate is
    // exactly what makes the cascade destructive.
    const [bookingResult, estimateResult] = await Promise.all([
      serviceRole
        .from("bookings")
        .select("id", { count: "exact", head: true })
        .eq("service_request_id", params.id),
      serviceRole
        .from("estimates")
        .select("id", { count: "exact", head: true })
        .eq("service_request_id", params.id),
    ]);
    if (bookingResult.error) throw bookingResult.error;
    if (estimateResult.error) throw estimateResult.error;

    if ((bookingResult.count ?? 0) > 0) {
      return NextResponse.json(
        {
          code: "request_has_booking",
          error:
            "This request has an appointment, so it cannot be removed. Cancel the appointment first, or contact support.",
        },
        { status: 409 }
      );
    }

    if ((estimateResult.count ?? 0) > 0) {
      return NextResponse.json(
        {
          code: "request_has_estimate",
          error:
            "An estimate has already been prepared for this request, so it cannot be removed. Contact support and we will sort it out.",
        },
        { status: 409 }
      );
    }

    const { error: deleteError } = await serviceRole
      .from("service_requests")
      .delete()
      .eq("id", params.id);

    if (deleteError) throw deleteError;

    return NextResponse.json({ data: { deleted: true } });
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
