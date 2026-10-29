import Link from "next/link";
import type { LucideIcon } from "lucide-react";

/**
 * One metric, as a compact tile — the phone's half of the statistic row.
 *
 * The desktop tile (`DashboardStatCard`) is generous on purpose: 20px of padding,
 * a 30px figure, a 44px icon chip and a "View details ↗" footer, because in a
 * six-column grid on a 1400px canvas there is room to be generous and the extra
 * air helps the row read as a scoreboard. Dropped into a two-up grid on a 360px
 * phone the same tile is mostly whitespace: three of them stack taller than the
 * viewport, so the figures the person opened the dashboard for push the actual
 * work below the fold. This tile keeps the same three facts (label, figure,
 * icon) and the same accent palette, at roughly half the height.
 *
 * Two deliberate choices:
 *
 *   1. **The figure is `text-xl`, not `text-3xl`.** A half-width tile has about
 *      130px of inner width, and the figures are not all short — "Confirmed
 *      Revenue" renders as `₱1234567`. At 30px that overflows the tile with no
 *      space to break on, so the size is set by the longest real value, not by
 *      what looks best for "8". `tabular-nums` keeps columns of digits aligned
 *      as the numbers change.
 *   2. **No footer.** On desktop the "View details ↗" line tells a mouse where
 *      the card goes; on a phone the whole tile is already a full-width target
 *      and the line was pure navigation chrome taking a third of the tile's
 *      height. The `hint` is kept for screen readers instead of dropped.
 */
export default function MobileStatTile({
  label,
  value,
  href,
  icon: Icon,
  colorClass = "bg-brand-soft text-brand-ink",
  hint,
}: {
  label: string;
  value: number | string;
  href: string;
  icon: LucideIcon;
  colorClass?: string;
  /** Desktop-only affordance text; announced but not displayed here. */
  hint?: string;
}) {
  return (
    <Link
      href={href}
      className="spark-card-interactive flex min-h-[96px] flex-col justify-between gap-3 p-3.5"
    >
      <span className="flex items-start justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase leading-tight tracking-[0.08em] text-muted">
          {label}
        </span>
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${colorClass}`}
        >
          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
      </span>

      <span className="font-display text-xl font-bold leading-none tabular-nums text-ink">
        {value}
      </span>

      {hint && <span className="sr-only">{hint}</span>}
    </Link>
  );
}