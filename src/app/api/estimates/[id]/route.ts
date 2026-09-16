import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getCurrentUser, AuthError } from "@/lib/auth";

// PATCH /api/estimates/:id — customer rejects an estimate for their own request
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) throw new AuthError("Not authenticated", 401);

    const { status } = await request.json();
    if (status !== "rejected") {
      return NextResponse.json(
        { error: "Customers can only set an estimate's status to 'rejected'." },
        { status: 400 }
      );
    }

    // Service-role client — bypasses RLS, so we enforce ownership manually below
    // instead of adding a new RLS policy just for this one action.
    const supabase = createServiceRoleClient();

    const { data: estimate, error: fetchError } = await supabase
      .from("estimates")
      .select("id, service_request_id, technician_id")
      .eq("id", params.id)
      .single();

    if (fetchError || !estimate) {
      return NextResponse.json({ error: "Estimate not found" }, { status: 404 });
    }

    const { data: serviceRequest } = await supabase
      .from("service_requests")
      .select("customer_id")
      .eq("id", estimate.service_request_id)
      .single();

    const isOwningCustomer =
      user.role === "customer" && serviceRequest?.customer_id === user.id;
    const isStaff = user.role === "admin" || user.role === "super_admin";

    if (!isOwningCustomer && !isStaff) {
      throw new AuthError("Not authorized to update this estimate", 403);
    }

    const { data, error } = await supabase
      .from("estimates")
      .update({ status: "rejected" })
      .eq("id", params.id)
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ data });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
