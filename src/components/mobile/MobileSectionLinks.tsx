import Link from "next/link";
import { ChevronRight, type LucideIcon } from "lucide-react";

export type SectionLink = {
  href: string;
  label: string;
  hint: string;
  icon: LucideIcon;
  /** Optional right-hand count or state word ("2 pending"). */
  meta?: string;
};

/**
 * A section hub: the list of destinations behind one bottom-navigation tab.
 *
 * The bottom bar carries four tabs, so everything else has to be reachable one
 * level down. Rather than re-showing the full sidebar — which is what makes a
 * phone feel like a shrunken website — each tab opens a short, described list of
 * the things that actually live in that section.
 *
 * Rows, not tiles: a row is a full-width 56px target a thumb can hit without
 * aiming, it has room for a real description, and it degrades gracefully to a
 * two-column grid on a tablet.
 */
export default function MobileSectionLinks({
  links,
  title,
  description,
}: {
  links: SectionLink[];
  title?: string;
  description?: string;
}) {
  return (
    <section className="rounded-card border border-line bg-surface shadow-[0_1px_2px_rgba(16,38,74,0.04)]">
      {title && (
        <div className="border-b border-line px-4 py-3.5 sm:px-5">
          <h2 className="font-display text-[15px] font-semibold text-ink">{title}</h2>
          {description && (
            <p className="mt-0.5 text-xs leading-relaxed text-muted">{description}</p>
          )}
        </div>
      )}

      <ul className="divide-y divide-line sm:grid sm:grid-cols-2 sm:divide-y-0">
        {links.map((link) => {
          const Icon = link.icon;
          return (
            <li key={link.href} className="sm:border-b sm:border-line sm:last:border-b-0 sm:odd:border-r">
              <Link
                href={link.href}
                className="flex min-h-[64px] cursor-pointer items-center gap-3 px-4 py-3 transition duration-200 hover:bg-soft/70 sm:px-5"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-ink">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink">
                    {link.label}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted">
                    {link.hint}
                  </span>
                </span>
                {link.meta && (
                  <span className="shrink-0 rounded-full border border-line bg-soft px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                    {link.meta}
                  </span>
                )}
                <ChevronRight
                  className="h-4 w-4 shrink-0 text-muted/60"
                  aria-hidden="true"
                />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
