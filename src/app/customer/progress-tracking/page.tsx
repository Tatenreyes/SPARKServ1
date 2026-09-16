import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import ProgressTrackingClient from "@/components/ProgressTrackingClient";

export default async function ProgressTrackingPage() {
  const user = await getCurrentUser();
  const supabase = createClient();

  const { data: bookings } = await supabase
    .from("bookings")
    .select("*")
    .eq("customer_id", user!.id)
    .in("status", ["pending", "in_progress"])
    .order("scheduled_at", { ascending: true });

  const bookingIds = (bookings ?? []).map((b) => b.id);

  const { data: visits } = bookingIds.length
    ? await supabase
        .from("visits")
        .select("*")
        .in("booking_id", bookingIds)
        .order("visit_number", { ascending: true })
    : { data: [] };

  const requestIds = Array.from(new Set((bookings ?? []).map((b) => b.service_request_id)));
  const { data: requests } = requestIds.length
    ? await supabase.from("service_requests").select("*").in("id", requestIds)
    : { data: [] };

  const technicianIds = Array.from(new Set((bookings ?? []).map((b) => b.technician_id)));
  const { data: technicianUsers } = technicianIds.length
    ? await supabase.from("users").select("id, name").in("id", technicianIds)
    : { data: [] };

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-ink">Progress tracking</h1>
      <p className="mt-1 text-sm text-ink/65">Track your repair visits and progress.</p>

      <ProgressTrackingClient
        bookings={bookings ?? []}
        visits={visits ?? []}
        requests={requests ?? []}
        technicianNames={Object.fromEntries((technicianUsers ?? []).map((t) => [t.id, t.name]))}
        currentUserName={user!.name}
      />
    </div>
  );
}
