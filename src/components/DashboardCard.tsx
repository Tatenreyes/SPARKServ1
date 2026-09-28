import Link from "next/link";
import { ArrowUpRight, type LucideIcon } from "lucide-react";

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
    <Link href={href} className="spark-card-interactive group flex flex-col justify-between p-5">
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

export function DashboardPanel({
  title,
  eyebrow,
  description,
  icon: Icon,
  action,
  children,
  className = "",
  bodyClassName = "",
}: {
  title: string;
  eyebrow?: string;
  description?: string;
  icon?: LucideIcon;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  /** Padding/spacing for the body. Defaults to none so existing call sites keep
   *  their current flush layout; new panels pass `px-5 pb-5`. */
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

export function DashboardTrend({
  values,
  color = "#1264D6",
  fill = "rgba(18, 100, 214, 0.12)",
}: {
  values: number[];
  color?: string;
  fill?: string;
}) {
  const max = Math.max(...values);
  const min = Math.min(...values);
  const points = values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * 100;
      const y = 88 - ((value - min) / Math.max(max - min, 1)) * 65;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div className="relative h-28 w-full overflow-hidden rounded-lg bg-soft px-2 pt-2">
      <div className="absolute inset-x-2 top-1/4 border-t border-dashed border-line" />
      <div className="absolute inset-x-2 top-1/2 border-t border-dashed border-line" />
      <div className="absolute inset-x-2 top-3/4 border-t border-dashed border-line" />
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="relative h-full w-full" aria-hidden="true">
        <polygon points={`0,100 ${points} 100,100`} fill={fill} />
        <polyline points={points} fill="none" stroke={color} strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
