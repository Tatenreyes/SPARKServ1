import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import StatusBadge from "@/components/StatusBadge";
import MessageThread from "@/components/MessageThread";

export default async function TechnicianBookingDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const user = await getCurrentUser();
  const supabase = createClient();

  const { data: booking } = await supabase
    .from("bookings")
    .select("*")
    .eq("id", params.id)
    .eq("technician_id", user!.id)
    .single();

  if (!booking) notFound();

  const { data: request } = await supabase
    .from("service_requests")
    .select("*")
    .eq("id", booking.service_request_id)
    .single();

  const { data: customerUser } = await supabase
    .from("users")
    .select("id, name")
    .eq("id", booking.customer_id)
    .single();

  const { data: messages } = await supabase
    .from("messages")
    .select("*")
    .eq("booking_id", params.id)
    .order("created_at", { ascending: true });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold capitalize text-ink">
            {request?.appliance_type.replace("_", " ") ?? "Repair"} — {customerUser?.name ?? "Customer"}
          </h1>
          <p className="text-sm text-ink/50">{request?.issue_description}</p>
          <p className="mt-1 text-xs text-ink/40">
            Scheduled: {new Date(booking.scheduled_at).toLocaleString()}
          </p>
        </div>
        <StatusBadge status={booking.status} />
      </div>

      <MessageThread
        bookingId={booking.id}
        currentUserId={user!.id}
        otherUserId={booking.customer_id}
        initialMessages={messages ?? []}
      />
    </div>
  );
}
