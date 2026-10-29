import Link from "next/link";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { DashboardPanel, DashboardStatGroup, DashboardTrend } from "@/components/DashboardCard";
import MobilePageHeader from "@/components/mobile/MobilePageHeader";
import { axisLabels, bucketDailyCounts } from "@/lib/dashboard-metrics";
import { timeAgo } from "@/lib/time-ago";
import AdminSmsTest from "@/components/AdminSmsTest";
import { getCurrentUser } from "@/lib/auth";
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
  MessageSquareText,
} from "lucide-react";

/** Window for the request-volume chart. */
const TREND_DAYS = 7;

export default async function SuperAdminDashboard() {
  const supabase = createServiceRoleClient();
  const admin = await getCurrentUser();

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
  const { count: activeAccounts } = await supabase
    .from("users")
    .select("*", { count: "exact", head: true })
    .eq("status", "active");

  const { data: confirmedPayments } = await supabase
    .from("payments")
    .select("amount")
    .eq("status", "confirmed");
  const totalRevenue = (confirmedPayments ?? []).reduce((sum, p) => sum + (p.amount ?? 0), 0);

  // Real request volume: every request whose `created_at` falls in the window,
  // bucketed by day. This replaced a hardcoded `[30, 44, 39, 56, 48, 63, 72]`
  // with invented "May 1 … May 28" labels — a chart that no deployment could
  // make true, sitting on the screen an administrator reads as platform metrics.
  const windowStart = new Date();
  windowStart.setHours(0, 0, 0, 0);
  windowStart.setDate(windowStart.getDate() - (TREND_DAYS - 1));

  const { data: windowRequests } = await supabase
    .from("service_requests")
    .select("created_at")
    .gte("created_at", windowStart.toISOString());

  const requestBuckets = bucketDailyCounts(
    (windowRequests ?? []).map((row) => row.created_at),
    TREND_DAYS
  );
  const requestTrend = requestBuckets.map((bucket) => bucket.count);
  const requestsInWindow = requestTrend.reduce((sum, count) => sum + count, 0);

  const { data: settingRows } = await supabase.from("system_settings").select("key, value");
  const settings = new Map((settingRows ?? []).map((row) => [row.key, String(row.value ?? "")]));
  const settingOf = (key: string, fallback: string) => settings.get(key)?.trim() || fallback;

  const maintenanceOn = settingOf("maintenance_mode", "false") === "true";
  const offerTtlMinutes = settingOf("queue_offer_ttl_minutes", "15");
  const serviceTimezone = settingOf("queue_service_timezone", "Asia/Manila");
  const declineCostsTurn = settingOf("queue_decline_consumes_turn", "false") === "true";
  const queueModelVersion = settingOf("queue_model_version", "not set");

  const { data: recentActivity } = await supabase
    .from("service_requests")
    .select("id, appliance_type, location, created_at, status")
    .order("created_at", { ascending: false })
    .limit(5);

  return (
    <div className="space-y-4 md:space-y-6">
      <MobilePageHeader
        eyebrow="Super Admin"
        title="System Overview"
        subtitle="Platform-wide counts, recent activity, and the live configuration the queue runs on."
        action={{ href: "/superadmin/admins", label: "Manage Administrators" }}
      />

      {/* Six tiles: a 2x2 grid on a phone rather than six stacked, and six
          columns from `xl` up — see `DashboardStatGroup`. */}
      <DashboardStatGroup
        desktopColumns={6}
        items={[
          { label: "Total Users", value: totalUsers ?? 0, href: "/admin/users", icon: Users, colorClass: "bg-brand-soft text-brand-ink" },
          { label: "Active Accounts", value: activeAccounts ?? 0, href: "/admin/users", icon: ShieldCheck, colorClass: "bg-signal-soft text-signal-ink" },
          { label: "Administrators", value: totalAdmins ?? 0, href: "/superadmin/admins", icon: Building2, colorClass: "bg-brand-soft text-brand-ink" },
          { label: "Technicians", value: totalTechnicians ?? 0, href: "/admin/technicians", icon: BriefcaseBusiness, colorClass: "bg-brand-soft text-brand-ink" },
          { label: "Customers", value: totalCustomers ?? 0, href: "/admin/users", icon: Users, colorClass: "bg-brand-soft text-brand-ink" },
          { label: "Confirmed Revenue", value: `₱${totalRevenue.toFixed(0)}`, href: "/admin/payments", icon: TrendingUp, colorClass: "bg-warn-soft text-warn-ink" },
        ]}
      />

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <DashboardPanel
          title="Request Volume"
          description={`New repair requests per day, last ${TREND_DAYS} days`}
          bodyClassName="px-5 pb-5"
        >
          <div className="mt-4">
            <DashboardTrend
              values={requestTrend}
              caption={`New repair requests per day over the last ${TREND_DAYS} days: ${requestTrend.join(", ")}. Total ${requestsInWindow}.`}
            />
            <div className="mt-3 flex justify-between text-[10px] text-muted/80">
              {axisLabels(requestBuckets).map((label) => (
                <span key={label}>{label}</span>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted">
              {requestsInWindow === 0
                ? "No requests were filed in this period."
                : `${requestsInWindow} request${requestsInWindow === 1 ? "" : "s"} in this period.`}
            </p>
          </div>
        </DashboardPanel>

        {/* This panel used to read "Server status: Online / Database: Normal /
            Storage: 60%" — three invented readings rendered with a green success
            chip, none of which the application can actually observe. It now
            shows values that are read from `system_settings`, so every line is
            something the platform genuinely knows. */}
        <DashboardPanel
          title="Platform Configuration"
          description="Live values from system settings"
          bodyClassName="px-5 pb-5"
        >
          <div className="mt-4 space-y-3">
            <ConfigLine
              label="Maintenance mode"
              value={maintenanceOn ? "On" : "Off"}
              tone={maintenanceOn ? "danger" : "success"}
            />
            <ConfigLine label="Offer window" value={`${offerTtlMinutes} min`} />
            <ConfigLine label="Service timezone" value={serviceTimezone} />
            <ConfigLine
              label="Declining costs a turn"
              value={declineCostsTurn ? "Yes" : "No"}
              tone={declineCostsTurn ? "warn" : "success"}
            />
            <ConfigLine label="Queue model" value={queueModelVersion} />
          </div>
          <Link
            href="/superadmin/settings"
            className="mt-4 inline-flex items-center gap-1.5 text-xs font-semibold text-brand-ink hover:text-brand-ink/80"
          >
            Edit settings
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </DashboardPanel>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <DashboardPanel title="Recent Requests" bodyClassName="px-5 pb-5">
          {!recentActivity?.length ? (
            <p className="mt-4 text-sm text-muted">No requests have been filed yet.</p>
          ) : (
            <ul className="mt-4 space-y-3">
              {recentActivity.map((request) => {
                const statusIcon =
                  request.status === "completed" ? (
                    <CheckCircle2 className="h-4 w-4 text-signal-ink" />
                  ) : request.status === "cancelled" ? (
                    <XCircle className="h-4 w-4 text-alert-ink" />
                  ) : (
                    <AlertCircle className="h-4 w-4 text-brand-ink" />
                  );
                return (
                  <li key={request.id} className="flex items-start gap-3 border-b border-line pb-3 last:border-b-0 last:pb-0">
                    <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-ink">
                      {statusIcon}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium capitalize text-ink/90">
                        {request.appliance_type.replace(/_/g, " ")}
                      </p>
                      <p className="mt-0.5 truncate text-xs text-muted">
                        {request.location ? `Location: ${request.location}` : "No location recorded"}
                      </p>
                      <p className="mt-1 text-[11px] text-muted/80">{timeAgo(request.created_at)}</p>
                    </div>
                    <Link
                      href={`/admin/job-monitoring`}
                      className="shrink-0 text-[11px] font-semibold text-brand-ink hover:text-brand-ink/80"
                    >
                      Monitor
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </DashboardPanel>

        <div className="space-y-6">
          <DashboardPanel title="Account Management" bodyClassName="px-5 pb-5">
            <div className="mt-4 space-y-3">
              <div className="flex items-start gap-3 rounded-2xl border border-line bg-soft p-3">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-ink" />
                <div>
                  <p className="text-sm font-semibold text-ink/90">Active / Inactive status</p>
                  <p className="mt-1 text-xs text-muted">
                    Use status-based account controls rather than permanent removal.
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-2xl border border-line bg-brand-soft p-3">
                  <p className="text-xs text-muted">Active accounts</p>
                  <p className="font-display text-lg font-semibold text-brand-ink">{activeAccounts ?? 0}</p>
                </div>
                <div className="rounded-2xl border border-line bg-soft p-3">
                  <p className="text-xs text-muted">Total bookings</p>
                  <p className="font-display text-lg font-semibold text-ink">{totalBookings ?? 0}</p>
                </div>
              </div>
            </div>
          </DashboardPanel>

          <DashboardPanel title="Quick Actions" bodyClassName="px-5 pb-5">
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <QuickAction href="/superadmin/admins" label="Manage Admins" icon={<Building2 className="h-4 w-4" />} />
              <QuickAction href="/admin/users" label="User Activity" icon={<Users className="h-4 w-4" />} />
              <QuickAction href="/superadmin/settings" label="System Settings" icon={<ShieldCheck className="h-4 w-4" />} />
              <QuickAction href="/admin/support-tickets" label="Support Tickets" icon={<CircleAlert className="h-4 w-4" />} />
            </div>
          </DashboardPanel>
        </div>
      </div>

      <DashboardPanel
        title="SMS notifications"
        icon={MessageSquareText}
        description="Verify your Semaphore SMS integration — sends a test message to the phone number saved on your own account."
      >
        <AdminSmsTest phone={admin?.phone ?? null} />
      </DashboardPanel>

      <DashboardPanel
        title="Administration Tools"
        bodyClassName="px-5 pb-5"
        action={
          <Link href="/superadmin/settings" className="inline-flex items-center gap-1 text-sm font-semibold text-brand-ink hover:text-brand-ink/80">
            Open settings <ArrowRight className="h-4 w-4" />
          </Link>
        }
      >
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <ToolCard
            href="/superadmin/admins"
            title="Administrator Management"
            body="Review admin accounts and manage who holds an elevated role."
          />
          <ToolCard
            href="/admin/users"
            title="User Activity"
            body="Monitor roles, account statuses, and who is using the platform."
          />
          <ToolCard
            href="/superadmin/settings"
            title="System Configuration"
            body="Maintain maintenance mode, announcements, and queue settings."
          />
        </div>
      </DashboardPanel>
    </div>
  );
}

type ConfigTone = "neutral" | "success" | "warn" | "danger";

const CONFIG_TONE_CLASS: Record<ConfigTone, string> = {
  neutral: "bg-soft text-muted",
  success: "bg-signal-soft text-signal-ink",
  warn: "bg-warn-soft text-warn-ink",
  danger: "bg-alert-soft text-alert-ink",
};

/** One read-only configuration value, with a tone that states whether it needs attention. */
function ConfigLine({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: ConfigTone;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-4 py-3">
      <span className="text-sm text-muted">{label}</span>
      <span className={`shrink-0 rounded-full px-3 py-1 text-[10px] font-semibold ${CONFIG_TONE_CLASS[tone]}`}>
        {value}
      </span>
    </div>
  );
}

function QuickAction({ href, label, icon }: { href: string; label: string; icon: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3 transition hover:border-brand-300 hover:bg-brand-soft/50"
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand-ink">{icon}</span>
      <span className="truncate text-sm font-medium text-ink/80">{label}</span>
    </Link>
  );
}

function ToolCard({ href, title, body }: { href: string; title: string; body: string }) {
  return (
    <Link
      href={href}
      className="group flex flex-col rounded-2xl border border-line bg-soft p-5 transition hover:border-brand-300 hover:bg-surface"
    >
      <p className="font-display text-sm font-semibold text-ink group-hover:text-brand-ink">{title}</p>
      <p className="mt-2 text-xs leading-6 text-muted">{body}</p>
      <ArrowRight className="mt-4 h-4 w-4 text-muted/80 transition group-hover:translate-x-1 group-hover:text-brand-ink" />
    </Link>
  );
}
