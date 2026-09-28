import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getTechnicianQueue } from "@/lib/assignment";
import {
  buildApplianceQueues,
  formatQueueTime,
  operationalStatusMeta,
  type QueueEntry,
} from "@/lib/queue";
import type {
  OperationalStatus,
  TechnicianQueueSnapshotRow,
  TechnicianQueueEventRow,
} from "@/types/database";
import { TONE_CHIP } from "@/components/QueueCard";
import QueueOverrideControl from "@/components/QueueOverrideControl";
import StatusBadge from "@/components/StatusBadge";
import { History, ListOrdered, ShieldCheck } from "lucide-react";

/**
 * Admin queue monitoring (spec §14, §32).
 *
 * This replaces a view that recomputed the rotation in the browser from
 * `last_assigned_at` and then split technicians into "Available now" and
 * "Currently booked" — i.e. it treated a future appointment as unavailability,
 * which is precisely the bug the new model removes. Everything here now comes
 * from `technician_queue_snapshot()`: real positions, real operational status,
 * real next bookings, plus the audit trail that explains every skip.
 *
 * The administrator's own JWT is used on purpose: `technician_queue_snapshot`
 * and `admin_queue_override` both authorise on `is_admin()`, so a service-role
 * client (which has no `auth.uid()`) would be refused — and an override with no
 * identity behind it would produce a useless audit row.
 */
const STATUS_FILTERS: { key: string; label: string; statuses: OperationalStatus[] }[] = [
  { key: "all", label: "All", statuses: [] },
  { key: "available", label: "Available", statuses: ["AVAILABLE"] },
  { key: "on_job", label: "On job", statuses: ["ON_JOB"] },
  { key: "scheduled", label: "Scheduled", statuses: ["SCHEDULED"] },
  {
    key: "unavailable",
    label: "Unavailable",
    statuses: ["TEMPORARILY_UNAVAILABLE", "OFFLINE", "SUSPENDED"],
  },
];

function queueHref(queueType: string | null, status: string) {
  const params = new URLSearchParams();
  if (queueType) params.set("queue", queueType);
  if (status && status !== "all") params.set("status", status);
  const query = params.toString();
  return query ? `/admin/technician-queue?${query}` : "/admin/technician-queue";
}

export default async function AdminTechnicianQueuePage({
  searchParams,
}: {
  searchParams?: { queue?: string; status?: string };
}) {
  const supabase = createClient();

  let rows: TechnicianQueueSnapshotRow[] = [];
  let queueError: string | null = null;
  try {
    rows = await getTechnicianQueue(supabase);
  } catch (error) {
    queueError = error instanceof Error ? error.message : String(error);
  }

  const queues = buildApplianceQueues(rows);
  // Audit rows only carry a technician id, so resolve names once from the
  // snapshot (which already contains every queue member, safe fields only).
  const nameById = new Map(rows.map((row) => [row.technician_id, row.technician_name]));
  const selectedQueue = searchParams?.queue ?? null;
  const statusKey = searchParams?.status ?? "all";
  const activeFilter =
    STATUS_FILTERS.find((filter) => filter.key === statusKey) ?? STATUS_FILTERS[0];
  const visibleQueues = selectedQueue
    ? queues.filter((queue) => queue.applianceType === selectedQueue)
    : queues;

  // Audit trail: every offer, decline, expiry, skip and override. The snapshot
  // tells you where somebody is; these events tell you how they got there.
  const { data: eventRows } = await supabase
    .from("technician_queue_events")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(60);
  const events = (eventRows ?? []) as TechnicianQueueEventRow[];

  const eventRequestIds = Array.from(
    new Set(events.map((event) => event.repair_request_id).filter(Boolean) as string[])
  );
  const { data: eventRequests } = eventRequestIds.length
    ? await supabase
        .from("service_requests")
        .select("id, appliance_type, assignment_status, requested_window_start, requested_window_end")
        .in("id", eventRequestIds)
    : { data: [] };
  const requestMap = new Map((eventRequests ?? []).map((request) => [request.id, request]));

  const skipEvents = events.filter((event) => event.action.startsWith("SKIPPED_")).slice(0, 10);
  const offerEvents = events
    .filter((event) =>
      [
        "OFFERED",
        "ACCEPTED",
        "DECLINED",
        "EXPIRED",
        "TURN_CONSUMED",
        "WAITING_FOR_TECHNICIAN",
      ].includes(event.action)
    )
    .slice(0, 12);

  const { count: offeredCount } = await supabase
    .from("service_requests")
    .select("*", { count: "exact", head: true })
    .eq("assignment_status", "offered");
  const { count: waitingCount } = await supabase
    .from("service_requests")
    .select("*", { count: "exact", head: true })
    .eq("assignment_status", "waiting");

  const rotationSize = queues.reduce((total, queue) => total + queue.activeTechnicianCount, 0);
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">Technician queue monitoring</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink/65">
          Queue position is fairness; operational status is availability; the schedule is the actual
          appointments. A technician with a future booking stays in the rotation — they are skipped
          only for a request whose requested time actually clashes.
        </p>
      </div>

      {queueError && (
        <p className="rounded-card border border-line bg-alert-soft px-4 py-3 text-sm text-alert-ink">
          The queue could not be loaded: {queueError}
        </p>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <AdminStat
          label="Appliance queues"
          value={String(queues.length)}
          hint="Each rotates independently"
        />
        <AdminStat
          label="Technicians in rotation"
          value={String(rotationSize)}
          hint="Memberships across all queues"
        />
        <AdminStat
          label="Offers outstanding"
          value={String(offeredCount ?? 0)}
          hint="Awaiting a technician response"
        />
        <AdminStat
          label="Waiting requests"
          value={String(waitingCount ?? 0)}
          hint="No eligible technician yet"
        />
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted/80">
            Appliance queue
          </span>
          <FilterLink href={queueHref(null, statusKey)} active={!selectedQueue} label="All" />
          {queues.map((queue) => (
            <FilterLink
              key={queue.applianceType}
              href={queueHref(queue.applianceType, statusKey)}
              active={selectedQueue === queue.applianceType}
              label={queue.label}
              badge={String(queue.activeTechnicianCount)}
            />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted/80">
            Status
          </span>
          {STATUS_FILTERS.map((filter) => (
            <FilterLink
              key={filter.key}
              href={queueHref(selectedQueue, filter.key)}
              active={activeFilter.key === filter.key}
              label={filter.label}
            />
          ))}
        </div>
      </div>
      {!visibleQueues.length && !queueError && (
        <p className="rounded-card border border-dashed border-ink/20 bg-surface px-6 py-10 text-center text-sm text-muted">
          No appliance queue matches this filter yet. A queue appears once an approved technician has
          that specialization.
        </p>
      )}

      {visibleQueues.map((queue) => {
        const entries = activeFilter.statuses.length
          ? queue.entries.filter((entry) =>
              activeFilter.statuses.includes(entry.operationalStatus)
            )
          : queue.entries;

        return (
          <section
            key={queue.applianceType}
            className="rounded-card border border-ink/8 bg-surface p-5 shadow-card"
          >
            <header className="flex flex-wrap items-end justify-between gap-2">
              <div>
                <h2 className="font-display text-base font-semibold text-ink">
                  {queue.label} queue
                </h2>
                <p className="mt-0.5 text-[11px] text-muted">
                  {queue.activeTechnicianCount} in rotation
                  {queue.nextTurnPosition !== null
                    ? ` · next turn: #${queue.nextTurnPosition}`
                    : " · nobody in rotation"}
                  {activeFilter.key !== "all"
                    ? ` · filtered to ${activeFilter.label.toLowerCase()}`
                    : ""}
                </p>
              </div>
            </header>

            {entries.length ? (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[820px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-line">
                      <th className={TH}>Position</th>
                      <th className={TH}>Technician</th>
                      <th className={TH}>Status</th>
                      <th className={TH}>Next booking</th>
                      <th className={TH}>Current job</th>
                      <th className={TH}>Offer</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {entries.map((entry) => (
                      <AdminQueueRow key={entry.technicianId} entry={entry} />
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mt-3 rounded-lg border border-dashed border-line px-3 py-5 text-center text-xs text-muted">
                No technician in this queue is currently {activeFilter.label.toLowerCase()}.
              </p>
            )}

            <details className="mt-4 rounded-lg border border-line bg-soft/60 px-3 py-2">
              <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
                Administrative override (audited)
              </summary>
              <p className="mt-2 text-[11px] leading-relaxed text-muted">
                Manual rotation changes are deliberately awkward: you must give a reason, and the
                change is written to the queue audit trail with your account, the old position and the
                new position. Never use this to hand work to a preferred technician — the rotation is
                a fairness mechanism.
              </p>
              <div className="mt-3 space-y-2">
                {queue.entries.map((entry) => (
                  <QueueOverrideControl
                    key={entry.technicianId}
                    applianceType={queue.applianceType}
                    technicianId={entry.technicianId}
                    technicianName={entry.name}
                    position={entry.position}
                    isActive={entry.isMemberActive}
                  />
                ))}
              </div>
            </details>
          </section>
        );
      })}
      <div className="grid gap-6 xl:grid-cols-2">
        <section className="rounded-card border border-ink/8 bg-surface p-5 shadow-card">
          <header className="flex items-center gap-2">
            <History className="h-4 w-4 text-brand-ink" />
            <h2 className="font-display text-base font-semibold text-ink">
              Why technicians were skipped
            </h2>
          </header>
          <p className="mt-1 text-[11px] leading-relaxed text-muted">
            A skipped technician keeps their position. A schedule clash, a full workload or an
            unavailable account only skips them for that one request.
          </p>
          {skipEvents.length ? (
            <ul className="mt-3 space-y-2">
              {skipEvents.map((event) => {
                const request = event.repair_request_id
                  ? requestMap.get(event.repair_request_id)
                  : undefined;
                return (
                  <li
                    key={event.id}
                    className="rounded-lg border border-line bg-soft/60 px-3 py-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-xs font-semibold text-ink">
                        {nameById.get(event.technician_id ?? "") ?? "System"}
                        <span className="ml-2 font-mono text-[10px] font-normal text-muted/80">
                          {event.appliance_type ?? "—"}
                        </span>
                      </p>
                      <span className="text-[10px] text-muted/80">
                        {formatQueueTime(event.created_at)}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-muted">
                      {skipLabel(event.action)} · stays at #
                      {event.new_position ?? event.old_position ?? "—"}
                    </p>
                    {event.reason && (
                      <p className="mt-0.5 text-[11px] text-muted">{event.reason}</p>
                    )}
                    {request && (
                      <p className="mt-0.5 text-[10px] text-muted/80">
                        Request #{request.id.slice(0, 8)} · requested{" "}
                        {request.requested_window_start
                          ? formatQueueTime(request.requested_window_start)
                          : "no fixed window"}
                        {request.requested_window_end
                          ? ` – ${formatQueueTime(request.requested_window_end)}`
                          : ""}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-3 rounded-lg border border-dashed border-line px-3 py-5 text-center text-xs text-muted">
              No technician has been skipped yet.
            </p>
          )}
        </section>

        <section className="rounded-card border border-ink/8 bg-surface p-5 shadow-card">
          <header className="flex items-center gap-2">
            <ListOrdered className="h-4 w-4 text-brand-ink" />
            <h2 className="font-display text-base font-semibold text-ink">Offer activity</h2>
          </header>
          <p className="mt-1 text-[11px] leading-relaxed text-muted">
            Offers expire automatically — the sweep runs every five minutes. An expired offer is
            passed on and the technician&apos;s queue position is untouched.
          </p>
          {offerEvents.length ? (
            <ul className="mt-3 space-y-2">
              {offerEvents.map((event) => {
                const request = event.repair_request_id
                  ? requestMap.get(event.repair_request_id)
                  : undefined;
                return (
                  <li
                    key={event.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-ink">
                        {actionLabel(event.action)} ·{" "}
                        {nameById.get(event.technician_id ?? "") ?? "unassigned"}
                      </p>
                      <p className="mt-0.5 text-[10px] text-muted/80">
                        {event.repair_request_id
                          ? `Request #${event.repair_request_id.slice(0, 8)}`
                          : "No request"}
                        {event.reason ? ` · ${event.reason}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {request && <StatusBadge status={request.assignment_status} size="sm" />}
                      <span className="text-[10px] text-muted/80">
                        {formatQueueTime(event.created_at)}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="mt-3 rounded-lg border border-dashed border-line px-3 py-5 text-center text-xs text-muted">
              No offer activity recorded yet.
            </p>
          )}
        </section>
      </div>

      <section className="rounded-card border border-ink/8 bg-surface p-5 shadow-card">
        <header className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-brand-ink" />
          <h2 className="font-display text-base font-semibold text-ink">Queue history</h2>
          <span className="ml-auto text-[11px] text-muted">
            Last {Math.min(events.length, 25)} queue events
          </span>
        </header>
        {events.length ? (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead>
                <tr className="border-b border-line">
                  <th className={TH}>When</th>
                  <th className={TH}>Action</th>
                  <th className={TH}>Technician</th>
                  <th className={TH}>Appliance</th>
                  <th className={TH}>Position</th>
                  <th className={TH}>Reason</th>
                  <th className={TH}>Actor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {events.slice(0, 25).map((event) => (
                  <tr key={event.id} className="transition duration-200 hover:bg-soft/70">
                    <td className="whitespace-nowrap py-2.5 pr-4 align-top text-xs text-muted">
                      {formatQueueTime(event.created_at)}
                    </td>
                    <td className="py-2.5 pr-4 align-top text-xs font-medium text-ink">
                      {actionLabel(event.action)}
                    </td>
                    <td className="py-2.5 pr-4 align-top text-xs text-muted">
                      {nameById.get(event.technician_id ?? "") ?? "—"}
                    </td>
                    <td className="py-2.5 pr-4 align-top font-mono text-[11px] text-muted">
                      {event.appliance_type ?? "—"}
                    </td>
                    <td className="whitespace-nowrap py-2.5 pr-4 align-top text-xs text-muted">
                      {positionChange(event)}
                    </td>
                    <td className="py-2.5 pr-4 align-top text-xs text-muted">
                      {event.reason ?? "—"}
                    </td>
                    <td className="whitespace-nowrap py-2.5 align-top text-xs text-muted">
                      {event.actor_id ? "Administrator" : "System"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="mt-3 rounded-lg border border-dashed border-line px-3 py-5 text-center text-xs text-muted">
            No queue activity recorded yet. Position changes, offers, declines and overrides all land
            here.
          </p>
        )}
      </section>
    </div>
  );
}

/** Micro header label, matching the rest of the admin tables. */
const TH =
  "pb-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted whitespace-nowrap";

function AdminStat({ label, value, hint }: { label: string; value: string; hint: string }) {
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

function FilterLink({
  href,
  active,
  label,
  badge,
}: {
  href: string;
  active: boolean;
  label: string;
  badge?: string;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[11px] font-semibold transition duration-200 ${
        active
          ? "border-brand-600 bg-brand-600 text-white"
          : "border-line bg-surface text-muted hover:border-brand-300 hover:bg-brand-soft/60"
      }`}
    >
      {label}
      {badge && (
        <span
          className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
            active ? "bg-white/20 text-white" : "bg-soft text-muted"
          }`}
        >
          {badge}
        </span>
      )}
    </Link>
  );
}

/**
 * One queue row. Admin sees everything the snapshot exposes: position,
 * operational status, next booking, current job and whether an offer is out —
 * but never customer details, which do not belong in a queue monitor.
 */
function AdminQueueRow({ entry }: { entry: QueueEntry }) {
  const meta = operationalStatusMeta(entry.operationalStatus);
  return (
    <tr
      className={entry.isMemberActive ? "hover:bg-soft/70" : "bg-soft/60 text-muted/80"}
    >
      <td className="py-3 pr-4 align-middle">
        <span className="inline-flex h-7 min-w-7 items-center justify-center rounded-lg bg-soft px-2 text-xs font-bold text-muted">
          {entry.position ? `#${entry.position}` : "—"}
        </span>
      </td>
      <td className="py-3 pr-4 align-middle">
        <span className="font-medium text-ink">{entry.name}</span>
        {entry.isNextInQueue && (
          <span className="ml-2 rounded-full border border-line bg-signal-soft px-2 py-0.5 text-[10px] font-semibold text-signal-ink">
            Next turn
          </span>
        )}
        {!entry.isMemberActive && (
          <span className="ml-2 rounded-full bg-line px-2 py-0.5 text-[10px] font-semibold text-muted">
            Out of rotation
          </span>
        )}
      </td>
      <td className="py-3 pr-4 align-middle">
        <span
          title={meta.hint}
          className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${
            TONE_CHIP[meta.tone] ?? TONE_CHIP.neutral
          }`}
        >
          {meta.label}
        </span>
      </td>
      <td className="whitespace-nowrap py-3 pr-4 align-middle text-xs text-muted">
        {entry.nextBookingAt ? formatQueueTime(entry.nextBookingAt) : "—"}
      </td>
      <td className="whitespace-nowrap py-3 pr-4 align-middle text-xs text-muted">
        {entry.currentJobUntil ? `Until ${formatQueueTime(entry.currentJobUntil)}` : "—"}
      </td>
      <td className="whitespace-nowrap py-3 align-middle text-xs text-muted">
        {entry.activeOfferRequestId ? (
          <span className="rounded-full border border-line bg-warn-soft px-2 py-0.5 text-[10px] font-semibold text-warn-ink">
            {entry.offersExpiresAt ? `Expires ${formatQueueTime(entry.offersExpiresAt)}` : "Offered"}
          </span>
        ) : (
          "—"
        )}
      </td>
    </tr>
  );
}

/** Reads as a sentence, so "why did nothing change" is answerable at a glance. */
function positionChange(event: TechnicianQueueEventRow) {
  if (event.old_position === null && event.new_position === null) return "—";
  if (event.old_position === event.new_position) return `#${event.new_position ?? "—"} (unchanged)`;
  if (event.old_position === null) return `→ #${event.new_position}`;
  if (event.new_position === null) return `#${event.old_position} → removed`;
  return `#${event.old_position} → #${event.new_position}`;
}

const ACTION_LABELS: Record<string, string> = {
  JOINED_QUEUE: "Joined queue",
  TURN_CONSUMED: "Turn consumed",
  MOVED_TO_END: "Moved to end",
  POSITION_CHANGED: "Position changed",
  SKIPPED_DUE_TO_SCHEDULE: "Skipped — schedule conflict",
  SKIPPED_DUE_TO_CAPACITY: "Skipped — at capacity",
  SKIPPED_DUE_TO_UNAVAILABLE: "Skipped — unavailable",
  SKIPPED_DUE_TO_SERVICE_AREA: "Skipped — outside service area",
  SKIPPED_DUE_TO_ACTIVE_OFFER: "Skipped — already reviewing an offer",
  OFFERED: "Offer sent",
  ACCEPTED: "Offer accepted",
  DECLINED: "Offer declined",
  EXPIRED: "Offer expired",
  REMOVED: "Removed from queue",
  REACTIVATED: "Reactivated",
  STATUS_CHANGED: "Status changed",
  WAITING_FOR_TECHNICIAN: "Waiting for technician",
  ADMIN_OVERRIDE: "Admin override",
};

function actionLabel(action: string) {
  return ACTION_LABELS[action] ?? action.replace(/_/g, " ").toLowerCase();
}

function skipLabel(action: string) {
  return ACTION_LABELS[action] ?? action;
}

