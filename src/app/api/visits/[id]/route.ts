import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, AuthError } from "@/lib/auth";

// PATCH /api/visits/:id — technician updates status/notes/photos; customer can only add signed_by
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) throw new AuthError("Not authenticated", 401);

    const supabase = createClient();

    const { data: visit, error: fetchError } = await supabase
      .from("visits")
      .select("*, bookings!inner(customer_id)")
      .eq("id", params.id)
      .single();

    if (fetchError || !visit) {
      return NextResponse.json({ error: "Visit not found" }, { status: 404 });
    }

    const isOwningTechnician = visit.technician_id === user.id;
    const isOwningCustomer =
      user.role === "customer" &&
      (visit as unknown as { bookings: { customer_id: string } }).bookings.customer_id === user.id;
    const isStaff = user.role === "admin" || user.role === "super_admin";

    if (!isOwningTechnician && !isOwningCustomer && !isStaff) {
      throw new AuthError("Not authorized to update this visit", 403);
    }

    const body = await request.json();
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

    if (isOwningCustomer && !isOwningTechnician && !isStaff) {
      // customers may only sign off on a visit — nothing else
      if (body.signed_by) updates.signed_by = body.signed_by;
    } else {
      if (body.status) updates.status = body.status;
      if (body.notes !== undefined) updates.notes = body.notes;
      if (body.photo_urls !== undefined) updates.photo_urls = body.photo_urls;
      if (body.signed_by !== undefined) updates.signed_by = body.signed_by;
    }

    const { data, error } = await supabase
      .from("visits")
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

function handleError(err: unknown) {
  if (err instanceof AuthError) {
    return NextResponse.json({ error: err.message }, { status: err.status });
  }
  console.error(err);
  return NextResponse.json({ error: "Internal server error" }, { status: 500 });
}
