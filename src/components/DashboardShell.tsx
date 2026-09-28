"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import DashboardTopbar from "@/components/DashboardTopbar";
import Sidebar from "@/components/Sidebar";
import { navForRole } from "@/lib/navConfig";
import type { UserRole } from "@/types/database";

/**
 * Alias for "the role that owns a dashboard". It is exactly `UserRole` — the
 * app has one role vocabulary, declared in `@/types/database`.
 */
export type DashboardRole = UserRole;

/**
 * The chrome that wraps every authenticated dashboard: a sticky topbar, the
 * role's sidebar, and the content column.
 *
 * Takes only a `role` (a string) plus `children`, so the route layouts stay thin
 * and everything crossing the server/client boundary stays serializable. The nav
 * is resolved from `navForRole` because the items carry icon components.
 *
 * This is a client component because the mobile sidebar is a slide-over drawer
 * that needs shared open/closed state between the topbar's hamburger and the
 * sidebar itself — state the (server) route layouts can't hold.
 */
export default function DashboardShell({
  role,
  children,
}: {
  role: DashboardRole;
  children: React.ReactNode;
}) {
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const pathname = usePathname();

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

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <DashboardTopbar
        role={role}
        menuOpen={mobileNavOpen}
        onMenuToggle={() => setMobileNavOpen((open) => !open)}
      />
      <div className="flex flex-1 items-stretch">
        <Sidebar
          items={navForRole(role)}
          role={role}
          mobileOpen={mobileNavOpen}
          onClose={() => setMobileNavOpen(false)}
        />
        {/* A plain div, not <main>: the root layout already renders the page's
            single main landmark, and nesting a second one is invalid HTML.
            `min-w-0` stops wide tables from blowing out the flex column and
            forcing horizontal scroll on the whole page. */}
        <div className="min-w-0 flex-1 px-4 py-5 sm:px-6 sm:py-6 lg:px-8 lg:py-8">
          <div className="mx-auto w-full max-w-[1400px]">{children}</div>
        </div>
      </div>
    </div>
  );
}



