import Link from "next/link";
import type { LucideIcon } from "lucide-react";

export function DashboardStatCard({
  label,
  value,
  hint,
  href,
  icon: Icon,
}: {
  label: string;
  value: number | string;
  hint: string;
  href: string;
  icon: LucideIcon;
}) {
  return (
    <Link
      href={href}
      className="spark-card group flex h-full flex-col justify-between p-4 transition-all duration-200 hover:-translate-y-1 hover:border-brand-200 hover:shadow-soft"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium text-slate-500">{label}</p>
          <p className="mt-2 font-display text-2xl font-semibold text-slate-900">{value}</p>
        </div>
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
          <Icon className="h-4 w-4" />
        </div>
      </div>
      <p className="mt-3 text-[11px] font-medium text-slate-400">{hint}</p>
    </Link>
  );
}

export function DashboardPanel({
  title,
  action,
  children,
  className = "",
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`spark-card p-4 ${className}`}>
      <div className="mb-4 flex items-center justify-between gap-3 border-b border-slate-100 pb-3">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        {action}
      </div>
      {children}
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
      const x = (index / (values.length - 1)) * 100;
      const y = 88 - ((value - min) / Math.max(max - min, 1)) * 65;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <div className="relative h-28 w-full overflow-hidden rounded-lg bg-slate-50 px-2 pt-2">
      <div className="absolute inset-x-2 top-1/4 border-t border-dashed border-slate-200" />
      <div className="absolute inset-x-2 top-1/2 border-t border-dashed border-slate-200" />
      <div className="absolute inset-x-2 top-3/4 border-t border-dashed border-slate-200" />
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="relative h-full w-full" aria-hidden="true">
        <polygon points={`0,100 ${points} 100,100`} fill={fill} />
        <polyline points={points} fill="none" stroke={color} strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
