import { createServiceRoleClient } from "@/lib/supabase/server";
import StatusBadge from "@/components/StatusBadge";

export default async function AdminProgressManagementPage() {
  const supabase = createServiceRoleClient();

  const { data: bookings } = await supabase
    .from("bookings")
    .select("*")
    .in("status", ["pending", "in_progress"])
    .order("scheduled_at", { ascending: true });

  const bookingIds = (bookings ?? []).map((b) => b.id);
  const { data: visits } = bookingIds.length
    ? await supabase.from("visits").select("*").in("booking_id", bookingIds)
    : { data: [] };

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

  const { count: activeJobs } = await supabase
    .from("bookings")
    .select("*", { count: "exact", head: true })
    .in("status", ["pending", "in_progress"]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const { count: visitsToday } = await supabase
    .from("visits")
    .select("*", { count: "exact", head: true })
    .gte("scheduled_at", today.toISOString());

  const { data: completedBookings } = await supabase
    .from("bookings")
    .select("id, status")
    .eq("status", "completed");
  const completedBookingIds = (completedBookings ?? []).map((b) => b.id);
  const { data: completedVisits } = completedBookingIds.length
    ? await supabase
        .from("visits")
        .select("booking_id, status")
        .in("booking_id", completedBookingIds)
    : { data: [] };

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-ink">Progress management</h1>
      <p className="mt-1 text-sm text-ink/65">Monitor and manage all repair jobs and visits.</p>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Active Jobs" value={activeJobs ?? 0} />
        <StatCard label="Visits Today" value={visitsToday ?? 0} />
        <StatCard
          label="Avg. Visits / Job"
          value={
            bookings?.length
              ? ((visits?.length ?? 0) / bookings.length).toFixed(1)
              : "—"
          }
        />
        <StatCard
          label="First-Time Fix Rate"
          value={firstTimeFixRate(completedBookings ?? [], completedVisits ?? [])}
        />
      </div>

      <div className="mt-8 overflow-x-auto rounded-card border border-ink/8 bg-white shadow-card">
        <table className="min-w-[760px] w-full text-left text-sm">
          <thead className="border-b border-ink/8 bg-canvas text-xs uppercase tracking-wide text-ink/40">
            <tr>
              <th className="px-4 py-3 font-medium">Job</th>
              <th className="px-4 py-3 font-medium">Customer</th>
              <th className="px-4 py-3 font-medium">Technician</th>
              <th className="px-4 py-3 font-medium">Progress</th>
              <th className="px-4 py-3 font-medium">Location</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {!bookings?.length ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-sm text-ink/40">
                  No active jobs right now.
                </td>
              </tr>
            ) : (
              bookings.map((b) => {
                const r = requestMap.get(b.service_request_id);
                const jobVisits = (visits ?? []).filter((v) => v.booking_id === b.id);
                const completed = jobVisits.filter((v) => v.status === "completed").length;
                return (
                  <tr key={b.id} className="border-b border-ink/5 last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-medium capitalize text-ink">
                        {r?.appliance_type.replace("_", " ") ?? "Repair"}
                      </p>
                      <p className="text-xs text-ink/40">{r?.issue_description}</p>
                    </td>
                    <td className="px-4 py-3 text-ink/70">{userMap.get(b.customer_id) ?? "—"}</td>
                    <td className="px-4 py-3 text-ink/70">{userMap.get(b.technician_id) ?? "—"}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 w-20 overflow-hidden rounded-full bg-ink/10">
                          <div
                            className="h-full bg-brand-500"
                            style={{
                              width: `${jobVisits.length ? (completed / jobVisits.length) * 100 : 0}%`,
                            }}
                          />
                        </div>
                        <span className="text-xs text-ink/50">
                          {completed}/{jobVisits.length}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-ink/50">{r?.location}</td>
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

function firstTimeFixRate(
  bookings: { id: string; status: string }[],
  visits: { booking_id: string; status: string }[]
): string {
  const completedBookings = bookings.filter((b) => b.status === "completed");
  if (!completedBookings.length) return "—";
  const fixedFirstTry = completedBookings.filter(
    (b) => visits.filter((v) => v.booking_id === b.id).length <= 1
  ).length;
  return `${Math.round((fixedFirstTry / completedBookings.length) * 100)}%`;
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-card border border-ink/8 bg-white p-3 shadow-card">
      <p className="font-display text-lg font-semibold text-ink">{value}</p>
      <p className="mt-0.5 text-xs text-ink/50">{label}</p>
    </div>
  );
}
