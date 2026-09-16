import { createServiceRoleClient } from "@/lib/supabase/server";
import StatusBadge from "@/components/StatusBadge";

export default async function AdminJobMonitoringPage() {
  const supabase = createServiceRoleClient();

  const { data: bookings } = await supabase
    .from("bookings")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);

  const requestIds = Array.from(new Set((bookings ?? []).map((b) => b.service_request_id)));
  const { data: requests } = requestIds.length
    ? await supabase.from("service_requests").select("*").in("id", requestIds)
    : { data: [] };
  const requestMap = new Map((requests ?? []).map((r) => [r.id, r]));

  const userIds = Array.from(
    new Set((bookings ?? []).flatMap((b) => [b.customer_id, b.technician_id]))
  );
  const { data: users } = userIds.length
    ? await supabase.from("users").select("id, name").in("id", userIds)
    : { data: [] };
  const userMap = new Map((users ?? []).map((u) => [u.id, u.name]));

  const bookingIds = (bookings ?? []).map((b) => b.id);
  const { data: ratings } = bookingIds.length
    ? await supabase.from("ratings").select("booking_id, rating").in("booking_id", bookingIds)
    : { data: [] };
  const ratingMap = new Map((ratings ?? []).map((r) => [r.booking_id, r.rating]));

  const activeCount = (bookings ?? []).filter(
    (b) => b.status === "pending" || b.status === "in_progress" || b.status === "awaiting_inspection"
  ).length;
  const completedCount = (bookings ?? []).filter((b) => b.status === "completed").length;
  const avgRating = ratings?.length
    ? (ratings.reduce((s, r) => s + r.rating, 0) / ratings.length).toFixed(1)
    : "—";

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-ink">Job monitoring &amp; QA</h1>
      <p className="mt-1 text-sm text-ink/65">Real-time tracking and quality assurance for all repair jobs.</p>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="Active Jobs" value={activeCount} />
        <StatCard label="Completed" value={completedCount} />
        <StatCard label="Avg. Customer Rating" value={avgRating === "—" ? avgRating : `${avgRating}/5`} />
      </div>

      <div className="mt-8 overflow-x-auto rounded-card border border-ink/8 bg-white shadow-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-ink/8 bg-canvas text-xs uppercase tracking-wide text-ink/40">
            <tr>
              <th className="px-4 py-3 font-medium">Job ID</th>
              <th className="px-4 py-3 font-medium">Customer</th>
              <th className="px-4 py-3 font-medium">Appliance</th>
              <th className="px-4 py-3 font-medium">Technician</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Location</th>
              <th className="px-4 py-3 font-medium">Rating</th>
            </tr>
          </thead>
          <tbody>
            {!bookings?.length ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-sm text-ink/40">
                  No bookings yet.
                </td>
              </tr>
            ) : (
              bookings.map((b) => {
                const r = requestMap.get(b.service_request_id);
                const rating = ratingMap.get(b.id);
                return (
                  <tr key={b.id} className="border-b border-ink/5 last:border-0">
                    <td className="px-4 py-3 font-mono text-xs text-ink/50">
                      {b.id.slice(0, 8)}
                    </td>
                    <td className="px-4 py-3 text-ink/70">{userMap.get(b.customer_id) ?? "—"}</td>
                    <td className="px-4 py-3 capitalize text-ink/70">
                      {r?.appliance_type.replace("_", " ") ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-ink/70">{userMap.get(b.technician_id) ?? "—"}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={b.status} />
                    </td>
                    <td className="px-4 py-3 text-xs text-ink/50">{r?.location}</td>
                    <td className="px-4 py-3 text-xs text-ink/50">
                      {rating != null ? `★ ${rating}/5` : "—"}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-card border border-ink/8 bg-white p-3 shadow-card">
      <p className="font-display text-lg font-semibold text-ink">{value}</p>
      <p className="mt-0.5 text-xs text-ink/50">{label}</p>
    </div>
  );
}
