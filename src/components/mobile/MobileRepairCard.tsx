import Link from "next/link";
import { ChevronRight } from "lucide-react";
import StatusBadge from "@/components/StatusBadge";

/**
 * One repair, as a card.
 *
 * The phone replacement for a table row. A repair row carries four facts
 * (appliance, problem, status, date) and one action; laid across a 360px screen
 * as table columns they either truncate to initials or force the whole page to
 * scroll sideways. Stacked, every fact gets a full line and the action gets a
 * full-width button.
 *
 * Used by the dashboard's recent list and by the repair-history and
 * progress-tracking list views, so a repair looks the same everywhere on a
 * phone.
 */
export default function MobileRepairCard({
  applianceType,
  problem,
  status,
  dateISO,
  href,
  cta,
  amount,
}: {
  applianceType: string | null;
  problem: string | null;
  status: string;
  /** ISO timestamp. */
  dateISO: string;
  href: string;
  cta: string;
  /** Peso figure, when the status has one attached (a completed repair, an
   *  accepted estimate). */
  amount?: number | null;
}) {
  const date = new Date(dateISO);

  return (
    <div className="rounded-card border border-line bg-surface p-4 shadow-[0_1px_2px_rgba(16,38,74,0.04)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-display text-[15px] font-semibold capitalize text-ink">
            {applianceType?.replace(/_/g, " ") ?? "Repair request"}
          </p>
          <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted">
            {problem ?? "No description recorded"}
          </p>
        </div>
        {typeof amount === "number" && (
          <p className="shrink-0 font-display text-sm font-bold text-ink">
            ₱{amount.toLocaleString("en-US", { maximumFractionDigits: 2 })}
          </p>
        )}
      </div>

      {/* Status is a badge (dot + word), never a bare colour — see
          `StatusBadge`. The date sits beside it rather than in its own column. */}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <StatusBadge status={status} size="sm" withDot />
        <span className="text-[11px] text-muted">
          {Number.isNaN(date.getTime())
            ? "Date not recorded"
            : date.toLocaleDateString("en-US", {
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
        </span>
      </div>

      <Link
        href={href}
        className="mt-3 flex h-11 w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-brand-600 bg-surface px-4 text-sm font-semibold text-brand-ink transition duration-200 hover:border-brand-500 hover:bg-brand-soft"
      >
        {cta}
        <ChevronRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </div>
  );
}

/**
 * The CTA for a repair in a given state, so the list and the card agree.
 *
 * `quoted` is the only status where the next step is a decision rather than a
 * look, and the estimate is the thing being decided — so the button says so.
 */
export function repairCta(status: string): string {
  if (status === "quoted") return "Review estimate";
  if (status === "completed") return "View service report";
  if (status === "booked") return "View booking";
  return "View repair";
}
