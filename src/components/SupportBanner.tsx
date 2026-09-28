import Link from "next/link";
import type { LucideIcon } from "lucide-react";

/**
 * Filled navy band for support/help entry points. Sits at the end of a content
 * column where a low-contrast grey panel used to disappear into the page.
 *
 * One of the only two gradient surfaces in the app — see `MASTER.md`.
 */
export default function SupportBanner({
  icon: Icon,
  title,
  body,
  href,
  ctaLabel,
  secondary,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  href: string;
  ctaLabel: string;
  secondary?: React.ReactNode;
}) {
  return (
    <section className="spark-navy-gradient relative overflow-hidden rounded-card px-5 py-5 sm:px-6">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -right-10 -top-16 h-56 w-56 rounded-full bg-white/5 blur-2xl"
      />
      <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3.5">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/10 text-white ring-1 ring-white/15">
            <Icon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="font-display text-sm font-semibold text-white">{title}</p>
            <p className="mt-1 text-xs leading-relaxed text-white/70">{body}</p>
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2.5">
          {secondary}
          <Link
            href={href}
            className="inline-flex h-10 cursor-pointer items-center justify-center rounded-xl bg-white px-5 text-sm font-semibold text-[#0B1B33] transition duration-200 hover:bg-white/90"
          >
            {ctaLabel}
          </Link>
        </div>
      </div>
    </section>
  );
}
