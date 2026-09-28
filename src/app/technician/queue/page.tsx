import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getTechnicianQueue } from "@/lib/assignment";
import {
  applianceLabel,
  buildApplianceQueues,
  formatQueueTime,
  operationalStatusMeta,
  type ApplianceQueue,
} from "@/lib/queue";
import QueueCard from "@/components/QueueCard";
import ScheduleTimeline, { type ScheduleItem } from "@/components/ScheduleTimeline";
import { CalendarClock, Info, ListOrdered } from "lucide-react";

/**
 * Queue & Schedule — the technician's honest view of the rotation.
 *
 * Two things this page deliberately does:
 *
 *  1. It renders the WHOLE queue for each appliance the technician covers, read
 *     from `technician_queue_snapshot()`. The old dashboard only ever described
 *     the signed-in technician's first specialization, which made their standing
 *     unknowable; "why am I not getting offers?" was unanswerable from the UI.
 *  2. It keeps queue position and schedule apart. Position is fairness
 *     (spec §1/§2); the schedule panel is the actual appointments (spec §3).
 *     A future booking never hides someone from the rotation, so this page never
 *     computes an availability flag of its own — that decision belongs to
 *     Postgres, per request and per requested time window.
 */
export default async function TechnicianQueuePage({
  searchParams,
}: {
  searchParams?: { queue?: string };
}) {
  const user = await getCurrentUser();
  const supabase = createClient();

  let queues: ApplianceQueue[] = [];
  let queueError: string | null = null;
  try {
    queues = buildApplianceQueues(await getTechnicianQueue(supabase));
  } catch (error) {
    // Surfaced rather than swallowed: the usual cause is the queue migration
    // not being applied yet, and a silent empty page would look like "you are
    // not in any queue".
    queueError = error instanceof Error ? error.message : String(error);
  }

  const selected = searchParams?.queue ? String(searchParams.queue) : null;
  const visibleQueues = selected
    ? queues.filter((queue) => queue.applianceType === selected)
    : queues;

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  const { data: upcomingBookings } = await supabase
    .from("bookings")
    .select("id, service_request_id, scheduled_at, status")
    .eq("technician_id", user!.id)
    .in("status", ["pending", "confirmed", "in_progress"])
    .gte("scheduled_at", todayStart.toISOString())
    .order("scheduled_at", { ascending: true })
    .limit(10);

  const upcomingRequestIds = Array.from(
    new Set((upcomingBookings ?? []).map((booking) => booking.service_request_id))
  );
  const { data: upcomingRequests } = upcomingRequestIds.length
    ? await supabase
        .from("service_requests")
        .select("id, appliance_type, location")
        .in("id", upcomingRequestIds)
    : { data: [] };
  const upcomingRequestMap = new Map((upcomingRequests ?? []).map((r) => [r.id, r]));

  const scheduleItems: ScheduleItem[] = (upcomingBookings ?? []).map((booking) => {
    const request = upcomingRequestMap.get(booking.service_request_id);
    return {
      id: booking.id,
      scheduledAt: booking.scheduled_at,
      title: request?.appliance_type ? applianceLabel(request.appliance_type) : "Repair visit",
      meta: `#${booking.id.slice(0, 8)}${request?.location ? ` · ${request.location}` : ""}`,
      status: booking.status,
      href: "/technician/jobs",
    };
  });

  // The technician's own standing: their best (lowest) queue position, and
  // whether any offer is currently waiting on them.
  const myQueues = queues.filter((queue) => queue.myPosition !== null);
  const bestPosition = myQueues.length
    ? Math.min(...myQueues.map((queue) => queue.myPosition as number))
    : null;
  const leadQueue =
    myQueues.find((queue) => queue.myPosition === bestPosition) ?? myQueues[0] ?? null;
  const myStatus = leadQueue?.myStatus ?? null;
  const myStatusMeta = myStatus ? operationalStatusMeta(myStatus) : null;
  const pendingOffer = queues
    .flatMap((queue) => queue.entries)
    .find((entry) => entry.isSelf && entry.activeOfferRequestId) ?? null;

  const isExpired = selected && !queues.some((queue) => queue.applianceType === selected);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">Queue &amp; schedule</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink/65">
          Your position in each appliance rotation, the technicians you are rotating with, and the
          appointments already on your calendar.
        </p>
      </div>
      {queueError && (
        <p className="rounded-card border border-line bg-alert-soft px-4 py-3 text-sm text-alert-ink">
          The queue could not be loaded: {queueError}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <QueueStat
          label="Your best position"
          value={bestPosition ? `#${bestPosition}` : "—"}
          hint={leadQueue ? leadQueue.label : "Not in a rotation"}
        />
        <QueueStat
          label="Your status"
          value={myStatusMeta?.label ?? "—"}
          hint={myStatusMeta?.hint ?? "Operational status"}
        />
        <QueueStat
          label="Offer waiting on you"
          value={pendingOffer ? "1" : "0"}
          hint={
            pendingOffer
              ? `Expires ${formatQueueTime(pendingOffer.offersExpiresAt)}`
              : "Nothing to review"
          }
        />
        <QueueStat
          label="Upcoming visits"
          value={String(scheduleItems.length)}
          hint={
            scheduleItems[0]
              ? `Next ${formatQueueTime(scheduleItems[0].scheduledAt)}`
              : "Nothing booked"
          }
        />
      </div>

      {queues.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <TabLink
            href="/technician/queue"
            active={!selected || Boolean(isExpired)}
            label="All my queues"
            badge={`${queues.length}`}
          />
          {queues.map((queue) => (
            <TabLink
              key={queue.applianceType}
              href={`/technician/queue?queue=${encodeURIComponent(queue.applianceType)}`}
              active={selected === queue.applianceType}
              label={queue.label}
              badge={queue.myPosition ? `#${queue.myPosition}` : "—"}
            />
          ))}
        </div>
      )}
      {!queues.length && !queueError && (
        <div className="rounded-card border border-dashed border-ink/20 bg-surface px-6 py-10 text-center">
          <ListOrdered className="mx-auto h-6 w-6 text-muted/80" />
          <p className="mt-3 text-sm font-medium text-ink">You are not in any rotation yet</p>
          <p className="mx-auto mt-1 max-w-md text-xs text-muted">
            Queues are per appliance type. Add an appliance to your specializations and you join that
            rotation — at the end of the line, so the rotation stays fair.
          </p>
          <Link
            href="/technician/profile"
            className="mt-4 inline-flex h-9 items-center rounded-lg bg-brand-600 px-4 text-xs font-semibold text-white transition duration-200 hover:bg-brand-700"
          >
            Profile &amp; availability
          </Link>
        </div>
      )}

      {visibleQueues.map((queue) => (
        <section
          key={queue.applianceType}
          className="rounded-card border border-ink/8 bg-surface p-5 shadow-card"
        >
          <QueueCard queue={queue} />
          <div className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-3">
            <MiniFact
              label="Your position"
              value={queue.myPosition ? `#${queue.myPosition}` : "Not in this rotation"}
            />
            <MiniFact label="Next eligible turn" value={nextTurnLabel(queue)} />
            <MiniFact
              label="In rotation"
              value={`${queue.activeTechnicianCount} technician${
                queue.activeTechnicianCount === 1 ? "" : "s"
              }`}
            />
          </div>
        </section>
      ))}

      <div className="grid gap-6 xl:grid-cols-[1.1fr_0.9fr]">
        <section className="rounded-card border border-ink/8 bg-surface p-5 shadow-card">
          <header className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-brand-ink" />
            <h2 className="font-display text-base font-semibold text-ink">Upcoming schedule</h2>
            <span className="ml-auto text-[11px] text-muted">
              {scheduleItems.length} upcoming visit{scheduleItems.length === 1 ? "" : "s"}
            </span>
          </header>
          {scheduleItems.length ? (
            <div className="mt-4">
              <ScheduleTimeline items={scheduleItems} />
            </div>
          ) : (
            <p className="mt-4 rounded-lg border border-dashed border-line px-3 py-6 text-center text-xs text-muted">
              Nothing booked yet. Accepting an offer puts the visit on this list.
            </p>
          )}
          <p className="mt-4 text-[11px] leading-relaxed text-muted">
            This list is your real availability. A visit on 30 January does not make you unavailable
            on 24 January — we only skip you for a specific request whose time actually clashes.
          </p>
        </section>

        <section className="rounded-card border border-line bg-brand-soft/40 p-5">
          <header className="flex items-center gap-2">
            <Info className="h-4 w-4 text-brand-ink" />
            <h2 className="font-display text-base font-semibold text-ink">How the rotation works</h2>
          </header>
          <dl className="mt-3 space-y-2.5 text-xs leading-relaxed text-muted">
            <RotationFact term="Queue position">
              Fairness. It decides who is <em>considered</em> first — nothing else. Ratings,
              experience and completed jobs never move you.
            </RotationFact>
            <RotationFact term="Eligibility">
              Whether you can take the work at all: approved account, correct appliance
              specialisation, service area, not suspended.
            </RotationFact>
            <RotationFact term="Availability">
              Whether the requested time fits your schedule. Checked per request, against the actual
              window the customer asked for — never against a future booking date.
            </RotationFact>
            <RotationFact term="Capacity">
              Your workload ceiling (hours per day, concurrent jobs, jobs per day). A request that
              would exceed it is skipped for you only.
            </RotationFact>
            <RotationFact term="Your turn is consumed on acceptance">
              Accepting an offer moves you to the end of that appliance&apos;s rotation. Declining
              keeps your turn and passes the request to the next eligible technician. Being skipped
              for one request never changes your position.
            </RotationFact>
          </dl>
          <p className="mt-3 rounded-lg bg-surface/70 px-3 py-2 text-[11px] leading-relaxed text-muted">
            You can receive another request before an existing appointment if the times do not clash
            and your capacity allows it.
          </p>
        </section>
      </div>
    </div>
  );
}

/** Small stat tile, matching the dashboard stat cards. */
function QueueStat({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-card border border-ink/8 bg-surface p-3 shadow-card">
      <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
        {label}
      </p>
      <p className="mt-1.5 font-display text-lg font-semibold text-ink">{value}</p>
      <p className="mt-0.5 line-clamp-2 text-[11px] text-muted">{hint}</p>
    </div>
  );
}

/** Appliance filter chip. Both tabs are links, so the whole page stays a server component. */
function TabLink({
  href,
  active,
  label,
  badge,
}: {
  href: string;
  active: boolean;
  label: string;
  badge: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition duration-200 ${
        active
          ? "border-brand-600 bg-brand-600 text-white"
          : "border-line bg-surface text-muted hover:border-brand-300 hover:bg-brand-soft/60"
      }`}
    >
      {label}
      <span
        className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
          active ? "bg-white/20 text-white" : "bg-soft text-muted"
        }`}
      >
        {badge}
      </span>
    </Link>
  );
}

function MiniFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted/80">{label}</p>
      <p className="mt-1 text-sm font-semibold text-ink">{value}</p>
    </div>
  );
}

function RotationFact({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="font-semibold text-ink">{term}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

/** "Technician C (#1)" — who the engine will consider first for this queue. */
function nextTurnLabel(queue: ApplianceQueue): string {
  if (queue.nextTurnPosition === null) return "Nobody in the rotation";
  const holder = queue.entries.find((entry) => entry.position === queue.nextTurnPosition);
  if (!holder) return `#${queue.nextTurnPosition}`;
  return `${holder.isSelf ? "You" : holder.name} (#${holder.position})`;
}

