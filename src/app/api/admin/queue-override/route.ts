import { NextResponse, type NextRequest } from "next/server";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { requireRole, AuthError } from "@/lib/auth";

/**
 * POST /api/admin/queue-override — the documented administrative override.
 *
 * Use `admin_queue_override` when the rotation has to be corrected by hand
 * (a technician's account was suspended mid-shift, an appointment was cancelled
 * at the last minute, and so on). Three properties make this safe to expose:
 *
 *   1. it is administrator-only — the RPC re-checks `is_admin()` server-side, so
 *      a forged request from a technician or customer is refused;
 *   2. a written reason is MANDATORY (the RPC raises without one);
 *   3. every override is written to `technician_queue_events` with the acting
 *      administrator's id, the old and new positions and the reason.
 *
 * The user-scoped client is used on purpose: the RPC needs the administrator's
 * JWT to know who is acting, which is what makes the audit trail meaningful.
 */
export async function POST(request: NextRequest) {
  try {
    const admin = await requireRole(["admin", "super_admin"]);
    const body = await request.json();

    const applianceType = String(body.appliance_type ?? "").trim();
    const technicianId = String(body.technician_id ?? "").trim();
    const action = String(body.action ?? "").trim();
    const reason = String(body.reason ?? "").trim();

    if (!applianceType || !technicianId) {
      return NextResponse.json({ error: "appliance_type and technician_id are required" }, { status: 400 });
    }
    if (!["move_to_end", "remove", "reactivate"].includes(action)) {
      return NextResponse.json(
        { error: "action must be move_to_end, remove or reactivate" },
        { status: 400 }
      );
    }
    if (!reason) {
      return NextResponse.json(
        { error: "A reason is required — every override is audited." },
        { status: 400 }
      );
    }

    const supabase = createClient();
    const { data, error } = await supabase.rpc("admin_queue_override", {
      p_appliance_type: applianceType,
      p_technician_id: technicianId,
      p_action: action,
      p_reason: `${reason} (by ${admin.name})`,
    });
    if (error) throw error;

    const serviceRole = createServiceRoleClient();
    await serviceRole.rpc("refresh_technician_operational_status", { p_technician_id: technicianId });

    return NextResponse.json({ data });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: "Unable to apply the queue override" }, { status: 500 });
  }
}
