import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { getCurrentUser, AuthError } from "@/lib/auth";
import { applianceLabel } from "@/lib/queue";

/**
 * The structured result of `create_booking_atomic()`.
 *
 * The database owns the whole booking decision, so this route only translates the
 * outcome into the right status code. Nothing here re-checks the estimate, the
 * schedule, the capacity or the technician's eligibility: that would be a second,
 * weaker copy of rules already enforced inside one transaction.
 */
interface BookingOutcome {
  outcome?: string;
  reason?: string;
  message?: string;
  booking_id?: string;
  booking?: Record<string, unknown>;
  request_id?: string;
  request_status?: string;
  assignment_status?: string;
  estimate_status?: string;
  technician_id?: string;
  appliance_type?: string;
  /**
   * Only on `technician_not_eligible`: does ANY technician currently qualify for
   * this appliance type? It decides which of the two honest explanations the
   * customer gets — "nobody covers this appliance" or "the technician assigned to
   * you is no longer qualified".
   */
  qualified_technician_available?: boolean;
}

// POST /api/bookings â€” the customer confirms an appointment for the estimate they
// approved.
//
// Batch 2: this is now ONE database transaction (`public.create_booking_atomic`,
// see supabase/migration_atomic_booking.sql). It used to be three separate writes â€”
// insert the booking, update the request, bump the technician's counter â€” which
// could half-fail, and it read the schedule before writing with no lock, so two
// requests could both reserve the same technician for the same hours. Both problems
// are now closed in the database:
//
//   * `uniq_active_booking_per_request` â€” one non-cancelled booking per request;
//   * `trg_booking_no_overlap` â€” no overlapping appointment for a technician,
//     serialized on a per-technician advisory lock.
//
// A direct insert from the browser is no longer a path at all: the INSERT policies
// on `bookings` were removed, and the function is service-role only. The customer's
// identity comes from the session here and is re-verified inside the function.
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

    const scheduledStart = new Date(scheduled_at);
    if (Number.isNaN(scheduledStart.getTime())) {
      return NextResponse.json({ error: "scheduled_at must be a valid date" }, { status: 400 });
    }

    // How long the appointment occupies the technician. Passed through when the
    // caller supplied one; otherwise the database falls back to the duration the
    // customer asked for with the request, then to the platform default â€” one place
    // decides, so the two can never disagree.
    const bookingMinutes =
      typeof duration_minutes === "number" &&
      Number.isFinite(duration_minutes) &&
      duration_minutes > 0
        ? Math.round(duration_minutes)
        : null;

    const serviceRole = createServiceRoleClient();
    const { data, error } = await serviceRole.rpc("create_booking_atomic", {
      p_request_id: service_request_id,
      p_estimate_id: estimate_id,
      p_actor: user.id,
      p_scheduled_at: scheduledStart.toISOString(),
      p_duration_minutes: bookingMinutes,
      p_notes: typeof notes === "string" && notes.trim() ? notes.trim() : null,
    });

    if (error) {
      const code = (error as { code?: string }).code;
      const message = (error as { message?: string }).message ?? "";
      // Deployment ahead of database: the function arrives with
      // migration_atomic_booking.sql. Say which file is missing rather than a bare
      // 500 â€” and never fall back to writing the booking by hand.
      if (code === "PGRST202" || /create_booking_atomic/.test(message)) {
        return NextResponse.json(
          {
            error:
              "Booking is not installed on this database yet. Apply supabase/migration_atomic_booking.sql, then try again.",
            code: "BOOKING_SETUP_REQUIRED",
          },
          { status: 503 }
        );
      }
      throw error;
    }

    return mapBookingOutcome((data ?? {}) as BookingOutcome);
  } catch (err) {
    return handleError(err);
  }
}

/**
 * Translate the function's outcome into the API's status codes.
 *
 * 201 booked Â· 409 for the scheduling and state conflicts the caller can act on Â·
 * 403/404 for identity and existence Â· 400 for an invalid length. A conflict is
 * never reported as a 500, and an unrecognised outcome is never reported as success.
 */
function mapBookingOutcome(outcome: BookingOutcome) {
  switch (outcome.outcome) {
    case "booked":
      return NextResponse.json({ data: outcome.booking, outcome }, { status: 201 });

    case "already_booked":
      return NextResponse.json(
        {
          error: "This repair request already has an active booking.",
          code: "already_booked",
          booking_id: outcome.booking_id ?? null,
        },
        { status: 409 }
      );

    case "request_not_found":
      return NextResponse.json({ error: "Service request not found" }, { status: 404 });

    case "forbidden":
      return NextResponse.json(
        { error: "You can only book your own repair request" },
        { status: 403 }
      );

    case "request_not_bookable":
      return NextResponse.json(
        {
          error:
            outcome.reason === "not_assigned"
              ? "A technician has not accepted this request yet, so it cannot be booked."
              : "This service request is not ready to be booked.",
          outcome,
        },
        { status: 409 }
      );

    case "estimate_invalid":
      return NextResponse.json(
        {
          error:
            "This estimate is not the currently approved version. Approve the estimate before booking.",
          outcome,
        },
        { status: 409 }
      );

    case "technician_not_eligible": {
      // Step 17. The assignment is stale: the request says a technician accepted it,
      // but under the platform's own rules that technician may no longer take this
      // appliance type (they dropped the specialization, the account was suspended or
      // deactivated, or an administrator took them out of the rotation). Nothing was
      // written — the request keeps its state — so the customer is told the truth and
      // pointed at a human, rather than being shown a booking that does not exist.
      const appliance = outcome.appliance_type
        ? applianceLabel(outcome.appliance_type)
        : "this appliance";
      const nobodyCoversIt =
        outcome.reason === "not_in_queue" && outcome.qualified_technician_available === false;

      const error = nobodyCoversIt
        ? `No technician currently supports ${appliance} repairs, so this appointment cannot be confirmed. Your request stays open and in line — we will match you with a qualified technician as soon as one is available.`
        : outcome.reason === "not_in_queue"
          ? `The technician assigned to this request is no longer qualified to service ${appliance}, so this appointment cannot be confirmed. Please contact support so a different technician can be assigned.`
          : `The technician assigned to this request is no longer available to take the job, so this appointment cannot be confirmed. Please contact support so a different technician can be assigned.`;

      return NextResponse.json({ error, code: "technician_not_eligible", outcome }, { status: 409 });
    }

    case "invalid_input":
      // Unreachable through this route — it validates the four parameters before
      // calling — but named deliberately, so the contract between the function and
      // this mapping stays TOTAL: an outcome the function can return is never
      // answered by the catch-all below, which exists only for outcomes that did
      // not exist when this route was written.
      return NextResponse.json(
        { error: "The booking request is missing something it needs.", outcome },
        { status: 400 }
      );

    case "invalid_schedule":
      return NextResponse.json(
        { error: "That appointment length is not valid.", outcome },
        { status: 400 }
      );

    case "schedule_conflict":
      return NextResponse.json(
        {
          error:
            outcome.message ??
            "That time clashes with another appointment this technician already has. Please choose a different slot.",
          outcome,
        },
        { status: 409 }
      );

    case "outside_availability_window":
      return NextResponse.json(
        {
          error:
            outcome.message ??
            "That time is outside the technician's working hours. Please choose another slot.",
          outcome,
        },
        { status: 409 }
      );

    case "capacity_concurrent_job":
    case "capacity_daily_jobs":
    case "capacity_daily_hours":
      return NextResponse.json(
        { error: outcome.message ?? "This technician has no capacity left for that time.", outcome },
        { status: 409 }
      );

    default:
      // An outcome this route does not know means the function changed underneath
      // it. Say so in the log instead of pretending the booking worked.
      console.error("create_booking_atomic returned an unrecognised outcome", outcome);
      return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// GET /api/bookings â€” list bookings scoped to the caller's role
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
