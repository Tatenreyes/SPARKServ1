import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, AuthError } from "@/lib/auth";

// POST /api/messages — send a chat message scoped to a booking
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) throw new AuthError("Not authenticated", 401);

    const body = await request.json();
    const { booking_id, receiver_id, content } = body;

    if (!booking_id || !receiver_id || !content?.trim()) {
      return NextResponse.json(
        { error: "booking_id, receiver_id, and content are required" },
        { status: 400 }
      );
    }

    const supabase = createClient();
    const { data: booking } = await supabase
      .from("bookings")
      .select("customer_id, technician_id")
      .eq("id", booking_id)
      .single();
    if (!booking || ![booking.customer_id, booking.technician_id].includes(user.id)) {
      throw new AuthError("Not authorized for this booking", 403);
    }
    const otherParticipant = user.id === booking.customer_id ? booking.technician_id : booking.customer_id;
    if (receiver_id !== otherParticipant) {
      return NextResponse.json({ error: "Messages must be sent to the other booking participant" }, { status: 400 });
    }
    const { data, error } = await supabase
      .from("messages")
      .insert({
        booking_id,
        sender_id: user.id,
        receiver_id,
        content: content.trim(),
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ data }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}

// GET /api/messages?booking_id=... — fetch full thread for a booking
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) throw new AuthError("Not authenticated", 401);

    const bookingId = request.nextUrl.searchParams.get("booking_id");
    if (!bookingId) {
      return NextResponse.json({ error: "booking_id query param is required" }, { status: 400 });
    }

    const supabase = createClient();
    const { data: booking } = await supabase
      .from("bookings")
      .select("customer_id, technician_id")
      .eq("id", bookingId)
      .single();
    if (!booking || ![booking.customer_id, booking.technician_id].includes(user.id)) {
      throw new AuthError("Not authorized for this booking", 403);
    }
    const { data, error } = await supabase
      .from("messages")
      .select("*")
      .eq("booking_id", bookingId)
      .order("created_at", { ascending: true });

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
