"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { bottomNavForRole, isImmersiveRoute, type BottomNavItem } from "@/lib/navConfig";
import { useUnreadNotificationCount } from "@/hooks/useUnreadNotificationCount";
import type { UserRole } from "@/types/database";

/**
 * Which tab carries the unread-notification badge, per role.
 *
 * The badge belongs on the tab whose section contains that role's only
 * notification-reading surface: the customer reads theirs under Support
 * (messages + tickets), the technician under Me. Administrators and super
 * administrators have no notification inbox route yet, so they get no badge
 * rather than a badge that leads nowhere.
 */
const NOTIFICATION_TAB: Record<UserRole, string | null> = {
  customer: "/customer/support",
  technician: "/technician/profile",
  admin: null,
  super_admin: null,
};

/**
 * The phone's primary navigation.
 *
 * Four destinations, thumb-height, pinned to the bottom of the viewport. It is
 * the mobile counterpart of the sidebar — not a compressed copy of it: the
 * sidebar carries *every* destination, this carries the four a person reaches
 * for constantly, and everything else stays one tap deeper through a section hub
 * or the drawer behind the hamburger.
 *
 * Three details that are easy to get wrong and are all deliberate:
 *
 *   1. **Both tabs are legal.** `alsoMatches` keeps a tab lit when the visitor is
 *      on a page that belongs to its section but lives at a different path
 *      (`/customer/estimates` under "Repairs"). Without it the phone silently
 *      loses its sense of place. When two tabs both match, the longest match
 *      wins, so a deeper route can never light the shallower tab.
 *   2. **Active is never colour-only.** The current tab gets a top indicator bar
 *      and a heavier label as well as the accent colour, plus `aria-current`, so
 *      it survives both a colour-blind reader and a screen reader.
 *   3. **Safe-area aware.** The bar's own bottom padding comes from
 *      `env(safe-area-inset-bottom)` in `globals.css`, and the content column is
 *      given matching clearance by `DashboardShell` — a `fixed` bar contributes
 *      no height to the document, so without that the last card sits underneath
 *      it and cannot be scrolled clear.
 */
export default function MobileBottomNav({ role }: { role: UserRole }) {
  const pathname = usePathname();
  const items = bottomNavForRole(role);
  const unread = useUnreadNotificationCount();

  // A page with its own sticky primary action owns the bottom of the screen.
  if (isImmersiveRoute(pathname)) return null;

  const activeHref = resolveActiveHref(pathname, items);
  const badgeHref = NOTIFICATION_TAB[role];

  return (
    <nav aria-label="Primary" className="spark-bottom-nav lg:hidden">
      <ul className="mx-auto flex w-full max-w-xl items-stretch">
        {items.map((item) => {
          const Icon = item.icon;
          const active = item.href === activeHref;
          const badge = item.href === badgeHref ? unread : 0;

          return (
            <li key={item.href} className="min-w-0 flex-1">
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`spark-tap relative flex h-[56px] flex-col items-center justify-center gap-1 px-1 pt-1.5 text-[11px] leading-none transition-colors duration-200 ${
                  active
                    ? "font-bold text-brand-ink"
                    : "font-semibold text-muted hover:text-ink"
                }`}
              >
                {active && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-brand-500"
                  />
                )}

                <span className="relative flex h-[22px] w-[22px] items-center justify-center">
                  <Icon className="h-[22px] w-[22px]" aria-hidden="true" />
                  {badge > 0 && (
                    <span className="absolute -right-2.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-alert-500 px-1 text-[10px] font-semibold text-white">
                      {badge > 9 ? "9+" : badge}
                    </span>
                  )}
                </span>

                <span className="max-w-full truncate">{item.label}</span>

                {badge > 0 && (
                  <span className="sr-only">, {badge} unread notifications</span>
                )}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

/**
 * The tab that owns the current route, decided by the longest matching prefix.
 *
 * `href` itself is compared too, so a tab whose own path is deeper than another
 * tab's `alsoMatches` entry still wins on its own page.
 */
function resolveActiveHref(pathname: string, items: BottomNavItem[]): string | null {
  let best: { href: string; matchedLength: number } | null = null;

  for (const item of items) {
    for (const candidate of [item.href, ...(item.alsoMatches ?? [])]) {
      const matches =
        pathname === candidate || pathname.startsWith(`${candidate}/`);
      if (!matches) continue;
      if (!best || candidate.length > best.matchedLength) {
        best = { href: item.href, matchedLength: candidate.length };
      }
    }
  }

  return best?.href ?? null;
}
