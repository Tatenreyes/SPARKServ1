import Link from "next/link";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import StatusBadge from "@/components/StatusBadge";
import { DashboardPanel, DashboardStatCard } from "@/components/DashboardCard";
import {
  ArrowRight,
  CalendarCheck2,
  ClipboardList,
  MapPin,
  Plus,
  Sparkles,
  Wrench,
  Bell,
  TrendingUp,
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
} from "lucide-react";

export default async function CustomerDashboard() {
  const user = await getCurrentUser();
  const supabase = createClient();

  const { data: requests } = await supabase
    .from("service_requests")
    .select("*")
    .eq("customer_id", user!.id)
    .order("created_at", { ascending: false });

  const { data: bookings } = await supabase
    .from("bookings")
    .select("*")
    .eq("customer_id", user!.id)
    .order("scheduled_at", { ascending: true });

  const { count: historyCount } = await supabase
    .from("service_history")
    .select("*", { count: "exact", head: true })
    .eq("customer_id", user!.id);

  const activeRequests = (requests ?? []).filter(
    (r) => r.status !== "completed" && r.status !== "cancelled"
  );

  const serviceRoleClient = createServiceRoleClient();
  const { data: recentActivity } = await serviceRoleClient
    .from("service_requests")
    .select("id, appliance_type, location, created_at, status")
    .order("created_at", { ascending: false })
    .limit(5);

  const { data: announcementSetting } = await supabase
    .from("system_settings")
    .select("value")
    .eq("key", "platform_announcement")
    .maybeSingle();

  const activeRepair = activeRequests[0] ?? null;
  const nextBooking = (bookings ?? []).find(
    (b) => b.status !== "completed" && b.status !== "cancelled"
  ) ?? null;

  const pendingEstimates = (requests ?? []).filter(
    (r) => r.status === "quoted" || r.status === "pending"
  ).length;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  return (
    <div className="space-y-6">
      {announcementSetting?.value && (
        <div className="flex items-start gap-3 rounded-2xl border border-spark-200 bg-spark-50 px-5 py-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-spark-100 text-spark-600">
            <Bell className="h-5 w-5" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-semibold text-spark-800">Platform Announcement</p>
            <p className="mt-1 text-sm text-spark-700">{announcementSetting.value}</p>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-600">Customer Dashboard</p>
          <h1 className="mt-2 font-display text-3xl font-bold text-ink">
            {greeting}, {user?.name?.split(" ")[0]}
          </h1>
          <p className="mt-1.5 text-sm text-slate-500">
            Here&apos;s what&apos;s happening with your repairs today.
          </p>
        </div>
        <Link
          href="/customer/request-repair"
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 hover:shadow-md"
        >
          <Plus className="h-4 w-4" />
          Start Service Inquiry
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <DashboardStatCard
          label="Active Requests"
          value={activeRequests.length}
          hint={activeRequests.length > 0 ? "In progress or pending" : "No active requests"}
          href="/customer/dashboard"
          icon={Wrench}
        />
        <DashboardStatCard
          label="Pending Estimates"
          value={pendingEstimates}
          hint="Awaiting your review"
          href="/customer/estimates"
          icon={ClipboardList}
        />
        <DashboardStatCard
          label="Upcoming Booking"
          value={nextBooking ? "1" : "0"}
          hint={nextBooking ? "Scheduled visit" : "No upcoming visits"}
          href="/customer/bookings"
          icon={CalendarCheck2}
        />
        <DashboardStatCard
          label="Completed Repairs"
          value={historyCount ?? 0}
          hint="View service history"
          href="/customer/repair-history"
          icon={Sparkles}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <DashboardPanel title="Active Repair" className="min-h-[240px]">
          {!activeRepair ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-400">
                <Wrench className="h-6 w-6" />
              </div>
              <p className="mt-4 text-sm font-medium text-slate-600">No active repair right now</p>
              <p className="mt-1 text-xs text-slate-400">Start a service inquiry to get matched with a technician.</p>
              <Link
                href="/customer/request-repair"
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-xs font-semibold text-white transition hover:bg-brand-700"
              >
                Start Inquiry <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>
          ) : (
            <div className="space-y-5">
              <div className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Appliance</p>
                  <p className="mt-1.5 font-display text-lg font-semibold text-slate-900 capitalize">
                    {activeRepair.appliance_type.replace("_", " ")}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Status</p>
                  <div className="mt-1.5">
                    <StatusBadge status={activeRepair.status} />
                  </div>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <InfoMetric
                  label="Current Status"
                  value={activeRepair.status.replace("_", " ")}
                  icon={<Clock className="h-3.5 w-3.5" />}
                />
                <InfoMetric
                  label="Progress"
                  value={
                    activeRepair.status === "quoted"
                      ? "Estimate ready"
                      : activeRepair.status === "open"
                      ? "Awaiting technician"
                      : activeRepair.status === "assigned"
                      ? "Technician assigned"
                      : "In progress"
                  }
                  icon={<TrendingUp className="h-3.5 w-3.5" />}
                />
                <InfoMetric
                  label="Next Appointment"
                  value={nextBooking ? new Date(nextBooking.scheduled_at).toLocaleString() : "To be scheduled"}
                  icon={<CalendarCheck2 className="h-3.5 w-3.5" />}
                />
                <InfoMetric
                  label="Location"
                  value={activeRepair.location}
                  icon={<MapPin className="h-3.5 w-3.5" />}
                />
              </div>

              <Link
                href={`/customer/service-request/${activeRepair.id}`}
                className="inline-flex h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-5 text-sm font-semibold text-slate-700 transition hover:border-brand-200 hover:text-brand-700"
              >
                View Full Details <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </div>
          )}
        </DashboardPanel>

        <div className="space-y-6">
          <DashboardPanel title="Quick Actions">
            <div className="grid gap-3 sm:grid-cols-2">
              <QuickAction href="/customer/request-repair" label="New Inquiry" icon={<Wrench className="h-4 w-4" />} />
              <QuickAction href="/customer/appliances" label="My Appliances" icon={<Plus className="h-4 w-4" />} />
              <QuickAction href="/customer/estimates" label="Estimates" icon={<ClipboardList className="h-4 w-4" />} />
              <QuickAction href="/customer/progress-tracking" label="Track Repair" icon={<TrendingUp className="h-4 w-4" />} />
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
                          {r.appliance_type.replace("_", " ")}
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

      <DashboardPanel title="Your Service Requests">
        {!requests?.length ? (
          <div className="flex flex-col items-center justify-center py-10 text-center">
            <p className="text-sm text-slate-500">No service requests yet.</p>
            <Link
              href="/customer/request-repair"
              className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-brand-600 hover:text-brand-700"
            >
              Start your first inquiry <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {requests.slice(0, 6).map((r) => (
              <Link
                key={r.id}
                href={`/customer/service-request/${r.id}`}
                className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-4 transition hover:border-brand-200 hover:bg-white"
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="font-display text-sm font-semibold capitalize text-slate-900">
                    {r.appliance_type.replace("_", " ")}
                  </p>
                  <StatusBadge status={r.status} />
                </div>
                <p className="text-xs text-slate-500 line-clamp-2">{r.issue_description}</p>
                <p className="text-[11px] text-slate-400">{new Date(r.created_at).toLocaleDateString()}</p>
              </Link>
            ))}
          </div>
        )}
      </DashboardPanel>
    </div>
  );
}

function QuickAction({ href, label, icon }: { href: string; label: string; icon: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3 transition hover:border-brand-200 hover:bg-brand-50/50"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
        {icon}
      </span>
      <span className="text-sm font-medium text-slate-700">{label}</span>
    </Link>
  );
}

function InfoMetric({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <div className="flex items-center gap-1.5">
        {icon && <span className="text-slate-400">{icon}</span>}
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-400">{label}</p>
      </div>
      <p className="mt-2 text-sm font-medium text-slate-800">{value}</p>
    </div>
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
