import Link from "next/link";
import { ArrowUpRight, type LucideIcon } from "lucide-react";
import MobileStatGrid from "@/components/mobile/MobileStatGrid";
import MobileStatTile from "@/components/mobile/MobileStatTile";

export function DashboardStatCard({
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
  
  hint?: string;
}) {
  return (
    <Link href={href} className="spark-card-interactive group flex flex-col justify-between p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            {label}
          </p>
          <p className="mt-2 font-display text-3xl font-bold leading-none text-ink">{value}</p>
        </div>
        <span
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${colorClass}`}
        >
          <Icon className="h-5 w-5" />
        </span>
      </div>
      {/* Hover feedback is a transform on the arrow only — the card itself never
          translates, because a hover that moves the card shifts the grid. */}
      <div className="mt-4 flex items-center gap-1.5 text-xs font-semibold text-brand-ink">
        {hint ?? "View details"}
        <ArrowUpRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
      </div>
    </Link>
  );
}

/** One metric, described once and rendered in whichever shape the width allows. */
export type DashboardStat = {
  label: string;
  value: number | string;
  href: string;
  icon: LucideIcon;
  colorClass?: string;
  hint?: string;
};

/**
 * A row of statistics, in the shape the viewport can actually hold.
 *
 * Below `sm` that is a 2x2 grid of compact tiles (`MobileStatTile`); from `sm`
 * up it is the card grid it always was, two columns wide until `xl` spreads it
 * to the full row. This replaced a swipeable rail of 66%-wide cards, which on a
 * phone showed one figure and a sliver of the next — so reading four numbers
 * meant four swipes, and a horizontal swipe inside a vertically scrolling page
 * is a gesture people trigger by accident.
 *
 * The point of taking `items` rather than `children` is that the two shapes are
 * built from one array. Hand-writing a card row and a tile row per dashboard is
 * how a figure ends up correct in one layout and stale in the other; here the
 * value is evaluated once, and every dashboard change is a change to a list
 * instead of to a list *twice*.
 *
 * Keys come from `label` because a dashboard's tiles are labelled uniquely by
 * construction ("Active jobs" and "Active bookings" are the same dashboard's two
 * different counts, and the numbers are not unique — two tiles legitimately both
 * show `0`). A stale-locale duplicate label is a copy bug to fix, not a case to
 * design around.
 */
export function DashboardStatGroup({
  items,
  desktopColumns = 4,
}: {
  items: DashboardStat[];
  /** Column count at `xl`. Must be one of the keys below, so the class stays a
   *  literal Tailwind can see at build time. */
  desktopColumns?: 2 | 4 | 5 | 6;
}) {
  const xlClass = XL_COLUMNS[desktopColumns] ?? XL_COLUMNS[4];

  return (
    <>
      <MobileStatGrid>
        {items.map((item) => (
          <MobileStatTile key={item.label} {...item} />
        ))}
      </MobileStatGrid>

      <div className={`hidden gap-3 sm:grid sm:grid-cols-2 ${xlClass}`}>
        {items.map((item) => (
          <DashboardStatCard key={item.label} {...item} />
        ))}
      </div>
    </>
  );
}

const XL_COLUMNS: Record<number, string> = {
  2: "xl:grid-cols-2",
  4: "xl:grid-cols-4",
  5: "xl:grid-cols-5",
  6: "xl:grid-cols-6",
};

export function DashboardPanel({
  title,
  eyebrow,
  description,
  icon: Icon,
  action,
  children,
  className = "",
  bodyClassName = "px-5 pb-5",
}: {
  title: string;
  eyebrow?: string;
  description?: string;
  icon?: LucideIcon;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /**
   * Padding for the body. Defaults to the standard panel inset.
   *
   * It used to default to none "so existing call sites keep their current flush
   * layout", which meant any panel that forgot to opt in rendered its content
   * hard against the card edge — the admin dashboard did exactly that on all of
   * its panels, so booking rows and activity items sat flush with the border
   * while the header above them was inset by 20px. The three dashboards that did
   * remember were each passing this same string by hand.
   */
  bodyClassName?: string;
}) {
  return (
    <section className={`spark-card ${className}`}>
      {title && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            {Icon && (
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-ink">
                <Icon className="h-4 w-4" />
              </span>
            )}
            <div className="min-w-0">
              {eyebrow && <p className="spark-eyebrow">{eyebrow}</p>}
              <h2 className="truncate font-display text-[15px] font-semibold text-ink">{title}</h2>
              {description && <p className="mt-0.5 text-xs text-muted">{description}</p>}
            </div>
          </div>
          {action}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}

/**
 * Sparkline for a real series of counts, oldest first.
 *
 * `color` / `fill` used to default to hardcoded hexes (`#1264D6`), which is the
 * one thing MASTER.md forbids outright — and it meant the line stayed mid-blue
 * on the dark canvas. The line now draws with `currentColor`, so the wrapper's
 * `accentClassName` decides the colour and it follows the theme like every
 * other surface.
 *
 * `Math.max(...[])` is `-Infinity`, so a caller passing no points used to
 * render a malformed polygon rather than nothing. An empty series is a real
 * state on a dashboard that has just been deployed, so it now says so instead
 * of drawing a flat line that implies "zero activity, measured".
 */
export function DashboardTrend({
  values,
  caption,
  accentClassName = "text-brand-ink",
  heightClass = "h-28",
}: {
  /** One point per bucket, oldest first. */
  values: number[];
  /** What the series measures — read by screen readers, shown under the chart. */
  caption?: string;
  accentClassName?: string;
  /** Height of the plotted area, useful when the chart has its own dashboard panel. */
  heightClass?: string;
}) {
  if (values.length === 0) {
    return (
      <div className="flex h-28 w-full items-center justify-center rounded-lg border border-dashed border-line bg-soft px-4 text-center text-xs text-muted">
        No activity recorded in this period yet.
      </div>
    );
  }

  const max = Math.max(...values);
  const min = Math.min(...values);
  const span = max - min;
  const points = values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * 100;
      // A flat series (every bucket equal) has no range to scale against, so it
      // is drawn down the middle rather than pinned to the floor.
      const y = span === 0 ? 50 : 88 - ((value - min) / span) * 65;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div className={`relative ${heightClass} w-full overflow-hidden rounded-lg bg-soft px-2 pt-2 ${accentClassName}`}>
      <div aria-hidden="true" className="absolute inset-x-2 top-1/4 border-t border-dashed border-line" />
      <div aria-hidden="true" className="absolute inset-x-2 top-1/2 border-t border-dashed border-line" />
      <div aria-hidden="true" className="absolute inset-x-2 top-3/4 border-t border-dashed border-line" />
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="relative h-full w-full"
        role="img"
        aria-label={caption ?? `Trend across ${values.length} periods, ${min} to ${max}`}
      >
        <polygon points={`0,100 ${points} 100,100`} fill="currentColor" fillOpacity={0.12} />
        <polyline
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          vectorEffect="non-scaling-stroke"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
