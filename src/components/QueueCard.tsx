import Link from "next/link";
import {
  type ApplianceQueue,
  formatQueueTime,
  myQueueStanding,
  operationalStatusMeta,
} from "@/lib/queue";

export const TONE_CHIP: Record<string, string> = {
  success: "bg-signal-soft text-signal-ink border-line",
  warn: "bg-warn-soft text-warn-ink border-line",
  info: "bg-brand-soft text-brand-ink border-line",
  neutral: "bg-soft text-muted border-line",
  danger: "bg-alert-soft text-alert-ink border-line",
};

/**
 * The full rotation for one appliance type.
 *
 * This is a faithful read of the queue the assignment engine walks
 * (`technician_queue_snapshot()`, ordered by queue position), which is why every
 * technician in the rotation is listed — not just the signed-in one. The signed-in
 * technician is highlighted, never re-sorted, so the order stays truthful.
 *
 * Language matters here: position #1 means "next turn", not "next job". A
 * technician at #1 is still skipped for a request whose time clashes with their
 * schedule or exceeds their workload, and nobody is ever dropped from the queue
 * because of a future booking.
 */
export default function QueueCard({
  queue,
  selfTechnicianId,
  showPositionPanel = true,
  description,
}: {
  queue: ApplianceQueue;
  /** Falls back to the snapshot's is_self flag when not provided. */
  selfTechnicianId?: string;
  showPositionPanel?: boolean;
  description?: string;
}) {
  const mine =
    queue.entries.find((entry) => entry.isSelf) ??
    (selfTechnicianId
      ? queue.entries.find((entry) => entry.technicianId === selfTechnicianId)
      : undefined) ??
    null;

  const myPosition = mine?.isMemberActive ? mine.position : null;
  const myMeta = mine ? operationalStatusMeta(mine.operationalStatus) : null;

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,240px)_1fr]">
      {showPositionPanel && (
        <div className="flex flex-col justify-center rounded-xl border border-line bg-brand-50/50 px-5 py-6 text-center">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-ink">
            Your queue position
          </p>
          <p className="mt-2 font-display text-5xl font-bold leading-none text-brand-ink">
            {myPosition ? `#${myPosition}` : "—"}
          </p>
          <p className="mt-2 text-xs font-semibold text-ink">{queue.label}</p>

          {myMeta && (
            <p className="mt-3">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${
                  TONE_CHIP[myMeta.tone] ?? TONE_CHIP.neutral
                }`}
              >
                {myMeta.label}
              </span>
            </p>
          )}

          <p className="mt-3 text-[11px] leading-relaxed text-muted">{myQueueStanding(queue)}</p>

          <Link
            href="/technician/profile"
            className="mt-4 inline-flex h-8 cursor-pointer items-center justify-center rounded-lg border border-line bg-surface px-3 text-[11px] font-semibold text-brand-ink transition duration-200 hover:bg-brand-soft"
          >
            Availability settings
          </Link>
        </div>
      )}

      <div className="min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-display text-base font-semibold text-ink">{queue.label} queue</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-muted">
              {description ??
                `${queue.activeTechnicianCount} technician${
                  queue.activeTechnicianCount === 1 ? "" : "s"
                } in this rotation. Order is a fair rotation — never rating, experience or job count.`}
            </p>
          </div>
          {queue.nextTurnPosition !== null && (
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-line bg-brand-soft px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-brand-ink">
              #{queue.nextTurnPosition} holds the next turn
            </span>
          )}
        </div>

        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-sm">
            <thead>
              <tr className="border-b border-line">
                <th className={TH}>Position</th>
                <th className={TH}>Technician</th>
                <th className={TH}>Status</th>
                <th className={`${TH} text-right`}>Next booking</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {queue.entries.map((entry) => {
                const meta = operationalStatusMeta(entry.operationalStatus);
                const isMine = entry.isSelf;
                return (
                  <tr
                    key={entry.technicianId}
                    className={
                      isMine
                        ? "bg-brand-soft/60 ring-1 ring-inset ring-line"
                        : entry.isMemberActive
                          ? "transition duration-200 hover:bg-soft/70"
                          : "bg-soft/60 text-muted/80"
                    }
                  >
                    <td className="py-3.5 pl-2 pr-4 align-middle">
                      <span
                        className={`inline-flex h-7 min-w-7 items-center justify-center rounded-lg px-2 text-xs font-bold ${
                          isMine
                            ? "bg-brand-600 text-white"
                            : entry.isMemberActive
                              ? "bg-soft text-muted"
                              : "bg-soft text-muted/80"
                        }`}
                      >
                        {entry.position ? `#${entry.position}` : "—"}
                      </span>
                    </td>
                    <td className="py-3.5 pr-4 align-middle">
                      <span className="flex flex-wrap items-center gap-2">
                        <span
                          className={`truncate font-medium ${isMine ? "text-brand-ink" : "text-ink"}`}
                        >
                          {isMine ? "You" : entry.name}
                        </span>
                        {isMine && (
                          <span className="rounded-full bg-brand-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em] text-white">
                            You
                          </span>
                        )}
                        {entry.isNextInQueue && (
                          <span className="rounded-full border border-line bg-signal-soft px-2 py-0.5 text-[10px] font-semibold text-signal-ink">
                            Next turn
                          </span>
                        )}
                        {entry.activeOfferRequestId && (
                          <span className="rounded-full border border-line bg-warn-soft px-2 py-0.5 text-[10px] font-semibold text-warn-ink">
                            {isMine ? "Offer waiting on you" : "Reviewing an offer"}
                          </span>
                        )}
                      </span>
                      {isMine && (
                        <span className="mt-0.5 block truncate text-[11px] text-muted">
                          {entry.name}
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 pr-4 align-middle">
                      <span
                        title={meta.hint}
                        className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] ${
                          TONE_CHIP[meta.tone] ?? TONE_CHIP.neutral
                        }`}
                      >
                        {entry.isMemberActive ? meta.label : `${meta.label} · out of rotation`}
                      </span>
                    </td>
                    <td className="whitespace-nowrap py-3.5 text-right align-middle">
                      {entry.nextBookingAt ? (
                        <span className="text-xs font-medium text-muted">
                          {formatQueueTime(entry.nextBookingAt)}
                        </span>
                      ) : entry.currentJobUntil ? (
                        <span className="text-xs font-medium text-muted">
                          On job until {formatQueueTime(entry.currentJobUntil)}
                        </span>
                      ) : (
                        <span className="text-xs text-muted/80">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {!queue.entries.length && (
          <p className="mt-3 rounded-lg border border-dashed border-line px-3 py-6 text-center text-xs text-muted">
            Nobody is in this rotation yet.
          </p>
        )}

        <p className="mt-3 text-[11px] leading-relaxed text-muted">
          Being #1 means your turn comes first — not that the next job is automatically yours.
          You are skipped for a specific request if the requested time clashes with your
          schedule or exceeds your workload, and a future booking never removes you from the
          rotation.
        </p>
      </div>
    </div>
  );
}

/** Micro header label, matching the dashboard tables. */
const TH =
  "pb-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted whitespace-nowrap";
