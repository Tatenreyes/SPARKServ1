"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import DashboardTopbar from "@/components/DashboardTopbar";
import Sidebar from "@/components/Sidebar";
import MobileBottomNav from "@/components/mobile/MobileBottomNav";
import MotionProvider from "@/components/motion/MotionProvider";
import { usePlatformAnnouncement } from "@/hooks/usePlatformAnnouncement";
import { isImmersiveRoute, navForRole } from "@/lib/navConfig";
import type { UserRole } from "@/types/database";

/**
 * Alias for "the role that owns a dashboard". It is exactly `UserRole` — the
 * app has one role vocabulary, declared in `@/types/database`.
 */
export type DashboardRole = UserRole;

/** localStorage key remembering the desktop rail's collapsed/expanded choice. */
const SIDEBAR_COLLAPSE_KEY = "sparkserv:sidebar-collapsed";

/**
 * The chrome that wraps every authenticated dashboard: a sticky topbar, the
 * role's sidebar, the content column, and — below `lg` only — the bottom tab
 * bar.
 *
 * Takes only a `role` (a string) plus `children`, so the route layouts stay thin
 * and everything crossing the server/client boundary stays serializable. The nav
 * is resolved from `navForRole` because the items carry icon components.
 *
 * This is a client component because the mobile sidebar is a slide-over drawer
 * that needs shared open/closed state between the topbar's hamburger and the
 * sidebar itself — state the (server) route layouts can't hold — and because the
 * mobile shell has to know the current path to decide whether the tab bar steps
 * aside for a sticky form action. The desktop rail's collapsed state lives here
 * for the same reason: it is shared between the topbar's toggle and the sidebar,
 * and it is persisted so the choice survives a reload.
 */
export default function DashboardShell({
  role,
  children,
}: {
  role: DashboardRole;
  children: React.ReactNode;
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  // Desktop rail collapse. Starts expanded; the stored preference is applied in
  // an effect after mount so the server and first client render agree (reading
  // localStorage during render would be a hydration mismatch).
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();

  // The platform announcement for the topbar strip. Owned by the shell, not by
  // the topbar, because the sidebar's sticky offset has to follow the extra 32px
  // the strip adds to the header.
  const {
    message: announcement,
    visible: announcementVisible,
    dismiss: dismissAnnouncement,
  } = usePlatformAnnouncement();

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(SIDEBAR_COLLAPSE_KEY) === "1");
    } catch {
      // Storage can be unavailable (private mode, blocked cookies) — the rail
      // simply stays expanded, which is the safe default.
    }
  }, []);

  function toggleCollapsed() {
    setCollapsed((previous) => {
      const next = !previous;
      try {
        window.localStorage.setItem(SIDEBAR_COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        // Persisting is best-effort; the in-memory toggle still works.
      }
      return next;
    });
  }

  // The sidebar calls this when a collapsed group's parent is clicked: a 76px
  // rail can't show a sublist, so the only way to reach those pages is to open
  // the rail. Persisted like the toggle so the two never disagree after a reload.
  function expandSidebar() {
    setCollapsed(false);
    try {
      window.localStorage.setItem(SIDEBAR_COLLAPSE_KEY, "0");
    } catch {
      // Best-effort, as above.
    }
  }

  // Close the drawer whenever we land on a new route. `onNavigate` only covers
  // links inside the sidebar, so this also catches redirects and programmatic
  // navigation while the drawer happens to be open.
  useEffect(() => {
    setMobileNavOpen(false);
  }, [pathname]);

  // Lock the page while the drawer is open, so a swipe on the scrim scrolls
  // nothing instead of dragging the dashboard around behind the overlay.
  useEffect(() => {
    if (!mobileNavOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [mobileNavOpen]);

  /**
   * Bottom clearance for the fixed bar that is currently on screen. Exactly one
   * of these applies, and each is scoped to the `max-width` at which its bar
   * actually exists, so on desktop the column keeps its plain padding
   * utilities:
   *
   *   * a route with a sticky primary action reserves room for the button —
   *     but only below `md`, because the button itself is a phone-only control;
   *   * every other route reserves room for the bottom navigation all the way
   *     up to `lg`, where the sidebar takes over and the bar disappears.
   *
   * Without either, the fixed bar covers the last card and the page cannot be
   * scrolled far enough to reveal it.
   */
  const bottomClearance = isImmersiveRoute(pathname)
    ? "spark-sticky-action-offset"
    : "spark-bottom-nav-offset";

  return (
    <div className="reference-palette flex min-h-screen flex-col bg-canvas">
      <DashboardTopbar
        role={role}
        menuOpen={mobileNavOpen}
        onMenuToggle={() => setMobileNavOpen((open) => !open)}
        collapsed={collapsed}
        onToggleCollapsed={toggleCollapsed}
        announcement={announcementVisible ? announcement : ""}
        onDismissAnnouncement={dismissAnnouncement}
      />
      <div className="flex flex-1 items-stretch">
        <Sidebar
          items={navForRole(role)}
          role={role}
          mobileOpen={mobileNavOpen}
          onClose={() => setMobileNavOpen(false)}
          collapsed={collapsed}
          onExpand={expandSidebar}
          announcementVisible={announcementVisible}
        />
        {/* A plain div, not <main>: the root layout already renders the page's
            single main landmark, and nesting a second one is invalid HTML.
            `min-w-0` stops wide tables from blowing out the flex column and
            forcing horizontal scroll on the whole page. */}
        <div
          className={`min-w-0 flex-1 px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-8 ${bottomClearance}`}
        >
          {/* No max-width: on a wide desktop the whole point is to use the
              available width. The generous cap only stops line-length and card
              grids from stretching absurdly on ultra-wide (>2400px) monitors,
              and it matches the topbar so the two stay aligned. */}
          <MotionProvider>
            <div className="mx-auto w-full max-w-[1800px]">{children}</div>
          </MotionProvider>
        </div>
      </div>

      {/* Rendered last so it is never trapped beneath the drawer's scrim when
          both are in the DOM. */}
      <MobileBottomNav role={role} />
    </div>
  );
}



