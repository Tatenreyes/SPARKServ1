import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getCurrentUser, AuthError } from "@/lib/auth";
import { rankTechnicians } from "@/lib/recommendation";

/**
 * POST /api/recommend
 * body: { service_request_id: string }
 *
 * Runs the scoring engine (see lib/recommendation.ts) across all approved
 * technicians and returns them ranked best-match-first for this request.
 *
 * Uses the service-role client because ranking needs to read across every
 * technician's row, which normal customer RLS policies intentionally don't
 * allow in bulk — the API route itself enforces the caller is a real,
 * authenticated customer/admin before doing that broader read.
 */
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) throw new AuthError("Not authenticated", 401);

    const body = await request.json();
    const { service_request_id } = body;
    if (!service_request_id) {
      return NextResponse.json(
        { error: "service_request_id is required" },
        { status: 400 }
      );
    }

    const supabase = createServiceRoleClient();

    const { data: serviceRequest, error: srError } = await supabase
      .from("service_requests")
      .select("*")
      .eq("id", service_request_id)
      .single();

    if (srError || !serviceRequest) {
      return NextResponse.json({ error: "Service request not found" }, { status: 404 });
    }

    // Only the requesting customer or staff may pull recommendations for it
    if (user.role === "customer" && serviceRequest.customer_id !== user.id) {
      throw new AuthError("Not authorized to view recommendations for this request", 403);
    }

    const { data: technicians, error: techError } = await supabase
      .from("technicians")
      .select("*")
      .eq("approved", true);

    if (techError) throw techError;

    const technicianIds = (technicians ?? []).map((t) => t.id);
    const { data: users, error: userError } = await supabase
      .from("users")
      .select("id, name, latitude, longitude")
      .in("id", technicianIds.length > 0 ? technicianIds : ["00000000-0000-0000-0000-000000000000"]);

    if (userError) throw userError;

    const ranked = rankTechnicians({
      technicians: technicians ?? [],
      users: users ?? [],
      applianceType: serviceRequest.appliance_type,
      requestLat: serviceRequest.latitude,
      requestLng: serviceRequest.longitude,
    });

    return NextResponse.json({ data: ranked });
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
