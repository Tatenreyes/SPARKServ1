import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { MessageSquare } from "lucide-react";
import type { MessageRow } from "@/types/database";

export default async function CustomerMessagesPage() {
  const user = await getCurrentUser();
  const supabase = createClient();

  const { data: bookings } = await supabase
    .from("bookings")
    .select("*")
    .eq("customer_id", user!.id)
    .order("scheduled_at", { ascending: false });

  const bookingIds = (bookings ?? []).map((b) => b.id);
  const { data: messages } = bookingIds.length
    ? await supabase
        .from("messages")
        .select("*")
        .in("booking_id", bookingIds)
        .order("created_at", { ascending: false })
    : { data: [] };

  const requestIds = Array.from(new Set((bookings ?? []).map((b) => b.service_request_id)));
  const { data: requests } = requestIds.length
    ? await supabase.from("service_requests").select("id, appliance_type").in("id", requestIds)
    : { data: [] };
  const requestMap = new Map((requests ?? []).map((r) => [r.id, r]));

  const technicianIds = Array.from(new Set((bookings ?? []).map((b) => b.technician_id)));
  const { data: technicianUsers } = technicianIds.length
    ? await supabase.from("users").select("id, name").in("id", technicianIds)
    : { data: [] };
  const technicianMap = new Map((technicianUsers ?? []).map((t) => [t.id, t.name]));

  const latestByBooking = new Map<string, MessageRow>();
  for (const m of messages ?? []) {
    if (!latestByBooking.has(m.booking_id)) latestByBooking.set(m.booking_id, m);
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-ink">Messages</h1>
      <p className="mt-1 text-sm text-ink/65">Conversations with your technicians, by job.</p>

      {!bookings?.length ? (
        <p className="mt-8 text-sm text-ink/50">No conversations yet — they start once you book a technician.</p>
      ) : (
        <div className="mt-6 space-y-2">
          {bookings.map((b) => {
            const latest = latestByBooking.get(b.id);
            const req = requestMap.get(b.service_request_id);
            return (
              <Link
                key={b.id}
                href={`/customer/bookings/${b.id}`}
                className="flex items-start gap-3 rounded-card border border-ink/8 bg-white p-4 shadow-card transition hover:border-brand-300"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600">
                  <MessageSquare className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate font-medium text-ink">
                      {technicianMap.get(b.technician_id) ?? "Technician"} ·{" "}
                      <span className="capitalize text-ink/50">
                        {req?.appliance_type.replace("_", " ") ?? "Job"}
                      </span>
                    </p>
                    {latest && (
                      <p className="shrink-0 text-xs text-ink/35">
                        {new Date(latest.created_at).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-sm text-ink/50">
                    {latest ? latest.content : "No messages yet"}
                  </p>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
