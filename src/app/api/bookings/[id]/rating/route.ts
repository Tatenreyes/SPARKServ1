import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser, AuthError } from "@/lib/auth";

const MAX_COMMENT_LENGTH = 1000;

/**
 * POST /api/bookings/:id/rating — the customer rates the technician after a
 * completed repair.
 *
 * `public.ratings.booking_id` is UNIQUE, so a booking can only ever have one
 * rating. Ownership, the completed status and the duplicate check are all
 * enforced here on the server; the RLS insert policy only checks that the row's
 * `customer_id` matches the caller.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getCurrentUser();
    if (!user) throw new AuthError("Not authenticated", 401);
    if (user.role !== "customer") {
      throw new AuthError("Only the customer on this booking can rate it", 403);
    }

    const body = await request.json().catch(() => ({}));
    const rating = Number(body.rating);
    const comment = typeof body.comment === "string" ? body.comment.trim() : "";

    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return NextResponse.json(
        { error: "Choose a rating from 1 to 5 stars." },
        { status: 400 }
      );
    }
    if (comment.length > MAX_COMMENT_LENGTH) {
      return NextResponse.json(
        { error: `Keep your comment under ${MAX_COMMENT_LENGTH} characters.` },
        { status: 400 }
      );
    }

    const supabase = createClient();

    const { data: booking, error: bookingError } = await supabase
      .from("bookings")
      .select("id, customer_id, technician_id, status")
      .eq("id", params.id)
      .single();

    if (bookingError || !booking) {
      return NextResponse.json({ error: "Booking not found" }, { status: 404 });
    }

    if (booking.customer_id !== user.id) {
      throw new AuthError("You can only rate your own repair", 403);
    }

    if (booking.status !== "completed") {
      return NextResponse.json(
        { error: "You can rate the technician once the repair is completed." },
        { status: 409 }
      );
    }

    const { data: existing } = await supabase
      .from("ratings")
      .select("id")
      .eq("booking_id", params.id)
      .maybeSingle();

    if (existing) {
      return NextResponse.json(
        { error: "You have already rated this repair.", code: "already_rated" },
        { status: 409 }
      );
    }

    const { data, error } = await supabase
      .from("ratings")
      .insert({
        booking_id: booking.id,
        customer_id: user.id,
        technician_id: booking.technician_id,
        rating,
        comment: comment || null,
      })
      .select()
      .single();

    if (error) {
      // Unique violation — a concurrent submit already created the row.
      if ((error as { code?: string }).code === "23505") {
        return NextResponse.json(
          { error: "You have already rated this repair.", code: "already_rated" },
          { status: 409 }
        );
      }
      throw error;
    }

    return NextResponse.json({ data }, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error(err);
    return NextResponse.json({ error: "Unable to save your rating" }, { status: 500 });
  }
}
