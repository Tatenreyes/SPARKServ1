import Link from "next/link";
import { createServiceRoleClient } from "@/lib/supabase/server";
import StatusBadge from "@/components/StatusBadge";
import { DashboardPanel, DashboardStatCard } from "@/components/DashboardCard";
import {
  ArrowRight,
  BriefcaseBusiness,
  CalendarClock,
  CircleAlert,
  ShieldCheck,
  Users,
  Wrench,
  CheckCircle2,
  XCircle,
  AlertCircle,
} from "lucide-react";

const ACTIVE_BOOKING_STATUSES = ["pending", "in_progress", "awaiting_inspection"];

type QueueSnapshotRow = {
  id: string;
  name: string;
  booked: boolean;
  queuePosition: number | null;
  lastAssignedAt: string | null;
};

export default async function AdminDashboard() {
  const supabase = createServiceRoleClient();

  const { count: technicianCount } = await supabase
    .from("technicians")
    .select("*", { count: "exact", head: true })
    .eq("approved", true);

  const { count: activeRepairs } = await supabase
    .from("bookings")
    .select("*", { count: "exact", head: true })
    .in("status", ACTIVE_BOOKING_STATUSES);

  const { count: pendingApprovals } = await supabase
    .from("technicians")
    .select("*", { count: "exact", head: true })
    .eq("approved", false);

  const { data: activeBookings } = await supabase
    .from("bookings")
    .select("id, service_request_id, technician_id, scheduled_at, status")
    .in("status", ACTIVE_BOOKING_STATUSES)
    .order("scheduled_at", { ascending: true })
    .limit(20);

  const activeRequestIds = Array.from(
    new Set((activeBookings ?? []).map((booking) => booking.service_request_id))
  );
  const { data: activeRequests } = activeRequestIds.length
    ? await supabase
        .from("service_requests")
        .select("id, appliance_type")
        .in("id", activeRequestIds)
    : { data: [] };
  const activeRequestMap = new Map((activeRequests ?? []).map((request) => [request.id, request]));

  const { data: approvedTechnicians } = await supabase
    .from("technicians")
    .select("id, specializations, approved")
    .eq("approved", true);
  const approvedTechnicianIds = (approvedTechnicians ?? []).map((technician) => technician.id);
  const { data: technicianUsers } = approvedTechnicianIds.length
    ? await supabase.from("users").select("id, name").in("id", approvedTechnicianIds)
    : { data: [] };
  const technicianMap = new Map((technicianUsers ?? []).map((technician) => [technician.id, technician.name]));

  const { data: allActiveBookings } = approvedTechnicianIds.length
    ? await supabase
        .from("bookings")
        .select("technician_id")
        .in("technician_id", approvedTechnicianIds)
        .in("status", ACTIVE_BOOKING_STATUSES)
    : { data: [] };
  const bookedTechnicianIds = new Set(
    (allActiveBookings ?? []).map((booking) => booking.technician_id)
  );
  const relevantApplianceTypes = Array.from(
    new Set(
      (approvedTechnicians ?? []).flatMap((technician) =>
        (technician.specializations ?? [])
          .map((specialization: string) => specialization.trim().toLowerCase())
          .filter(Boolean)
      )
    )
  ).sort();
  const { data: queueStates } = await supabase
    .from("technician_queue_state")
    .select("technician_id, appliance_type, last_assigned_at");
  const queueStateMap = new Map(
    (queueStates ?? []).map((state) => [
      `${state.technician_id}:${state.appliance_type.trim().toLowerCase()}`,
      state.last_assigned_at,
    ])
  );
  const queueSnapshots = relevantApplianceTypes.map((type) => {
    const qualified: QueueSnapshotRow[] = (approvedTechnicians ?? [])
      .filter((technician) =>
        (technician.specializations ?? []).some(
          (specialization: string) => specialization.trim().toLowerCase() === type
        )
      )
      .map((technician) => ({
        id: technician.id,
        name: technicianMap.get(technician.id) ?? "Unknown technician",
        booked: bookedTechnicianIds.has(technician.id),
        queuePosition: null,
        lastAssignedAt: queueStateMap.get(`${technician.id}:${type}`) ?? null,
      }));
    const available = qualified
      .filter((technician) => !technician.booked)
      .sort(compareQueueOrder);
    available.forEach((technician, index) => {
      technician.queuePosition = index + 1;
    });
    return { type, rows: [...available, ...qualified.filter((technician) => technician.booked)] };
  });

  const { data: recentActivity } = await supabase
    .from("service_requests")
    .select("id, appliance_type, location, created_at, status")
    .order("created_at", { ascending: false })
    .limit(5);

  const { count: openRequests } = await supabase
    .from("service_requests")
    .select("*", { count: "exact", head: true })
    .eq("status", "open");

  const { count: supportTickets } = await supabase
    .from("support_tickets")
    .select("*", { count: "exact", head: true })
    .eq("status", "open");

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-ink">Admin Dashboard</p>
          <h1 className="mt-2 font-display text-3xl font-bold text-ink">Welcome back, Admin</h1>
          <p className="mt-1.5 text-sm text-muted">Monitor operations, technicians, and platform health.</p>
        </div>
        <Link href="/admin/technicians" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 hover:shadow-md">
          Review Pending Technicians
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <DashboardStatCard label="Total Technicians" value={technicianCount ?? 0} href="/admin/technicians" icon={Users} colorClass="bg-brand-soft text-brand-ink" />
        <DashboardStatCard label="Active Jobs" value={activeRepairs ?? 0} href="/admin/job-monitoring" icon={Wrench} colorClass="bg-brand-soft text-brand-ink" />
        <DashboardStatCard label="Pending Approvals" value={pendingApprovals ?? 0} href="/admin/technicians" icon={ShieldCheck} colorClass="bg-yellow-50 text-yellow-600" />
        <DashboardStatCard label="Open Requests" value={openRequests ?? 0} href="/admin/dashboard" icon={BriefcaseBusiness} colorClass="bg-brand-soft text-brand-ink" />
        <DashboardStatCard label="Support Tickets" value={supportTickets ?? 0} href="/admin/support-tickets" icon={CircleAlert} colorClass="bg-alert-soft text-alert-ink" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <DashboardPanel title="Active Bookings & Queue" className="min-h-[280px]">
          {!activeBookings?.length ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-soft text-muted/80">
                <CalendarClock className="h-6 w-6" />
              </div>
              <p className="mt-4 text-sm font-medium text-muted">No active bookings right now</p>
              <p className="mt-1 text-xs text-muted/80">Active jobs will appear here once scheduled.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {activeBookings.slice(0, 6).map((booking) => {
                const request = activeRequestMap.get(booking.service_request_id);
                return (
                  <div
                    key={booking.id}
                    className="flex flex-col gap-2 rounded-2xl border border-line bg-soft p-4 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <p className="font-display text-sm font-semibold capitalize text-ink">
                        {request?.appliance_type?.replace(/_/g, " ") ?? "Repair"}
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        {technicianMap.get(booking.technician_id) ?? "Unknown technician"} ·{" "}
                        {new Date(booking.scheduled_at).toLocaleString()}
                      </p>
                    </div>
                    <StatusBadge status={booking.status} />
                  </div>
                );
              })}
            </div>
          )}
        </DashboardPanel>

        <div className="space-y-6">
          <DashboardPanel title="Attention Required">
            <div className="space-y-3">
              {/* Tinted alert card: `brand-soft` + a brand-300 edge read the same
                  pale-blue panel in day mode and a lifted navy panel at night.
                  The icon disc uses `surface` so it never merges into the card
                  fill in either theme (both were `spark-*` before). */}
              <Link href="/admin/technicians" className="flex items-start gap-3 rounded-2xl border border-brand-300/50 bg-brand-soft p-3 transition hover:border-brand-400">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface text-brand-ink ring-1 ring-inset ring-brand-300/60">
                  <ShieldCheck className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-brand-ink">{pendingApprovals ?? 0} technicians pending approval</p>
                  <p className="text-xs text-brand-ink/80">Review and approve new technician accounts.</p>
                </div>
              </Link>
              <Link href="/admin/dashboard" className="flex items-start gap-3 rounded-2xl border border-brand-300/50 bg-brand-soft p-3 transition hover:border-brand-400">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface text-brand-ink ring-1 ring-inset ring-brand-300/60">
                  <BriefcaseBusiness className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-brand-ink">{openRequests ?? 0} open service requests</p>
                  <p className="text-xs text-brand-ink/80">Requests waiting for technician assignment.</p>
                </div>
              </Link>
              <Link href="/admin/support-tickets" className="flex items-start gap-3 rounded-2xl border border-line bg-soft p-3 transition hover:border-brand-300">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface text-muted ring-1 ring-inset ring-line">
                  <CircleAlert className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-ink/80">{supportTickets ?? 0} support tickets open</p>
                  <p className="text-xs text-muted">Customer issues awaiting response.</p>
                </div>
              </Link>
            </div>
          </DashboardPanel>

          <DashboardPanel title="Quick Actions">
            <div className="grid gap-3 sm:grid-cols-2">
              <QuickAction href="/admin/technicians" label="Approve Technicians" icon={<ShieldCheck className="h-4 w-4" />} />
              <QuickAction href="/admin/job-monitoring" label="Monitor Jobs" icon={<Wrench className="h-4 w-4" />} />
              <QuickAction href="/admin/support-tickets" label="Support Tickets" icon={<CircleAlert className="h-4 w-4" />} />
              <QuickAction href="/admin/users" label="User Management" icon={<Users className="h-4 w-4" />} />
            </div>
          </DashboardPanel>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <DashboardPanel title="Platform Activity">
          {!recentActivity?.length ? (
            <p className="text-sm text-muted">No recent activity yet.</p>
          ) : (
            <ul className="space-y-3">
              {recentActivity.map((r) => {
                const statusIcon =
                  r.status === "completed" ? (
                    <CheckCircle2 className="h-4 w-4 text-signal-ink" />
                  ) : r.status === "cancelled" ? (
                    <XCircle className="h-4 w-4 text-alert-ink" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-brand-ink" />
                  );
                return (
                  <li key={r.id} className="flex items-start gap-3 border-b border-line pb-3 last:border-b-0 last:pb-0">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-ink">
                      {statusIcon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-ink/90 capitalize">
                        {r.appliance_type.replace(/_/g, " ")}
                      </p>
                      <p className="mt-0.5 text-xs text-muted">Request in {r.location}</p>
                      <p className="mt-1 text-[11px] text-muted/80">{timeAgo(r.created_at)}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </DashboardPanel>

        <DashboardPanel title="Technician Queue Preview">
          {!queueSnapshots.length ? (
            <p className="text-sm text-muted">No approved technician queues yet.</p>
          ) : (
            <div className="space-y-4">
              {queueSnapshots.slice(0, 3).map((snapshot) => {
                const available = snapshot.rows.filter((technician) => !technician.booked);
                const booked = snapshot.rows.filter((technician) => technician.booked);
                return (
                  <div key={snapshot.type} className="rounded-2xl border border-line bg-surface p-4 shadow-sm">
                    <h3 className="font-display text-sm font-semibold capitalize text-ink">
                      {snapshot.type.replace(/_/g, " ")}
                    </h3>
                    <div className="mt-3 space-y-2">
                      {available.slice(0, 3).map((technician) => (
                        <div key={technician.id} className="flex items-center justify-between rounded-xl border border-line px-3 py-2">
                          <div>
                            <p className="text-xs font-semibold text-ink/90">
                              {technician.queuePosition ? `${technician.queuePosition}. ` : ""}
                              {technician.name}
                            </p>
                          </div>
                          <span className="rounded-full bg-signal-soft px-2 py-1 text-[10px] font-semibold text-signal-ink">
                            Available
                          </span>
                        </div>
                      ))}
                      {booked.length > 0 && (
                        <div className="flex items-center justify-between rounded-xl border border-line px-3 py-2">
                          <p className="text-xs font-semibold text-ink/90">{booked[0].name}</p>
                          <span className="rounded-full bg-warn-soft px-2 py-1 text-[10px] font-semibold text-warn-ink">
                            Booked
                          </span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </DashboardPanel>
      </div>
    </div>
  );
}

function QuickAction({ href, label, icon }: { href: string; label: string; icon: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3 transition hover:border-line hover:bg-brand-soft/50"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand-ink">{icon}</span>
      <span className="text-sm font-medium text-ink/80">{label}</span>
    </Link>
  );
}

function compareQueueOrder(a: QueueSnapshotRow, b: QueueSnapshotRow) {
  if (!a.lastAssignedAt && !b.lastAssignedAt) return a.name.localeCompare(b.name);
  if (!a.lastAssignedAt) return -1;
  if (!b.lastAssignedAt) return 1;
  return new Date(a.lastAssignedAt).getTime() - new Date(b.lastAssignedAt).getTime();
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
