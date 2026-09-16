import { createServiceRoleClient } from "@/lib/supabase/server";
import StatusBadge from "@/components/StatusBadge";

export default async function AdminBookingReviewPage() {
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

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-ink">Booking review</h1>
      <p className="mt-1 text-sm text-ink/65">Oversight of every booking on the platform.</p>

      <div className="mt-6 overflow-x-auto rounded-card border border-ink/8 bg-white shadow-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-ink/8 bg-canvas text-xs uppercase tracking-wide text-ink/40">
            <tr>
              <th className="px-4 py-3 font-medium">Appliance</th>
              <th className="px-4 py-3 font-medium">Customer</th>
              <th className="px-4 py-3 font-medium">Technician</th>
              <th className="px-4 py-3 font-medium">Scheduled</th>
              <th className="px-4 py-3 font-medium">Final Cost</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {!bookings?.length ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-sm text-ink/40">
                  No bookings yet.
                </td>
              </tr>
            ) : (
              bookings.map((b) => {
                const r = requestMap.get(b.service_request_id);
                return (
                  <tr key={b.id} className="border-b border-ink/5 last:border-0">
                    <td className="px-4 py-3 capitalize text-ink">
                      {r?.appliance_type.replace("_", " ") ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-ink/70">{userMap.get(b.customer_id) ?? "—"}</td>
                    <td className="px-4 py-3 text-ink/70">{userMap.get(b.technician_id) ?? "—"}</td>
                    <td className="px-4 py-3 text-xs text-ink/50">
                      {new Date(b.scheduled_at).toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-ink/70">
                      {b.final_cost != null ? `₱${b.final_cost.toFixed(2)}` : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={b.status} />
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
