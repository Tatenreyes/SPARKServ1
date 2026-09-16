import Link from "next/link";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { DashboardPanel, DashboardStatCard, DashboardTrend } from "@/components/DashboardCard";
import {
  ArrowRight,
  BriefcaseBusiness,
  Building2,
  ShieldCheck,
  TrendingUp,
  Users,
  CircleAlert,
  CheckCircle2,
  XCircle,
  AlertCircle,
} from "lucide-react";

export default async function SuperAdminDashboard() {
  const supabase = createServiceRoleClient();

  const { count: totalUsers } = await supabase
    .from("users")
    .select("*", { count: "exact", head: true });
  const { count: totalAdmins } = await supabase
    .from("users")
    .select("*", { count: "exact", head: true })
    .in("role", ["admin", "super_admin"]);
  const { count: totalTechnicians } = await supabase
    .from("users")
    .select("*", { count: "exact", head: true })
    .eq("role", "technician");
  const { count: totalCustomers } = await supabase
    .from("users")
    .select("*", { count: "exact", head: true })
    .eq("role", "customer");
  const { count: totalBookings } = await supabase
    .from("bookings")
    .select("*", { count: "exact", head: true });

  const { data: confirmedPayments } = await supabase
    .from("payments")
    .select("amount")
    .eq("status", "confirmed");
  const totalRevenue = (confirmedPayments ?? []).reduce((s, p) => s + p.amount, 0);

  const { data: recentActivity } = await supabase
    .from("service_requests")
    .select("id, appliance_type, location, created_at, status")
    .order("created_at", { ascending: false })
    .limit(5);

  const { count: activeAccounts } = await supabase
    .from("users")
    .select("*", { count: "exact", head: true })
    .eq("status", "active");

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-600">Super Admin</p>
          <h1 className="mt-2 font-display text-3xl font-bold text-ink">Full System Control</h1>
          <p className="mt-1.5 text-sm text-slate-500">
            Platform-wide performance, users, and system oversight.
          </p>
        </div>
        <Link href="/superadmin/admins" className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 hover:shadow-md">
          Manage Administrators
          <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-6">
        <DashboardStatCard label="Total Users" value={totalUsers ?? 0} hint="All accounts" href="/admin/users" icon={Users} />
        <DashboardStatCard label="Active Accounts" value={activeAccounts ?? 0} hint="Live users" href="/admin/users" icon={ShieldCheck} />
        <DashboardStatCard label="Administrators" value={totalAdmins ?? 0} hint="Platform admins" href="/superadmin/admins" icon={Building2} />
        <DashboardStatCard label="Technicians" value={totalTechnicians ?? 0} hint="Service providers" href="/admin/technicians" icon={BriefcaseBusiness} />
        <DashboardStatCard label="Customers" value={totalCustomers ?? 0} hint="Registered users" href="/admin/users" icon={Users} />
        <DashboardStatCard label="Revenue" value={`₱${totalRevenue.toFixed(0)}`} hint="Confirmed payments" href="/superadmin/settings" icon={TrendingUp} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <DashboardPanel title="Platform Overview">
          <div className="mt-4">
            <DashboardTrend values={[30, 44, 39, 56, 48, 63, 72]} color="#E42F47" fill="rgba(228, 47, 71, 0.12)" />
            <div className="mt-3 flex justify-between text-[10px] text-slate-400">
              <span>May 1</span>
              <span>May 7</span>
              <span>May 14</span>
              <span>May 28</span>
            </div>
          </div>
        </DashboardPanel>

        <DashboardPanel title="System Health">
          <div className="space-y-3 pt-1">
            <HealthLine label="Server status" value="Online" />
            <HealthLine label="Database" value="Normal" />
            <HealthLine label="Storage" value="60%" />
          </div>
        </DashboardPanel>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <DashboardPanel title="Platform Activity">
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
                      <p className="mt-0.5 text-xs text-slate-500">Repair in {r.location}</p>
                      <p className="mt-1 text-[11px] text-slate-400">{timeAgo(r.created_at)}</p>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </DashboardPanel>

        <div className="space-y-6">
          <DashboardPanel title="Account Management">
            <div className="space-y-3">
              <div className="flex items-start gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
                <div>
                  <p className="text-sm font-semibold text-slate-800">Active / Inactive status</p>
                  <p className="mt-1 text-xs text-slate-500">Use status-based account controls rather than permanent removal.</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-brand-100 bg-brand-50 p-3">
                  <p className="text-xs text-slate-500">Active accounts</p>
                  <p className="font-display text-lg font-semibold text-brand-700">{activeAccounts ?? 0}</p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                  <p className="text-xs text-slate-500">Total bookings</p>
                  <p className="font-display text-lg font-semibold text-slate-900">{totalBookings ?? 0}</p>
                </div>
              </div>
            </div>
          </DashboardPanel>

          <DashboardPanel title="Quick Actions">
            <div className="grid gap-3 sm:grid-cols-2">
              <QuickAction href="/superadmin/admins" label="Manage Admins" icon={<Building2 className="h-4 w-4" />} />
              <QuickAction href="/admin/users" label="User Activity" icon={<Users className="h-4 w-4" />} />
              <QuickAction href="/superadmin/settings" label="System Settings" icon={<ShieldCheck className="h-4 w-4" />} />
              <QuickAction href="/admin/support-tickets" label="Support Tickets" icon={<CircleAlert className="h-4 w-4" />} />
            </div>
          </DashboardPanel>
        </div>
      </div>

      <DashboardPanel title="System Settings & Admin Tools" action={
        <Link href="/superadmin/settings" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-600 hover:text-brand-700">
          Open settings <ArrowRight className="h-4 w-4" />
        </Link>
      }>
        <div className="grid gap-4 sm:grid-cols-3">
          <Link href="/superadmin/admins" className="group flex flex-col rounded-2xl border border-slate-200 bg-slate-50 p-5 transition hover:border-brand-200 hover:bg-white">
            <p className="font-display text-sm font-semibold text-slate-900 group-hover:text-brand-700">Administrator Management</p>
            <p className="mt-2 text-xs text-slate-500">Review available admin accounts and roles.</p>
            <ArrowRight className="mt-4 h-4 w-4 text-slate-400 transition group-hover:translate-x-1 group-hover:text-brand-600" />
          </Link>
          <Link href="/admin/users" className="group flex flex-col rounded-2xl border border-slate-200 bg-slate-50 p-5 transition hover:border-brand-200 hover:bg-white">
            <p className="font-display text-sm font-semibold text-slate-900 group-hover:text-brand-700">User Activity</p>
            <p className="mt-2 text-xs text-slate-500">Monitor roles, statuses, and account activity.</p>
            <ArrowRight className="mt-4 h-4 w-4 text-slate-400 transition group-hover:translate-x-1 group-hover:text-brand-600" />
          </Link>
          <Link href="/superadmin/settings" className="group flex flex-col rounded-2xl border border-slate-200 bg-slate-50 p-5 transition hover:border-brand-200 hover:bg-white">
            <p className="font-display text-sm font-semibold text-slate-900 group-hover:text-brand-700">System Configuration</p>
            <p className="mt-2 text-xs text-slate-500">Maintain platform settings, modes, and controls.</p>
            <ArrowRight className="mt-4 h-4 w-4 text-slate-400 transition group-hover:translate-x-1 group-hover:text-brand-600" />
          </Link>
        </div>
      </DashboardPanel>
    </div>
  );
}

function HealthLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3">
      <span className="text-sm text-slate-600">{label}</span>
      <span className="rounded-full bg-signal-50 px-3 py-1 text-[10px] font-semibold text-signal-600">{value}</span>
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

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
