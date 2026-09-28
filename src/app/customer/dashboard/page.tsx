import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { DashboardStatCard, DashboardPanel } from "@/components/DashboardCard";
import DashboardHero from "@/components/DashboardHero";
import { RecentRepairTable } from "@/components/RecentRepairTable";
import { NotificationsPanel } from "@/components/NotificationsPanel";
import { ServiceTracking } from "@/components/ServiceTracking";
import { QuickActions } from "@/components/QuickActions";
import SupportBanner from "@/components/SupportBanner";
import {
  Bell,
  CalendarCheck2,
  ClipboardList,
  DollarSign,
  HelpCircle,
  Plus,
  Wrench,
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

  const activeRequests = (requests ?? []).filter(
    (r) => r.status !== "completed" && r.status !== "cancelled"
  );

  const { data: announcementSetting } = await supabase
    .from("system_settings")
    .select("value")
    .eq("key", "platform_announcement")
    .maybeSingle();

  const upcomingBookings = (bookings ?? []).filter(
    (b) => b.status !== "completed" && b.status !== "cancelled"
  );

  const pendingEstimates = (requests ?? []).filter((r) => r.status === "quoted").length;

  // Real count of payments still awaiting admin verification — this used to
  // count service requests, which meant the number never matched the label.
  const { data: pendingPaymentRows } = await supabase
    .from("payments")
    .select("id")
    .eq("customer_id", user!.id)
    .eq("status", "pending_verification");

  const pendingPayments = pendingPaymentRows?.length ?? 0;

  // Estimates for this customer's own requests, newest first, so the tracking
  // strip can resolve its estimate/approval steps without a query per request.
  const requestIds = (requests ?? []).map((request) => request.id);
  const { data: estimates } = requestIds.length
    ? await supabase
        .from("estimates")
        .select("*")
        .in("service_request_id", requestIds)
        .order("created_at", { ascending: false })
    : { data: [] };

  // The request the tracking strip follows: the newest still-open one, falling
  // back to the most recent request so a customer whose jobs are all finished
  // sees their last one rather than an empty state.
  const trackedRequest = activeRequests[0] ?? requests?.[0] ?? null;
  const trackedBookings = trackedRequest
    ? (bookings ?? [])
        .filter((booking) => booking.service_request_id === trackedRequest.id)
        // `bookings` is fetched ascending by scheduled_at; the tracking strip
        // expects newest first so it resolves the live booking, not the oldest.
        .reverse()
    : [];
  const trackedEstimates = trackedRequest
    ? (estimates ?? []).filter(
        (estimate) => estimate.service_request_id === trackedRequest.id
      )
    : [];

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const { data: notifications } = await supabase
    .from("notifications")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(5);

  return (
    <div className="space-y-6">
      <DashboardHero
        eyebrow="Customer workspace"
        title={`${greeting}, ${user?.name?.split(" ")[0] ?? "there"}`}
        subtitle="Track every appliance repair, review estimates and keep upcoming visits in one place."
        stats={[
          { label: "Active repairs", value: activeRequests.length },
          { label: "Upcoming visits", value: upcomingBookings.length },
          { label: "Awaiting payment", value: pendingPayments },
        ]}
        actions={
          <>
            {/* Orange is reserved for the single most important action on the
                screen — see the `accent` token comment in tailwind.config.ts. */}
            <Link
              href="/customer/request-repair"
              className="inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-accent-500 px-5 text-sm font-semibold text-white shadow-sm transition duration-200 hover:bg-accent-600"
            >
              <Plus className="h-4 w-4" />
              Start service inquiry
            </Link>
            <Link
              href="/customer/progress-tracking"
              className="inline-flex h-11 cursor-pointer items-center justify-center rounded-xl border border-line bg-surface/80 px-5 text-sm font-semibold text-brand-ink transition duration-200 hover:bg-surface"
            >
              Track repairs
            </Link>
          </>
        }
      />

      {announcementSetting?.value && (
        <div className="flex items-start gap-3 rounded-card border border-line bg-brand-soft px-4 py-3.5">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-brand-ink">
            <Bell className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            {/* Was `text-brand-ink`, a shade that doesn't exist in
                tailwind.config.ts — the class was dropped and this heading
                rendered at inherited colour. */}
            <p className="text-sm font-semibold text-brand-800">Platform announcement</p>
            <p className="mt-0.5 text-sm leading-relaxed text-brand-ink">
              {announcementSetting.value}
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <DashboardStatCard
          label="Active repairs"
          value={activeRequests.length}
          href="/customer/service-request"
          icon={Wrench}
          colorClass="bg-brand-soft text-brand-ink"
          hint="View requests"
        />
        <DashboardStatCard
          label="Pending estimates"
          value={pendingEstimates}
          href="/customer/estimates"
          icon={ClipboardList}
          colorClass="bg-warn-soft text-warn-ink"
          hint={pendingEstimates > 0 ? "Review and approve" : "All reviewed"}
        />
        <DashboardStatCard
          label="Upcoming visits"
          value={upcomingBookings.length}
          href="/customer/bookings"
          icon={CalendarCheck2}
          colorClass="bg-brand-soft text-brand-ink"
          hint="See schedule"
        />
        <DashboardStatCard
          label="Awaiting payment"
          value={pendingPayments}
          href="/customer/bookings"
          icon={DollarSign}
          colorClass="bg-accent-soft text-accent-ink"
          hint={pendingPayments > 0 ? "Settle balance" : "Nothing due"}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          <DashboardPanel
            title="Service tracking"
            icon={Wrench}
            action={
              <Link
                href="/customer/progress-tracking"
                className="text-xs font-semibold text-brand-ink hover:underline"
              >
                View all
              </Link>
            }
          >
            {/* Bound to the real request/booking/estimate rows — this strip used
                to be a hardcoded bar with a fixed caption. */}
            <ServiceTracking
              request={trackedRequest}
              bookings={trackedBookings}
              estimates={trackedEstimates}
            />
          </DashboardPanel>

          <DashboardPanel
            title="Recent repair requests"
            icon={ClipboardList}
            action={
              <Link
                href="/customer/repair-history"
                className="text-xs font-semibold text-brand-ink hover:underline"
              >
                View all
              </Link>
            }
            bodyClassName="px-5 pb-5"
          >
            <RecentRepairTable requests={requests ?? []} />
          </DashboardPanel>

          <SupportBanner
            icon={HelpCircle}
            title="Need a hand?"
            body="Our support team is available around the clock for anything about your requests, estimates or bookings."
            href="/customer/support"
            ctaLabel="Contact support"
          />
        </div>

        <div className="space-y-6">
          <DashboardPanel
            title="Notifications"
            icon={Bell}
            action={
              <Link
                href="/customer/messages"
                className="text-xs font-semibold text-brand-ink hover:underline"
              >
                View all
              </Link>
            }
          >
            <NotificationsPanel notifications={notifications ?? []} />
          </DashboardPanel>

          <DashboardPanel title="Quick actions" bodyClassName="px-5 pb-5">
            <QuickActions />
          </DashboardPanel>
        </div>
      </div>
    </div>
  );
}
