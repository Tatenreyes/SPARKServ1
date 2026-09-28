import Link from "next/link";
import StatusBadge from "@/components/StatusBadge";

export type ScheduleItem = {
  id: string;
  /** ISO timestamp. */
  scheduledAt: string;
  title: string;
  meta: string;
  status: string;
  href?: string;
};

/**
 * A day's work as a time rail instead of a list of identical cards: the time
 * column is the scan axis, the rail makes "what's next" legible at a glance.
 *
 * The first item is emphasised because for a technician the *next* job is the
 * only one that's actionable right now.
 */
export default function ScheduleTimeline({
  items,
  highlightFirst = true,
}: {
  items: ScheduleItem[];
  highlightFirst?: boolean;
}) {
  return (
    <ol className="space-y-0.5">
      {items.map((item, index) => {
        const date = new Date(item.scheduledAt);
        const isNext = highlightFirst && index === 0;
        const isLast = index === items.length - 1;

        const row = (
          <div
            className={`flex min-w-0 flex-col gap-2 rounded-xl border px-4 py-3 transition duration-200 sm:flex-row sm:items-center sm:justify-between ${
              isNext
                ? "border-brand-300 bg-brand-soft/60"
                : "border-line bg-surface hover:border-line hover:bg-soft"
            }`}
          >
            <div className="flex min-w-0 items-center gap-3">
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-[11px] font-bold ${
                  isNext ? "bg-brand-500 text-white" : "bg-soft text-muted"
                }`}
              >
                {Number.isNaN(date.getTime()) ? "—" : index + 1}
              </span>
              <div className="min-w-0">
                <p className="truncate font-display text-sm font-semibold capitalize text-ink">
                  {item.title}
                </p>
                <p className="mt-0.5 truncate text-xs text-muted">{item.meta}</p>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2 pl-12 sm:pl-0">
              {isNext && (
                <span className="hidden text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-ink sm:inline">
                  Next up
                </span>
              )}
              <StatusBadge status={item.status} size="sm" withDot />
            </div>
          </div>
        );

        return (
          <li key={item.id} className="flex gap-3">
            <div className="w-14 shrink-0 pt-3.5 text-right">
              <p className="text-xs font-semibold leading-tight text-ink">
                {Number.isNaN(date.getTime())
                  ? "—"
                  : date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
              </p>
              <p className="mt-0.5 text-[10px] uppercase tracking-[0.08em] text-muted/80">
                {Number.isNaN(date.getTime())
                  ? ""
                  : date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </p>
            </div>

            <div className="flex flex-col items-center pt-4" aria-hidden="true">
              <span
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                  isNext ? "bg-brand-500 ring-4 ring-line" : "bg-line ring-4 ring-line"
                }`}
              />
              {!isLast && <span className="mt-1 w-px flex-1 bg-line" />}
            </div>

            <div className="min-w-0 flex-1 pb-3">
              {item.href ? (
                <Link href={item.href} className="block cursor-pointer">
                  {row}
                </Link>
              ) : (
                row
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
