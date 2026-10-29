import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { getCurrentUser, AuthError } from "@/lib/auth";
import { assignTechnician } from "@/lib/assignment";
import { readRequestedWindow } from "@/lib/service-time";
import { getIssueById } from "@/lib/appliance-issues";
import {
  isValidLatitude,
  isValidLongitude,
  sanitizeAddress,
  toServiceCoordinates,
} from "@/lib/geo";

// POST /api/service-requests — customer submits a new appliance issue.
// Immediately triggers the fair ROTATION-based assignment engine (see
// lib/assignment.ts) — the customer never browses or picks a technician.
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) throw new AuthError("Not authenticated", 401);
    if (user.role !== "customer") {
      throw new AuthError("Only customers can submit service requests", 403);
    }

    const body = await request.json();
    const {
      appliance_id,
      appliance_type,
      issue_id,
      troubleshooting_outcome,
      problem_description,
      photos,
      chatbot_resolved,
      location,
      service_type,
      latitude,
      longitude,
    } = body;

    if (!appliance_type || !problem_description) {
      return NextResponse.json(
        { error: "appliance_type and problem_description are required" },
        { status: 400 }
      );
    }

    // ---- Identified issue ---------------------------------------------------
    // `issue_id` is validated against the SELECTED appliance's catalogue, so a
    // client cannot persist an issue that belongs to another appliance (or one
    // that does not exist at all). The label is derived here rather than trusted
    // from the request body, which keeps `issue_category` consistent with the id.
    const identifiedIssue = getIssueById(appliance_type, typeof issue_id === "string" ? issue_id : null);
    if (issue_id && !identifiedIssue) {
      return NextResponse.json(
        { error: "issue_id is not a supported issue for this appliance" },
        { status: 400 }
      );
    }

    // ---- Troubleshooting outcome -------------------------------------------
    // Optional, but restricted to the documented vocabulary. A reported outcome
    // must belong to an identified issue: "it worked" or "the problem remains"
    // cannot describe checks that were never shown.
    const outcome =
      typeof troubleshooting_outcome === "string" ? troubleshooting_outcome : null;
    if (outcome && !["resolved", "unresolved", "skipped"].includes(outcome)) {
      return NextResponse.json(
        { error: "troubleshooting_outcome must be resolved, unresolved or skipped" },
        { status: 400 }
      );
    }
    if ((outcome === "resolved" || outcome === "unresolved") && !identifiedIssue) {
      return NextResponse.json(
        { error: "A troubleshooting outcome requires an identified issue" },
        { status: 400 }
      );
    }

    // ---- Service location -------------------------------------------------
    // The address is cleaned before it is stored: control characters (which
    // would corrupt a URL or a log line) are stripped and the length is capped.
    const serviceAddress = sanitizeAddress(location);

    // Coordinates are optional, but they are a PAIR: a latitude with no
    // longitude cannot place a marker, and the database rejects the combination
    // outright (service_requests_coordinates_paired_check). A range check runs
    // here as well as in the database and in the wizard, so an out-of-range
    // value is refused with a clear 400 instead of a constraint violation.
    const hasLatitude = latitude !== null && latitude !== undefined && latitude !== "";
    const hasLongitude = longitude !== null && longitude !== undefined && longitude !== "";

    if (hasLatitude !== hasLongitude) {
      return NextResponse.json(
        { error: "latitude and longitude must be provided together" },
        { status: 400 }
      );
    }

    let coordinates: ReturnType<typeof toServiceCoordinates> = null;
    if (hasLatitude && hasLongitude) {
      const lat = typeof latitude === "number" ? latitude : Number(latitude);
      const lng = typeof longitude === "number" ? longitude : Number(longitude);
      if (!isValidLatitude(lat) || !isValidLongitude(lng)) {
        return NextResponse.json(
          {
            error:
              "latitude must be a number between -90 and 90 and longitude between -180 and 180",
          },
          { status: 400 }
        );
      }
      coordinates = toServiceCoordinates(lat, lng);
    }

    const supabase = createClient();

    // The requested time window drives availability + capacity checks. It is
    // optional: with no window the engine can only apply eligibility and the
    // concurrent-workload limit, and the exact slot is agreed at booking time.
    const window = await readRequestedWindow(supabase, body);

    const { data: created, error } = await supabase
      .from("service_requests")
      .insert({
        customer_id: user.id,
        appliance_id: appliance_id ?? null,
        appliance_type,
        // The canonical label comes from the catalogue (never from the body), so
        // `issue_category` and `issue_id` can never disagree.
        issue_category: identifiedIssue?.label ?? null,
        issue_id: identifiedIssue?.id ?? null,
        troubleshooting_outcome: outcome,
        problem_description,
        photos: Array.isArray(photos) ? photos : [],
        // Derived from the reported outcome so the legacy boolean cannot
        // contradict it; callers that still send it keep the old behaviour when
        // no outcome is present.
        chatbot_resolved: outcome ? outcome === "resolved" : Boolean(chatbot_resolved),
        location: serviceAddress,
        // Confirmed map pin (or null). Validated above; the database range- and
        // pairing-checks it again.
        latitude: coordinates?.latitude ?? null,
        longitude: coordinates?.longitude ?? null,
        // The wizard collects on_site / home_service / pickup; this used to be
        // dropped on the floor, so every request was stored as the column
        // default ("repair") and the customer's actual choice was lost.
        service_type: service_type ?? "repair",
        status: "open",
        requested_window_start: window.start,
        requested_window_end: window.end,
        requested_duration_minutes: window.durationMinutes,
      })
      .select()
      .single();

    if (error) throw error;

    let serviceRoleClient: ReturnType<typeof createServiceRoleClient> | null = null;
    let assigned = created;
    let assignmentPending = false;

    try {
      serviceRoleClient = createServiceRoleClient();
      assigned = await assignTechnician(serviceRoleClient, created);
    } catch (assignmentError) {
      // The request row is already saved. Returning a 500 here makes the client
      // think nothing was created and a retry can create a duplicate. Leave the
      // request visible and let the scheduled assignment tick retry it.
      assignmentPending = true;
      console.error("Repair request saved; technician assignment will retry", assignmentError);

      if (serviceRoleClient) {
        const { data: refreshed } = await serviceRoleClient
          .from("service_requests")
          .select("*")
          .eq("id", created.id)
          .maybeSingle();
        if (refreshed) assigned = refreshed;
      }
    }

    // ---- Can ANYBODY take this appliance at all? -------------------------------
    // `appliance_has_qualified_technician()` is the database's own answer to "does an
    // approved, unsuspended technician hold an ACTIVE queue membership for this
    // appliance type?" — the same predicate the queue walk and `create_booking_atomic()`
    // use, so it cannot disagree with who is actually offered the work.
    //
    // It matters because `waiting` means two different things. "Every qualified
    // technician is busy" is worth waiting for; "nobody services this appliance" is
    // not, and a customer left waiting for a technician who does not exist is how a
    // request sits in the queue for ever. A failure here is never fatal — the request
    // is already saved, and `null` means the client keeps its neutral wording.
    let qualifiedTechnicianAvailable: boolean | null = null;
    if (serviceRoleClient) {
      const { data: coverage, error: coverageError } = await serviceRoleClient.rpc(
        "appliance_has_qualified_technician",
        { p_appliance_type: appliance_type }
      );
      if (coverageError) {
        console.error("Could not check appliance coverage", coverageError);
      } else {
        qualifiedTechnicianAvailable = coverage === true;
      }
    }

    let assignedTechnician = null;
    if (serviceRoleClient && assigned.assigned_technician_id) {
      const { data: tech } = await serviceRoleClient
        .from("users")
        .select("id, name")
        .eq("id", assigned.assigned_technician_id)
        .single();
      assignedTechnician = tech ?? null;
    }

    return NextResponse.json(
      {
        data: assigned,
        assigned_technician: assignedTechnician,
        assignment_pending: assignmentPending && !assigned.assigned_technician_id,
        // `null` when the check could not run, so the client keeps its neutral copy
        // rather than claiming coverage it has not confirmed.
        qualified_technician_available: qualifiedTechnicianAvailable,
      },
      { status: 201 }
    );
  } catch (err) {
    return handleError(err);
  }
}


// GET /api/service-requests — list requests scoped to the caller's role
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) throw new AuthError("Not authenticated", 401);

    const supabase = createClient();
    let query = supabase
      .from("service_requests")
      .select("*")
      .order("created_at", { ascending: false });

    if (user.role === "customer") {
      query = query.eq("customer_id", user.id);
    } else if (user.role === "technician") {
      // Technicians no longer browse open requests — they only see what
      // the queue has specifically offered/assigned to them.
      query = query.eq("assigned_technician_id", user.id);
    }
    // admin / super_admin see everything — RLS + no extra filter

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

  // Missing schema objects mean this deployment is ahead of its database.
  // Tell the customer service is unavailable without exposing table/column names.
  const databaseCode = (err as { code?: string })?.code;
  if (["42703", "42P01", "PGRST204", "PGRST205"].includes(databaseCode ?? "")) {
    // Development gets the database's own wording — "Could not find the 'issue_id'
    // column of 'service_requests' in the schema cache" — plus the command that
    // lists what is missing. The person who can fix this is the one running the
    // app, and "the system is being updated" is unactionable from the browser,
    // which is why the real message used to be trapped in the server log alone.
    // Production keeps the opaque sentence.
    const detail = databaseDetail(err);
    return NextResponse.json(
      {
        error:
          "Repair requests are temporarily unavailable while the system is being updated. Please try again later or contact support.",
        code: "SERVICE_SETUP_REQUIRED",
        ...(detail
          ? { detail: { ...detail, next_step: "npm run db:check lists the migrations this project is missing" } }
          : {}),
      },
      { status: 503 }
    );
  }

  return NextResponse.json(
    { error: "Internal server error", detail: databaseDetail(err) },
    { status: 500 }
  );
}

/**
 * The database's own wording, in development only. An opaque "Internal server
 * error" is why a schema drift like a missing column stays invisible: the browser
 * only ever sees the 500, and the real PostgREST message (e.g. 42703 / "column
 * ... does not exist") is trapped in the server log. Echo it in development and
 * keep the generic response in production so internals are never leaked.
 *
 * PostgREST errors are plain objects, not `Error` instances, so `err.message` is
 * read directly — `String(err)` would report the useless "[object Object]" for
 * exactly the errors this is meant to explain.
 */
function databaseDetail(err: unknown) {
  if (process.env.NODE_ENV === "production") return null;
  return {
    code: (err as { code?: string })?.code ?? null,
    message:
      err instanceof Error
        ? err.message
        : ((err as { message?: string })?.message ?? String(err)),
    details: (err as { details?: string })?.details ?? null,
    hint: (err as { hint?: string })?.hint ?? null,
  };
}
