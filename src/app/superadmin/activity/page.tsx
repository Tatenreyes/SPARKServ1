import { createServiceRoleClient } from "@/lib/supabase/server";

interface ActivityItem {
  id: string;
  type: string;
  description: string;
  timestamp: string;
}

export default async function SuperAdminActivityPage() {
  const supabase = createServiceRoleClient();

  const [{ data: requests }, { data: bookings }, { data: payments }, { data: users }, { data: tickets }] =
    await Promise.all([
      supabase
        .from("service_requests")
        .select("id, appliance_type, location, created_at")
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("bookings")
        .select("id, status, created_at")
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("payments")
        .select("id, amount, status, created_at")
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("users")
        .select("id, name, role, created_at")
        .order("created_at", { ascending: false })
        .limit(10),
      supabase
        .from("support_tickets")
        .select("id, subject, created_at")
        .order("created_at", { ascending: false })
        .limit(10),
    ]);

  const items: ActivityItem[] = [
    ...(requests ?? []).map((r) => ({
      id: `req-${r.id}`,
      type: "Service request",
      description: `New ${r.appliance_type.replace("_", " ")} request — ${r.location}`,
      timestamp: r.created_at,
    })),
    ...(bookings ?? []).map((b) => ({
      id: `book-${b.id}`,
      type: "Booking",
      description: `Booking ${b.status}`,
      timestamp: b.created_at,
    })),
    ...(payments ?? []).map((p) => ({
      id: `pay-${p.id}`,
      type: "Payment",
      description: `₱${p.amount.toFixed(2)} — ${p.status.replace("_", " ")}`,
      timestamp: p.created_at,
    })),
    ...(users ?? []).map((u) => ({
      id: `user-${u.id}`,
      type: "New account",
      description: `${u.name} registered as ${u.role.replace("_", " ")}`,
      timestamp: u.created_at,
    })),
    ...(tickets ?? []).map((t) => ({
      id: `ticket-${t.id}`,
      type: "Support ticket",
      description: t.subject,
      timestamp: t.created_at,
    })),
  ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-ink">Activity log</h1>
      <p className="mt-1 text-sm text-ink/65">Recent events across the platform, most recent first.</p>

      <div className="mt-6 space-y-2">
        {!items.length ? (
          <p className="text-sm text-ink/50">No activity yet.</p>
        ) : (
          items.slice(0, 30).map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between rounded-card border border-ink/8 bg-white p-3 shadow-card"
            >
              <div>
                <span className="rounded-full bg-brand-50 px-2 py-0.5 text-[11px] font-semibold text-brand-600">
                  {item.type}
                </span>
                <p className="mt-1 text-sm text-ink">{item.description}</p>
              </div>
              <p className="shrink-0 text-xs text-ink/35">
                {new Date(item.timestamp).toLocaleString()}
              </p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
