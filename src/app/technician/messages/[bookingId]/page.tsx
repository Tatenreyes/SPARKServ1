import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import MessageThread from "@/components/MessageThread";
import StatusBadge from "@/components/StatusBadge";

/**
 * One conversation, under Messages.
 *
 * The technician's Messages list used to open the JOB page — address, map pin,
 * directions and the thread — so reading a message meant leaving Messages for the
 * schedule. The conversation keeps its own page; the job stays one click away, which
 * is where the address and directions belong.
 */
export default async function TechnicianConversationPage({
  params,
}: {
  params: { bookingId: string };
}) {
  const user = await getCurrentUser();
  const supabase = createClient();

  const { data: booking } = await supabase
    .from("bookings")
    .select("id, customer_id, technician_id, service_request_id, status, scheduled_at")
    .eq("id", params.bookingId)
    .single();

  // RLS already limits this to the technician's own booking; the explicit check keeps
  // a customer who guessed a technician URL from being handed the page at all.
  if (!booking || booking.technician_id !== user!.id) notFound();

  const [{ data: customer }, { data: request }, { data: messages }] = await Promise.all([
    supabase.from("users").select("name").eq("id", booking.customer_id).single(),
    supabase
      .from("service_requests")
      .select("appliance_type")
      .eq("id", booking.service_request_id)
      .single(),
    supabase
      .from("messages")
      .select("*")
      .eq("booking_id", booking.id)
      .order("created_at", { ascending: true }),
  ]);

  return (
    <div className="space-y-4">
      <Link
        href="/technician/messages"
        className="inline-flex items-center gap-1 text-xs font-semibold text-brand-ink hover:underline"
      >
        <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" /> All messages
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-xl font-semibold text-ink">
            {customer?.name ?? "Customer"}
          </h1>
          <p className="mt-0.5 text-sm capitalize text-ink/50">
            {request?.appliance_type?.replace(/_/g, " ") ?? "Job"} ·{" "}
            {new Date(booking.scheduled_at).toLocaleString()}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <StatusBadge status={booking.status} />
          <Link
            href={`/technician/bookings/${booking.id}`}
            className="text-xs font-semibold text-brand-ink hover:underline"
          >
            View job
          </Link>
        </div>
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
