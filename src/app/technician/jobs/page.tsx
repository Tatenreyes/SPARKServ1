import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import TechnicianJobsClient from "@/components/TechnicianJobsClient";

export default async function TechnicianJobsPage() {
  const user = await getCurrentUser();
  const supabase = createClient();

  const { data: bookings } = await supabase
    .from("bookings")
    .select("*")
    .eq("technician_id", user!.id)
    .order("scheduled_at", { ascending: true });

  const requestIds = Array.from(new Set((bookings ?? []).map((b) => b.service_request_id)));
  const { data: requests } = requestIds.length
    ? await supabase.from("service_requests").select("*").in("id", requestIds)
    : { data: [] };

  const bookingIds = (bookings ?? []).map((b) => b.id);
  const { data: visits } = bookingIds.length
    ? await supabase
        .from("visits")
        .select("*")
        .in("booking_id", bookingIds)
        .order("visit_number", { ascending: true })
    : { data: [] };

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-ink">My jobs</h1>
      <p className="mt-1 text-sm text-ink/65">Track and update your assigned repair jobs.</p>
      <TechnicianJobsClient
        bookings={bookings ?? []}
        requests={requests ?? []}
        visits={visits ?? []}
      />
    </div>
  );
}
