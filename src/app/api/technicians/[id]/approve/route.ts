import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { requireRole, AuthError } from "@/lib/auth";
import { rematchWaitingRequests } from "@/lib/assignment";

// PATCH /api/technicians/:id/approve — admin/super_admin approves a pending technician
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const admin = await requireRole(["admin", "super_admin"]);

    const body = await request.json().catch(() => ({}));
    const approve = body.approve ?? true;

    // service-role client: approving a technician crosses role boundaries,
    // which is exactly the kind of action normal RLS policies are meant to block
    // for everyone except an authenticated admin — enforced above via requireRole.
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase
      .from("technicians")
      .update({
        approved: approve,
        approved_at: approve ? new Date().toISOString() : null,
        approved_by: approve ? admin.id : null,
      })
      .eq("id", params.id)
      .select()
      .single();

    if (error) throw error;

    // A newly-approved technician might be the missing eligible technician
    // for requests previously stuck "waiting" with nobody qualified.
    if (approve) {
      await rematchWaitingRequests(supabase);
    }

    return NextResponse.json({ data });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
