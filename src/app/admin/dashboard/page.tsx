import Link from "next/link";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { getTechnicianQueue } from "@/lib/assignment";
import { buildApplianceQueues, type ApplianceQueue } from "@/lib/queue";
import StatusBadge from "@/components/StatusBadge";
import { DashboardPanel, DashboardStatGroup, DashboardTrend } from "@/components/DashboardCard";
import MobilePageHeader from "@/components/mobile/MobilePageHeader";
import { getCurrentUser } from "@/lib/auth";
import { timeAgo } from "@/lib/time-ago";
import {
  BriefcaseBusiness,
  CalendarClock,
  CircleAlert,
  ShieldCheck,
  Users,
  Wrench,
  CheckCircle2,
  XCircle,
  AlertCircle,
  CircleDollarSign,
  TrendingUp,
} from "lucide-react";

const ACTIVE_BOOKING_STATUSES = [
  "pending",
  "in_progress",
  "awaiting_inspection",
  // The repair is done but the transaction is not: it still needs the customer's
  // payment reference and an administrator's verification, so it stays "active"
  // until then rather than dropping out of the monitor.
  "awaiting_payment",
];

export default async function AdminDashboard() {
  // Counts and joins go through the service role; the rotation is read with the
  // administrator's own JWT, because `technician_queue_snapshot()` authorises on
  // `is_admin()` and a service-role client carries no `auth.uid()`.
  const supabase = createServiceRoleClient();
  const userClient = createClient();
  await getCurrentUser();

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

  const bookingTechnicianIds = Array.from(
    new Set((activeBookings ?? []).map((booking) => booking.technician_id))
  );
  const { data: bookingTechnicians } = bookingTechnicianIds.length
    ? await supabase.from("users").select("id, name").in("id", bookingTechnicianIds)
    : { data: [] };
  const technicianNameById = new Map(
    (bookingTechnicians ?? []).map((technician) => [technician.id, technician.name])
  );

  // The real rotation, read through the same RPC the dedicated monitoring page
  // uses. This panel previously fetched `technician_queue_state` with the
  // service-role key, sorted it by `last_assigned_at` in React, derived a
  // position from it, and split technicians into "Available" / "Booked" — the
  // exact implementation `ARCHITECTURE.md` rule 1 forbids and that
  // `/admin/technician-queue` documents itself as having replaced. Being a
  // second, differently-computed answer to "who is next", it could disagree
  // with the engine, and it treated a future appointment as unavailability.
  let queues: ApplianceQueue[] = [];
  let queueUnavailable = false;
  try {
    queues = buildApplianceQueues(await getTechnicianQueue(userClient));
  } catch {
    // Telemetry only: never take the dashboard down over it.
    queueUnavailable = true;
  }
  const rotationSize = queues.reduce((total, queue) => total + queue.activeTechnicianCount, 0);
  const queuesWithMembers = queues.filter((queue) => queue.activeTechnicianCount > 0);

  const { data: recentActivity } = await supabase
    .from("service_requests")
    .select("id, appliance_type, location, created_at, status")
    .order("created_at", { ascending: false })
    .limit(5);

  const trendEnd = new Date();
  const trendStart = new Date(trendEnd);
  trendStart.setUTCHours(0, 0, 0, 0);
  trendStart.setUTCDate(trendStart.getUTCDate() - 6);
  const { data: requestTrendRows } = await supabase
    .from("service_requests")
    .select("created_at")
    .gte("created_at", trendStart.toISOString())
    .lte("created_at", trendEnd.toISOString());
  const requestsPerDay = Array.from({ length: 7 }, () => 0);
  for (const request of requestTrendRows ?? []) {
    const dayIndex = Math.floor(
      (new Date(request.created_at).getTime() - trendStart.getTime()) / 86_400_000
    );
    if (dayIndex >= 0 && dayIndex < requestsPerDay.length) requestsPerDay[dayIndex] += 1;
  }

  const { count: openRequests } = await supabase
    .from("service_requests")
    .select("*", { count: "exact", head: true })
    .eq("status", "open");

  const { count: supportTickets } = await supabase
    .from("support_tickets")
    .select("*", { count: "exact", head: true })
    .eq("status", "open");

  /**
   * Payments a customer has submitted that no administrator has verified yet.
   *
   * This is the one queue on the platform where a customer is actively waiting on
   * staff, so it belongs in the dashboard's priority list — the tile row counted
   * approvals, requests and tickets, but nothing told an administrator that money
   * had arrived and was sitting unverified.
   */
  const { count: pendingPaymentVerifications } = await supabase
    .from("payments")
    .select("*", { count: "exact", head: true })
    .eq("status", "pending_verification");

  return (
    <div className="space-y-4 md:space-y-5">
      <MobilePageHeader
        eyebrow="Admin workspace"
        title="Operations overview"
        subtitle="Technicians, live jobs, the rotation, and anything waiting on you."
        action={{ href: "/admin/technicians", label: "Review pending technicians" }}
      />

      {/* Six tiles: a 2x2 grid on a phone, six columns from `xl` up — see
          `DashboardStatGroup`. */}
      <DashboardStatGroup
        desktopColumns={6}
        items={[
          { label: "Approved technicians", value: technicianCount ?? 0, href: "/admin/technicians", icon: Users, colorClass: "bg-brand-soft text-brand-ink" },
          { label: "Active jobs", value: activeRepairs ?? 0, href: "/admin/job-monitoring", icon: Wrench, colorClass: "bg-brand-soft text-brand-ink" },
          // Was `bg-yellow-50 text-yellow-600` — raw Tailwind palette values rather
          // than theme tokens, so the chip stayed a bright near-white pill on the
          // dark canvas while every other card on the row inverted.
          { label: "Pending approvals", value: pendingApprovals ?? 0, href: "/admin/technicians", icon: ShieldCheck, colorClass: "bg-warn-soft text-warn-ink" },
          // Money that has arrived and is waiting on a human. Kept beside the
          // approval tile because both are people waiting on staff.
          { label: "Pending payments", value: pendingPaymentVerifications ?? 0, href: "/admin/payments", icon: CircleDollarSign, colorClass: "bg-accent-soft text-accent-ink" },
          { label: "Open requests", value: openRequests ?? 0, href: "/admin/technician-queue", icon: BriefcaseBusiness, colorClass: "bg-brand-soft text-brand-ink" },
          { label: "Support tickets", value: supportTickets ?? 0, href: "/admin/support-tickets", icon: CircleAlert, colorClass: "bg-alert-soft text-alert-ink" },
        ]}
      />

      <div className="grid items-stretch gap-4 md:grid-cols-2 xl:auto-rows-fr xl:gap-5">
        <DashboardPanel
          title="Active bookings"
          icon={CalendarClock}
          description={
            activeBookings?.length
              ? `${activeBookings.length} job${activeBookings.length === 1 ? "" : "s"} in progress or scheduled`
              : undefined
          }
          className="h-full min-h-[320px]"
        >
          {!activeBookings?.length ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-full bg-soft text-muted/80">
                <CalendarClock className="h-6 w-6" />
              </div>
              <p className="mt-4 text-sm font-medium text-muted">No active bookings right now</p>
              <p className="mt-1 text-xs text-muted/80">Active jobs appear here once scheduled.</p>
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
                      <p className="truncate font-display text-sm font-semibold capitalize text-ink">
                        {request?.appliance_type?.replace(/_/g, " ") ?? "Repair"}
                      </p>
                      <p className="mt-1 truncate text-xs text-muted">
                        {technicianNameById.get(booking.technician_id) ?? "Unassigned technician"} ·{" "}
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
        <DashboardPanel title="Recent requests" icon={BriefcaseBusiness} className="h-full min-h-[320px]">
          {!recentActivity?.length ? (
            <p className="text-sm text-muted">No requests have been filed yet.</p>
          ) : (
            <ul className="space-y-3">
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
                  </li>
                );
              })}
            </ul>
          )}
        </DashboardPanel>
        <DashboardPanel
          title="Rotation summary"
          icon={CalendarClock}
          className="h-full min-h-[320px]"
          description="Positions from the assignment engine"
          action={
            <Link
              href="/admin/technician-queue"
              className="text-xs font-semibold text-brand-ink hover:underline"
            >
              Open queue monitor
            </Link>
          }
        >
          {queueUnavailable ? (
            <p className="rounded-lg border border-line bg-warn-soft px-3 py-4 text-xs text-warn-ink">
              The rotation could not be read right now. Open the queue monitor for the full view.
            </p>
          ) : !queuesWithMembers.length ? (
            <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-xs text-muted">
              No technician is in a rotation yet. A queue is populated once an approved technician
              holds that appliance as a specialisation.
            </p>
          ) : (
            <div className="space-y-4">
              <p className="text-xs text-muted">
                {queuesWithMembers.length} active queue
                {queuesWithMembers.length === 1 ? "" : "s"} · {rotationSize} membership
                {rotationSize === 1 ? "" : "s"} in rotation
              </p>
              {queuesWithMembers.slice(0, 3).map((queue) => {
                const active = queue.entries.filter((entry) => entry.isMemberActive);
                const next = active[0] ?? null;
                return (
                  <div key={queue.applianceType} className="rounded-2xl border border-line bg-surface p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="font-display text-sm font-semibold capitalize text-ink">
                        {queue.label}
                      </h3>
                      <span className="rounded-full bg-soft px-2.5 py-1 text-[10px] font-semibold text-muted">
                        {queue.activeTechnicianCount} in rotation
                      </span>
                    </div>
                    <p className="mt-2 text-xs text-muted">
                      {next ? (
                        <>
                          Next turn: <span className="font-semibold text-ink">{next.name}</span>
                          {next.isSelf ? " (you)" : ""}
                        </>
                      ) : (
                        "Nobody is currently in rotation."
                      )}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </DashboardPanel>
        <DashboardPanel
          title="Requests by day"
          icon={TrendingUp}
          description="Service requests submitted over the last 7 days"
          className="h-full min-h-[320px]"
        >
          <div className="space-y-3">
            <p className="text-sm font-semibold text-ink">
              {requestsPerDay.reduce((total, count) => total + count, 0)} total requests
            </p>
            <DashboardTrend
              values={requestsPerDay}
              caption="Service requests submitted per day over the last 7 days"
              accentClassName="text-[#81EDF4]"
              heightClass="h-40 sm:h-48"
            />
            <div className="flex justify-between text-[10px] text-muted">
              <span>{trendStart.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}</span>
              <span>Today</span>
            </div>
          </div>
        </DashboardPanel>
      </div>
    </div>
  );
}
