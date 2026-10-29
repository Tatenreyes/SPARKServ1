import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronRight, MessageSquareText } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import StatusBadge from "@/components/StatusBadge";
import ServiceLocationCard from "@/components/ServiceLocationCard";

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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl font-semibold capitalize text-ink">
            {request?.appliance_type.replace("_", " ") ?? "Repair"} — {customerUser?.name ?? "Customer"}
          </h1>
          <p className="text-sm text-ink/50">{request?.problem_description}</p>
          <p className="mt-1 text-xs text-ink/40">
            Scheduled: {new Date(booking.scheduled_at).toLocaleString()}
          </p>
        </div>
        <StatusBadge status={booking.status} />
      </div>

      {/* The job page for the ASSIGNED technician: address, map pin and a
          directions link. RLS only returns this request because the caller owns
          a booking on it, so an unassigned technician never reaches this view. */}
      <ServiceLocationCard
        address={request?.location ?? null}
        latitude={request?.latitude ?? null}
        longitude={request?.longitude ?? null}
        title="Service location"
        showDirections
        emptyMessage="No service location was recorded on this request — message the customer to confirm the address."
      />

      {/* Messaging lives under Messages, not on the job page: the thread used to be
          embedded here, so reading a message meant scrolling past the address and the
          map. This is the way to it. */}
      <Link
        href={`/technician/messages/${booking.id}`}
        className="flex items-center justify-between gap-3 rounded-card border border-ink/8 bg-surface p-4 shadow-card transition hover:border-brand-300"
      >
        <span className="flex min-w-0 items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-ink">
            <MessageSquareText className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-medium text-ink">
              Message {customerUser?.name ?? "Customer"}
            </span>
            <span className="block text-sm text-ink/50">Open the conversation</span>
          </span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-ink/35" aria-hidden="true" />
      </Link>
    </div>
  );
}
