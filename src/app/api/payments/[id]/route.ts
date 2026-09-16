import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getCurrentUser, AuthError } from "@/lib/auth";
import { notify } from "@/lib/notifications";

// PATCH /api/payments/:id — admin confirms or rejects a submitted payment reference.
// Uses the service-role client since there's no RLS update policy for payments
// (customers can only insert, never edit after submitting — that's intentional).
export async function PATCH(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) throw new AuthError("Not authenticated", 401);
    if (user.role !== "admin" && user.role !== "super_admin") {
      throw new AuthError("Only admins can verify payments", 403);
    }

    const { status } = await request.json();
    if (status !== "confirmed" && status !== "rejected") {
      return NextResponse.json(
        { error: "status must be 'confirmed' or 'rejected'" },
        { status: 400 }
      );
    }

    const supabase = createServiceRoleClient();

    const { data: existing, error: existingError } = await supabase
      .from("payments")
      .select("id, status")
      .eq("id", params.id)
      .single();
    if (existingError || !existing) {
      return NextResponse.json({ error: "Payment not found" }, { status: 404 });
    }
    if (existing.status !== "pending_verification") {
      return NextResponse.json({ error: "Payment has already been processed" }, { status: 409 });
    }

    const { data, error } = await supabase
      .from("payments")
      .update({ status, confirmed_by: user.id, confirmed_at: new Date().toISOString() })
      .eq("id", params.id)
      .eq("status", "pending_verification")
      .select()
      .single();

    if (error) throw error;

    if (status === "confirmed") {
      await notify(supabase, {
        userId: data.customer_id,
        type: "payment_confirmed",
        title: "Payment confirmed",
        body: `Your payment of ₱${data.amount.toFixed(2)} has been verified.`,
        link: `/customer/bookings/${data.booking_id}`,
      });
    }

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
