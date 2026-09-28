"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronDown, LogOut, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import LoadingScreen from "@/components/LoadingScreen";
import { signOut } from "@/lib/signOut";
import type { UserRole } from "@/types/database";
import { ROLE_LABEL } from "@/lib/roleMeta";

export interface SidebarNavItem {
  label: string;
  href?: string;
  icon?: LucideIcon;
  /** Count rendered on the right of the row — pending offers, unread, etc. */
  badge?: number;
  children?: SidebarNavItem[];
}

interface SidebarProps {
  items: SidebarNavItem[];
  role?: UserRole;
  /** Mobile drawer state. Controlled by `DashboardShell`. */
  mobileOpen?: boolean;
  onClose?: () => void;
}


/**
 * Deep-navy workspace rail, identical across all four roles. Role identity is
 * carried by the label here and by the dot in the topbar rather than by
 * recolouring the whole shell — four differently coloured sidebars made the
 * product look like four products.
 *
 * `active` styling only ever changes colour/background, never geometry, so
 * switching pages can't shift the layout.
 */
export default function Sidebar({
  items,
  role = "customer",
  mobileOpen = false,
  onClose,
}: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    await signOut(router);
  }

  return (
    <>
      {signingOut && <LoadingScreen message="Signing you out..." />}

      {mobileOpen && (
        <button
          type="button"
          aria-label="Close navigation menu"
          onClick={onClose}
          className="fixed inset-0 z-40 cursor-pointer bg-ink/40 backdrop-blur-[2px] md:hidden"
        />
      )}

      <aside
        id="dashboard-sidebar"
        className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-[#0B1B33] text-white transition-transform duration-200 ease-out md:sticky md:top-16 md:z-30 md:h-[calc(100vh-4rem)] md:w-64 md:max-w-none md:shrink-0 md:translate-x-0 ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-4 pt-5 md:hidden">
          <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-white/45">
            {ROLE_LABEL[role]} workspace
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close navigation menu"
            className="inline-flex h-8 w-8 cursor-pointer items-center justify-center rounded-lg text-white/60 transition hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="hidden px-5 pb-1 pt-6 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40 md:block">
          {ROLE_LABEL[role]} workspace
        </p>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-3">
          {items.map((item) =>
            item.children?.length ? (
              <SidebarGroup key={item.label} item={item} pathname={pathname} onNavigate={onClose} />
            ) : (
              <SidebarLink key={item.label} item={item} pathname={pathname} onNavigate={onClose} />
            )
          )}
        </nav>

        <div className="border-t border-white/10 p-3">
          <button
            type="button"
            onClick={handleSignOut}
            className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-white/60 transition hover:bg-alert-500/20 hover:text-white"
          >
            <LogOut className="h-[18px] w-[18px] shrink-0" />
            Log out
          </button>
        </div>
      </aside>
    </>
  );
}

function isRouteActive(pathname: string, href?: string) {
  if (!href) return false;
  if (pathname === href) return true;
  return href !== "/" && pathname.startsWith(`${href}/`);
}

/** Shared row geometry. Only colour changes between states, never geometry. */
const ROW_BASE =
  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition duration-200 cursor-pointer";
const ROW_ACTIVE = "bg-brand-500 text-white shadow-[0_8px_20px_rgba(18,85,199,0.4)]";
const ROW_IDLE = "text-white/65 hover:bg-white/10 hover:text-white";

function SidebarLink({
  item,
  pathname,
  onNavigate,
}: {
  item: SidebarNavItem;
  pathname: string;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  const active = isRouteActive(pathname, item.href);

  return (
    <Link
      href={item.href ?? "#"}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={`${ROW_BASE} ${active ? ROW_ACTIVE : ROW_IDLE}`}
    >
      {Icon && <Icon className="h-[18px] w-[18px] shrink-0" />}
      <span className="truncate">{item.label}</span>
      {typeof item.badge === "number" && item.badge > 0 && (
        <span
          className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            active ? "bg-white/25 text-white" : "bg-white/10 text-white/70"
          }`}
        >
          {item.badge > 99 ? "99+" : item.badge}
        </span>
      )}
    </Link>
  );
}

function SidebarGroup({
  item,
  pathname,
  onNavigate,
}: {
  item: SidebarNavItem;
  pathname: string;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  const activeChild = item.children?.some((child) => isRouteActive(pathname, child.href)) ?? false;
  // Start open when we're already inside the group, and re-open if a child
  // becomes active through a redirect the user didn't click.
  const [open, setOpen] = useState(activeChild);

  useEffect(() => {
    if (activeChild) setOpen(true);
  }, [activeChild]);

  const badgeTotal = item.children?.reduce((sum, child) => sum + (child.badge ?? 0), 0) ?? 0;

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        aria-expanded={open}
        className={`${ROW_BASE} w-full text-left ${
          activeChild && !open ? ROW_ACTIVE : ROW_IDLE
        }`}
      >
        {Icon && <Icon className="h-[18px] w-[18px] shrink-0" />}
        <span className="flex-1 truncate">{item.label}</span>
        {badgeTotal > 0 && !open && (
          <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white/70">
            {badgeTotal}
          </span>
        )}
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-white/40 transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <div className="ml-4 mt-1 space-y-1 border-l border-white/10 pl-2">
          {item.children?.map((child) => (
            <SidebarLink
              key={child.label}
              item={child}
              pathname={pathname}
              onNavigate={onNavigate}
            />
          ))}
        </div>
      )}
    </div>
  );
}
