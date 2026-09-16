import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, AuthError } from "@/lib/auth";

// POST /api/visits — technician (or admin) schedules a visit for one of their bookings
export async function POST(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) throw new AuthError("Not authenticated", 401);
    if (user.role !== "technician" && user.role !== "admin" && user.role !== "super_admin") {
      throw new AuthError("Only technicians can schedule visits", 403);
    }

    const body = await request.json();
    const { booking_id, title, description, scheduled_at } = body;
    if (!booking_id || !title) {
      return NextResponse.json({ error: "booking_id and title are required" }, { status: 400 });
    }

    const supabase = createClient();

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("id, technician_id")
      .eq("id", booking_id)
      .single();

    if (bookingError || !booking) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }
    if (user.role === "technician" && booking.technician_id !== user.id) {
      throw new AuthError("Not your booking", 403);
    }

    const { count: existingCount } = await supabase
      .from("visits")
      .select("*", { count: "exact", head: true })
      .eq("booking_id", booking_id);

    const { data, error } = await supabase
      .from("visits")
      .insert({
        booking_id,
        visit_number: (existingCount ?? 0) + 1,
        title,
        description: description ?? null,
        scheduled_at: scheduled_at ?? null,
        technician_id: booking.technician_id,
        status: "upcoming",
      })
      .select()
      .single();

    if (error) throw error;

    return NextResponse.json({ data }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}

// GET /api/visits?booking_id=... — list visits for a booking
export async function GET(request: NextRequest) {
  try {
    const user = await getCurrentUser();
    if (!user) throw new AuthError("Not authenticated", 401);

    const bookingId = request.nextUrl.searchParams.get("booking_id");
    if (!bookingId) {
      return NextResponse.json({ error: "booking_id query param is required" }, { status: 400 });
    }

    const supabase = createClient();
    const { data, error } = await supabase
      .from("visits")
      .select("*")
      .eq("booking_id", bookingId)
      .order("visit_number", { ascending: true });

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
