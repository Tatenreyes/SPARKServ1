import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import StatusBadge from "@/components/StatusBadge";
import MessageThread from "@/components/MessageThread";
import PaymentForm from "@/components/PaymentForm";
import CustomerInspectionControl from "@/components/CustomerInspectionControl";

export default async function CustomerBookingDetailPage({
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
    .single();

  if (!booking) notFound();

  const { data: technicianUser } = await supabase
    .from("users")
    .select("name")
    .eq("id", booking.technician_id)
    .single();

  const { data: serviceRequest } = await supabase
    .from("service_requests")
    .select("appliance_type")
    .eq("id", booking.service_request_id)
    .single();

  const { data: messages } = await supabase
    .from("messages")
    .select("*")
    .eq("booking_id", params.id)
    .order("created_at", { ascending: true });

  const { data: payment } = await supabase
    .from("payments")
    .select("*")
    .eq("booking_id", params.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-ink">
            Booking with {technicianUser?.name ?? "your technician"}
          </h1>
          <p className="text-sm text-ink/50">
            Scheduled: {new Date(booking.scheduled_at).toLocaleString()}
          </p>
        </div>
        <StatusBadge status={booking.status} />
      </div>

      {booking.status === "awaiting_inspection" && (
        <CustomerInspectionControl
          bookingId={booking.id}
          applianceType={serviceRequest?.appliance_type ?? "appliance"}
        />
      )}

      {booking.status === "completed" && (
        <PaymentForm bookingId={booking.id} existingPayment={payment ?? null} />
      )}

      <MessageThread
        bookingId={booking.id}
        currentUserId={user!.id}
        otherUserId={booking.technician_id}
        initialMessages={messages ?? []}
      />
    </div>
  );
}
