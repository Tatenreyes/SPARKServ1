import Link from "next/link";
import { ArrowRight } from "lucide-react";

/**
 * The top of an internal page, as a header rather than a hand-built block.
 *
 * This is the markup the admin and super admin dashboards were each writing out
 * for themselves — eyebrow, heading, one-line description, primary action — with
 * the differences between them being accidents rather than decisions. On a phone
 * the shared version is laid out as a card-like stack with the action as a
 * full-width 44px button under the copy, which is where a thumb can reach it;
 * from `md` up it returns to the inline title-left / action-right arrangement
 * those pages already had, so nothing on a desktop changes.
 *
 * The action is optional because not every page has a single obvious next step —
 * a page with two equal actions should not be given a header button, it should
 * get a real section further down.
 */
export default function MobilePageHeader({
  eyebrow,
  title,
  subtitle,
  action,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  /** The one thing this page exists to let you do, if there is one. */
  action?: { href: string; label: string };
}) {
  return (
    <header className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between md:gap-4">
      <div className="min-w-0">
        {eyebrow && (
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-ink">
            {eyebrow}
          </p>
        )}
        <h1 className="mt-1.5 font-display text-2xl font-bold text-ink md:mt-2 md:text-3xl">
          {title}
        </h1>
        {subtitle && (
          <p className="mt-1.5 text-sm leading-relaxed text-muted">{subtitle}</p>
        )}
      </div>

      {/* `inline-flex` inside a `flex-col` parent stretches to the container's
          width on a phone and shrinks back to its own content at `md`, where the
          parent becomes a row. */}
      {action && (
        <Link
          href={action.href}
          className="inline-flex h-11 shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white shadow-sm transition duration-200 hover:bg-brand-700 hover:shadow-md"
        >
          {action.label}
          <ArrowRight className="h-4 w-4" aria-hidden="true" />
        </Link>
      )}
    </header>
  );
}