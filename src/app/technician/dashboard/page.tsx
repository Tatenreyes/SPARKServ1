import Link from "next/link";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { DashboardPanel, DashboardStatCard } from "@/components/DashboardCard";
import {
  ArrowRight,
  BriefcaseBusiness,
  CalendarClock,
  MessageSquareText,
  Star,
  TrendingUp,
  Wrench,
  CheckCircle2,
  XCircle,
  AlertCircle,
} from "lucide-react";

export default async function TechnicianDashboard() {
  const user = await getCurrentUser();
  const supabase = createClient();

  const { data: technicianProfile } = await supabase
    .from("technicians")
    .select("*")
    .eq("id", user!.id)
    .single();

  const { data: pendingOffers } = await supabase
    .from("service_requests")
    .select("*")
    .eq("assigned_technician_id", user!.id)
    .eq("assignment_status", "offered")
    .order("created_at", { ascending: false });

  const { count: assignedJobs } = await supabase
    .from("bookings")
    .select("*", { count: "exact", head: true })
    .eq("technician_id", user!.id)
    .in("status", ["pending", "in_progress"]);

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const { count: completedToday } = await supabase
    .from("bookings")
    .select("*", { count: "exact", head: true })
    .eq("technician_id", user!.id)
    .eq("status", "completed")
    .gte("updated_at", todayStart.toISOString());

  const { data: activeBookings } = await supabase
    .from("bookings")
    .select("id, service_request_id, scheduled_at, status")
    .eq("technician_id", user!.id)
    .in("status", ["pending", "in_progress"])
    .order("scheduled_at", { ascending: true });

  const activeRequestIds = Array.from(
    new Set((activeBookings ?? []).map((b) => b.service_request_id))
  );
  const { data: activeRequests } = activeRequestIds.length
    ? await supabase
        .from("service_requests")
        .select("id, appliance_type, location, problem_description, status")
        .in("id", activeRequestIds)
    : { data: [] };
  const activeRequestMap = new Map((activeRequests ?? []).map((r) => [r.id, r]));

  const serviceRoleClient = createServiceRoleClient();
  const { data: recentActivity } = await serviceRoleClient
    .from("service_requests")
    .select("id, appliance_type, location, created_at, status")
    .order("created_at", { ascending: false })
    .limit(5);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-600">Technician Dashboard</p>
          <h1 className="mt-2 font-display text-3xl font-bold text-ink">
            {greeting}, {user?.name?.split(" ")[0]}
          </h1>
          <p className="mt-1.5 text-sm text-slate-500">
            Manage your jobs, offers, and customer communications.
          </p>
        </div>
        {!technicianProfile?.approved && (
          <span className="rounded-full border border-spark-200 bg-spark-50 px-4 py-2 text-xs font-semibold text-spark-700">
            Pending admin approval
          </span>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <DashboardStatCard
          label="Pending Offers"
          value={pendingOffers?.length ?? 0}
          hint="Awaiting your response"
          href="/technician/estimate-requests"
          icon={BriefcaseBusiness}
        />
        <DashboardStatCard
          label="Active Jobs"
          value={assignedJobs ?? 0}
          hint="Scheduled and active"
          href="/technician/jobs"
          icon={Wrench}
        />
        <DashboardStatCard
          label="Completed Today"
          value={completedToday ?? 0}
          hint="Jobs finished today"
          href="/technician/jobs"
          icon={CalendarClock}
        />
        <DashboardStatCard
          label="Average Rating"
          value={technicianProfile?.rating ? technicianProfile.rating.toFixed(1) : "—"}
          hint="Customer feedback"
          href="/technician/jobs"
          icon={Star}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <DashboardPanel title="Your Schedule" className="min-h-[240px]">
          {!activeBookings?.length ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                <CalendarClock className="h-6 w-6" />
              </div>
              <p className="mt-4 text-sm font-medium text-slate-600">No upcoming jobs scheduled</p>
              <p className="mt-1 text-xs text-slate-400">Accept offers to start filling your schedule.</p>
              <Link
                href="/technician/estimate-requests"
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-brand-700"
              >
                View Offers <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {activeBookings.slice(0, 5).map((booking) => {
                const request = activeRequestMap.get(booking.service_request_id);
                return (
                  <Link
                    key={booking.id}
                    href={`/technician/bookings/${booking.id}`}
                    className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-4 transition hover:border-brand-200 hover:bg-white sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div>
                      <p className="font-display text-sm font-semibold capitalize text-slate-900">
                        {request?.appliance_type?.replace(/_/g, " ") ?? "Repair"}
                      </p>
                      <p className="mt-1 text-xs text-slate-500">
                        {request?.location ?? ""} · {new Date(booking.scheduled_at).toLocaleString()}
                      </p>
                    </div>
                    <StatusBadge status={booking.status} />
                  </Link>
                );
              })}
            </div>
          )}
        </DashboardPanel>

        <div className="space-y-6">
          <DashboardPanel title="Quick Actions">
            <div className="grid gap-3 sm:grid-cols-2">
              <QuickAction href="/technician/estimate-requests" label="Pending Offers" icon={<BriefcaseBusiness className="h-4 w-4" />} />
              <QuickAction href="/technician/jobs" label="My Jobs" icon={<Wrench className="h-4 w-4" />} />
              <QuickAction href="/technician/messages" label="Messages" icon={<MessageSquareText className="h-4 w-4" />} />
              <QuickAction href="/technician/profile" label="My Profile" icon={<Star className="h-4 w-4" />} />
            </div>
          </DashboardPanel>

          <DashboardPanel title="Recent Activity">
            {!recentActivity?.length ? (
              <p className="text-sm text-slate-500">No recent activity yet.</p>
            ) : (
              <ul className="space-y-3">
                {recentActivity.map((r) => {
                  const statusIcon =
                    r.status === "completed" ? (
                      <CheckCircle2 className="h-4 w-4 text-signal-500" />
                    ) : r.status === "cancelled" ? (
                      <XCircle className="h-4 w-4 text-alert-500" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-brand-500" />
                    );
                  return (
                    <li key={r.id} className="flex items-start gap-3 border-b border-slate-100 pb-3 last:border-b-0 last:pb-0">
                      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-brand-600">
                        {statusIcon}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-800 capitalize">
                          {r.appliance_type.replace(/_/g, " ")}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-500">Request in {r.location}</p>
                        <p className="mt-1 text-[11px] text-slate-400">{timeAgo(r.created_at)}</p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </DashboardPanel>
        </div>
      </div>

      <DashboardPanel title="Performance Overview">
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <MetricBox icon={<Star className="h-5 w-5 text-amber-500" />} label="Rating" value={technicianProfile?.rating ? technicianProfile.rating.toFixed(1) : "—"} />
          <MetricBox icon={<Wrench className="h-5 w-5 text-brand-600" />} label="Active Jobs" value={assignedJobs ?? 0} />
          <MetricBox icon={<CheckCircle2 className="h-5 w-5 text-signal-500" />} label="Completed Today" value={completedToday ?? 0} />
          <MetricBox icon={<TrendingUp className="h-5 w-5 text-brand-600" />} label="Total Jobs" value={technicianProfile?.total_jobs ?? 0} />
        </div>
      </DashboardPanel>
    </div>
  );
}

function MetricBox({ icon, label, value }: { icon: React.ReactNode; label: string; value: string | number }) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-50">{icon}</span>
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">{label}</p>
        <p className="font-display text-lg font-semibold text-slate-900">{value}</p>
      </div>
    </div>
  );
}

function QuickAction({ href, label, icon }: { href: string; label: string; icon: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 transition hover:border-brand-200 hover:bg-brand-50/50"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">{icon}</span>
      <span className="text-sm font-medium text-slate-700">{label}</span>
    </Link>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    pending: "bg-amber-50 text-amber-700",
    in_progress: "bg-brand-50 text-brand-700",
    completed: "bg-signal-50 text-signal-700",
    cancelled: "bg-red-50 text-red-700",
    offered: "bg-slate-100 text-slate-700",
    open: "bg-slate-100 text-slate-700",
    quoted: "bg-amber-50 text-amber-700",
    assigned: "bg-brand-50 text-brand-700",
  };
  return (
    <span className={`rounded-full px-3 py-1 text-[10px] font-semibold capitalize ${styles[status] ?? "bg-slate-100 text-slate-700"}`}>
      {status.replace(/_/g, " ")}
    </span>
  );
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
