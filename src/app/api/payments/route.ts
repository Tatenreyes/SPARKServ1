import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, AuthError } from "@/lib/auth";

// POST /api/payments — customer submits a GCash payment reference for their own booking.
// Per re-defense feedback: only the customer can do this. Technicians never submit
// payment proof — enforced here and by RLS.
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) throw new AuthError("Not authenticated", 401);
    if (user.role !== "customer") {
      throw new AuthError("Only the customer can submit a payment reference", 403);
    }

    const body = await request.json();
    const { booking_id, gcash_reference, amount } = body;
    if (!booking_id || !gcash_reference || amount == null) {
      return NextResponse.json(
        { error: "booking_id, gcash_reference, and amount are required" },
        { status: 400 }
      );
    }

    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0 || !String(gcash_reference).trim()) {
      return NextResponse.json({ error: "amount must be positive and reference is required" }, { status: 400 });
    }

    const supabase = createClient();

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("id, customer_id, status, final_cost")
      .eq("id", booking_id)
      .single();

    if (bookingError || !booking || booking.customer_id !== user.id) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }
    if (booking.status !== "completed" || booking.final_cost == null) {
      return NextResponse.json({ error: "Payment is only available after inspection" }, { status: 409 });
    }
    if (Number(amount) !== Number(booking.final_cost)) {
      return NextResponse.json({ error: "Payment amount must match the final cost" }, { status: 400 });
    }

    const { data: existingPayment } = await supabase
      .from("payments")
      .select("id")
      .or(`booking_id.eq.${booking_id},gcash_reference.eq.${String(gcash_reference).trim()}`)
      .in("status", ["pending_verification", "confirmed"])
      .maybeSingle();
    if (existingPayment) {
      return NextResponse.json({ error: "A payment is already pending or confirmed" }, { status: 409 });
    }

    const { data, error } = await supabase
      .from("payments")
      .insert({
        booking_id,
        customer_id: user.id,
        gcash_reference: String(gcash_reference).trim(),
        amount,
        status: "pending_verification",
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ data }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}

// GET /api/payments?booking_id=... — customer sees their own, admin sees any
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) throw new AuthError("Not authenticated", 401);

    const supabase = createClient();
    let query = supabase.from("payments").select("*").order("created_at", { ascending: false });

    const bookingId = request.nextUrl.searchParams.get("booking_id");
    if (bookingId) query = query.eq("booking_id", bookingId);

    if (user.role === "customer") {
      query = query.eq("customer_id", user.id);
    } else if (user.role === "technician") {
      // technicians don't see payment records at all
      return NextResponse.json({ data: [] });
    }

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
