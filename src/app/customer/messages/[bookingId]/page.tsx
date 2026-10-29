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
 * Messages and bookings are separate destinations in the sidebar, and they were not:
 * the thread only existed at the bottom of the BOOKING page, so every row in the
 * Messages list dropped the customer into a page about paying, inspecting and rating
 * their repair. The conversation is still the same `messages` row — it is scoped to a
 * booking by design (`messages.booking_id` is NOT NULL) — it simply has a page of its
 * own, with the booking left one click away for anyone who wants the job around it.
 */
export default async function CustomerConversationPage({
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

  // RLS already limits this to the customer's own booking; the explicit check keeps a
  // technician who guessed a customer URL from being handed the page at all.
  if (!booking || booking.customer_id !== user!.id) notFound();

  const [{ data: technician }, { data: request }, { data: messages }] = await Promise.all([
    supabase.from("users").select("name").eq("id", booking.technician_id).single(),
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
        href="/customer/messages"
        className="inline-flex items-center gap-1 text-xs font-semibold text-brand-ink hover:underline"
      >
        <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" /> All messages
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-display text-xl font-semibold text-ink">
            {technician?.name ?? "Your technician"}
          </h1>
          <p className="mt-0.5 text-sm capitalize text-ink/50">
            {request?.appliance_type?.replace(/_/g, " ") ?? "Your job"} ·{" "}
            {new Date(booking.scheduled_at).toLocaleString()}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <StatusBadge status={booking.status} />
          <Link
            href={`/customer/bookings/${booking.id}`}
            className="text-xs font-semibold text-brand-ink hover:underline"
          >
            View booking
          </Link>
        </div>
      </div>

      <MessageThread
        bookingId={booking.id}
        currentUserId={user!.id}
        otherUserId={booking.technician_id}
        initialMessages={messages ?? []}
      />
    </div>
  );
}
