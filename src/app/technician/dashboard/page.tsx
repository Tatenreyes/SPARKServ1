import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getTechnicianQueue } from "@/lib/assignment";
import { buildApplianceQueues, type ApplianceQueue } from "@/lib/queue";
import { DashboardPanel, DashboardStatCard } from "@/components/DashboardCard";
import DashboardHero from "@/components/DashboardHero";
import QueueCard from "@/components/QueueCard";
import ScheduleTimeline, { type ScheduleItem } from "@/components/ScheduleTimeline";
import SupportBanner from "@/components/SupportBanner";
import StatusBadge from "@/components/StatusBadge";
import {
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  Headset,
  ListOrdered,
  MessageSquareText,
  UserCircle2,
  Wrench,
} from "lucide-react";

export default async function TechnicianDashboard() {
  const user = await getCurrentUser();
  const supabase = createClient();

  const { data: pendingOffers } = await supabase
    .from("service_requests")
    .select("*")
    .eq("assigned_technician_id", user!.id)
    .eq("assignment_status", "offered")
    .order("created_at", { ascending: false });

  const { count: activeJobs } = await supabase
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

  const { count: upcomingSchedules } = await supabase
    .from("bookings")
    .select("*", { count: "exact", head: true })
    .eq("technician_id", user!.id)
    .in("status", ["pending", "confirmed"])
    .gte("scheduled_at", todayStart.toISOString());

  const { data: todayBookings } = await supabase
    .from("bookings")
    .select("id, service_request_id, scheduled_at, status")
    .eq("technician_id", user!.id)
    .in("status", ["pending", "in_progress", "confirmed"])
    .gte("scheduled_at", todayStart.toISOString())
    .order("scheduled_at", { ascending: true });

  const todayRequestIds = Array.from(
    new Set((todayBookings ?? []).map((b) => b.service_request_id))
  );
  const { data: todayRequests } = todayRequestIds.length
    ? await supabase
        .from("service_requests")
        .select("id, appliance_type, location, problem_description, status")
        .in("id", todayRequestIds)
    : { data: [] };
  const todayRequestMap = new Map((todayRequests ?? []).map((r) => [r.id, r]));

  // QUEUE MODEL v2 (see QUEUE-SYSTEM.md). The rotation is read from
  // technician_queue_snapshot(), which returns the WHOLE queue for every
  // appliance the signed-in technician belongs to — the other technicians
  // included, because a technician is entitled to see their real standing.
  //
  // Nothing below is re-sorted or re-derived in React any more. The old code
  // pulled technician_queue_state with the service-role key, sorted it by
  // last_assigned_at, and guessed a position from the technician's first
  // specialization. That guess was the bug: it only ever described one
  // appliance, it disagreed with the assignment engine, and a future booking
  // made a technician look unavailable.
  let myQueues: ApplianceQueue[] = [];
  let queueUnavailable = false;
  try {
    myQueues = buildApplianceQueues(await getTechnicianQueue(supabase));
  } catch {
    // Never take the dashboard down over queue telemetry; the queue page and
    // the offer list still work.
    queueUnavailable = true;
  }

  // Lead with the queue the technician actually holds a turn in.
  const primaryQueue = myQueues.find((queue) => queue.myPosition !== null) ?? myQueues[0] ?? null;

  const { data: recentRequests } = await supabase
    .from("service_requests")
    .select("id, appliance_type, location, problem_description, status, created_at")
    .eq("assigned_technician_id", user!.id)
    .order("created_at", { ascending: false })
    .limit(5);

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const scheduleItems: ScheduleItem[] = (todayBookings ?? []).slice(0, 6).map((booking) => {
    const request = todayRequestMap.get(booking.service_request_id);
    return {
      id: booking.id,
      scheduledAt: booking.scheduled_at,
      title: request?.appliance_type?.replace(/_/g, " ") ?? "Repair visit",
      meta: `#${booking.id.slice(0, 8)}${request?.location ? ` · ${request.location}` : ""}`,
      status: booking.status,
      href: "/technician/jobs",
    };
  });

  return (
    <div className="space-y-6">
      <DashboardHero
        eyebrow="Technician workspace"
        title={`${greeting}, ${user?.name?.split(" ")[0] ?? "there"}`}
        subtitle="Your offers, rotation position and today's visits, in one view."
        stats={[
          { label: "Pending offers", value: pendingOffers?.length ?? 0 },
          { label: "Active jobs", value: activeJobs ?? 0 },
          { label: "Upcoming", value: upcomingSchedules ?? 0 },
          { label: "Done today", value: completedToday ?? 0 },
        ]}
        image="/images/technician-washing-machine-hero.png"
        imageAlt="SPARKServ technician servicing a washing machine on site"
        priority
        actions={
          <Link
            href="/technician/estimate-requests"
            className="inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white shadow-sm transition duration-200 hover:bg-brand-700"
          >
            <BriefcaseBusiness className="h-4 w-4" />
            Review offers
          </Link>
        }
      />

      <DashboardPanel
        title="Assignment queue"
        icon={ListOrdered}
        description="Your standing in the rotation for each appliance you cover — a fair turn order, never rating or experience."
        bodyClassName="px-5 pb-5"
        action={
          <Link
            href="/technician/queue"
            className="inline-flex h-8 cursor-pointer items-center rounded-lg border border-line bg-surface px-3 text-[11px] font-semibold text-brand-ink transition duration-200 hover:bg-brand-soft"
          >
            All my queues
          </Link>
        }
      >
        <div className="pt-5">
          {queueUnavailable ? (
            <p className="rounded-lg border border-line bg-warn-soft px-3 py-4 text-xs text-warn-ink">
              The queue could not be loaded right now. Your offers and jobs are unaffected.
            </p>
          ) : primaryQueue ? (
            <QueueCard queue={primaryQueue} />
          ) : (
            <p className="rounded-lg border border-dashed border-line px-3 py-6 text-center text-xs text-muted">
              You are not in any rotation yet. Add an appliance to your specializations on your
              profile to join its queue.
            </p>
          )}
        </div>
      </DashboardPanel>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <DashboardStatCard
          label="Pending offers"
          value={pendingOffers?.length ?? 0}
          href="/technician/estimate-requests"
          icon={BriefcaseBusiness}
          colorClass="bg-warn-soft text-warn-ink"
          hint={(pendingOffers?.length ?? 0) > 0 ? "Respond before they lapse" : "Nothing waiting"}
        />
        <DashboardStatCard
          label="Active jobs"
          value={activeJobs ?? 0}
          href="/technician/jobs"
          icon={Wrench}
          colorClass="bg-brand-soft text-brand-ink"
          hint="Open job list"
        />
        <DashboardStatCard
          label="Upcoming"
          value={upcomingSchedules ?? 0}
          href="/technician/jobs"
          icon={CalendarClock}
          colorClass="bg-brand-soft text-brand-ink"
          hint="See schedule"
        />
        <DashboardStatCard
          label="Completed today"
          value={completedToday ?? 0}
          href="/technician/jobs"
          icon={CheckCircle2}
          colorClass="bg-signal-soft text-signal-ink"
          hint="View history"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1.2fr_0.8fr]">
        <DashboardPanel
          title="Today&apos;s schedule"
          icon={CalendarClock}
          className="min-h-[280px]"
          description={
            todayBookings?.length
              ? `${todayBookings.length} upcoming visit${todayBookings.length === 1 ? "" : "s"}`
              : undefined
          }
          bodyClassName="px-5 pb-5"
        >
          {!todayBookings?.length ? (
            <div className="flex flex-col items-center justify-center py-10 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-full bg-soft text-muted/80">
                <CalendarClock className="h-5 w-5" />
              </span>
              <p className="mt-3 text-sm font-medium text-ink">Nothing scheduled yet</p>
              <p className="mt-1 text-xs text-muted">
                Accept an offer and your visits appear on this rail.
              </p>
              <Link
                href="/technician/estimate-requests"
                className="mt-4 inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg bg-brand-600 px-4 text-xs font-semibold text-white transition duration-200 hover:bg-brand-700"
              >
                Review offers
              </Link>
            </div>
          ) : (
            <div className="pt-5">
              <ScheduleTimeline items={scheduleItems} />
            </div>
          )}
        </DashboardPanel>

        <div className="space-y-6">
          <DashboardPanel title="Quick actions" bodyClassName="px-5 pb-5">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <QuickAction
                href="/technician/estimate-requests"
                label="Offer queue"
                hint="Respond to offers"
                tone="bg-warn-soft text-warn-ink"
                icon={<BriefcaseBusiness className="h-4 w-4" />}
              />
              <QuickAction
                href="/technician/jobs"
                label="My schedule"
                hint="Today's visits"
                tone="bg-brand-soft text-brand-ink"
                icon={<CalendarClock className="h-4 w-4" />}
              />
              <QuickAction
                href="/technician/queue"
                label="Queue & schedule"
                hint="Your full rotation"
                tone="bg-brand-soft text-brand-ink"
                icon={<ListOrdered className="h-4 w-4" />}
              />
              <QuickAction
                href="/technician/messages"
                label="Messages"
                hint="Customer chats"
                tone="bg-signal-soft text-signal-ink"
                icon={<MessageSquareText className="h-4 w-4" />}
              />
              <QuickAction
                href="/technician/profile"
                label="Profile & availability"
                hint="Your specializations"
                tone="bg-soft text-muted"
                icon={<UserCircle2 className="h-4 w-4" />}
              />
            </div>
          </DashboardPanel>

          <DashboardPanel title="Recent requests" icon={Wrench} bodyClassName="px-5 pb-5">
            {!recentRequests?.length ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-soft text-muted/80">
                  <Wrench className="h-5 w-5" />
                </span>
                <p className="mt-3 text-sm font-medium text-ink">No requests assigned yet</p>
                <p className="mt-1 text-xs text-muted">
                  Jobs you accept will be listed here.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-line">
                      <th className={TH}>Reference</th>
                      <th className={TH}>Appliance</th>
                      <th className={TH}>Status</th>
                      <th className={`${TH} text-right`}>Received</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {recentRequests.slice(0, 5).map((request) => (
                      <tr key={request.id} className="transition duration-200 hover:bg-soft/70">
                        <td className="py-3.5 pr-4 align-top font-mono text-[11px] text-muted">
                          #{request.id.slice(0, 8)}
                        </td>
                        <td className="py-3.5 pr-4 align-top">
                          <p className="font-medium capitalize text-ink">
                            {request.appliance_type?.replace(/_/g, " ") ?? "—"}
                          </p>
                          <p className="mt-0.5 line-clamp-1 text-xs text-muted">
                            {request.location ?? request.problem_description ?? "—"}
                          </p>
                        </td>
                        <td className="py-3.5 pr-4 align-top">
                          <StatusBadge status={request.status} size="sm" withDot />
                        </td>
                        <td className="whitespace-nowrap py-3.5 text-right align-top text-xs text-muted">
                          {new Date(request.created_at).toLocaleDateString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                          })}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </DashboardPanel>
        </div>
      </div>

      <SupportBanner
        icon={Headset}
        title="Need assistance?"
        body="Reach the admin team about assignments, schedules or anything blocking a job."
        href="/technician/messages"
        ctaLabel="Message support"
      />
    </div>
  );
}

/** Micro header label, matching the other dashboard tables. */
const TH =
  "pb-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted whitespace-nowrap";

function QuickAction({
  href,
  label,
  hint,
  tone,
  icon,
}: {
  href: string;
  label: string;
  hint: string;
  tone: string;
  icon: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className="group flex cursor-pointer items-center gap-3 rounded-xl border border-line bg-surface p-3.5 transition duration-200 hover:border-brand-300 hover:bg-brand-soft/40"
    >
      <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${tone}`}>
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold text-ink">{label}</span>
        <span className="mt-0.5 block truncate text-[11px] text-muted">{hint}</span>
      </span>
    </Link>
  );
}
