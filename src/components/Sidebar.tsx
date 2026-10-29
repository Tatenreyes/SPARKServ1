"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronDown, LifeBuoy, LogOut, X } from "lucide-react";
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
  /**
   * Desktop rail collapsed to an icon-only strip. Owned by `DashboardShell`
   * (shared with the topbar's toggle and persisted). Mobile is never affected:
   * the drawer is always full-width with labels, so this only shapes the `lg+`
   * layout.
   */
  collapsed?: boolean;
  /**
   * Re-open the rail to full width. Called when a collapsed group's parent is
   * clicked, because a collapsed rail can't show a group's children — expanding
   * is the only way to reach them.
   */
  onExpand?: () => void;
  /**
   * The topbar is currently carrying the platform-announcement strip, so it is
   * 32px taller than the 64px the rail's sticky offset assumes. Without this the
   * rail's first rows would sit behind the header as soon as the page scrolls.
   * Mobile is unaffected: the drawer is `fixed`, not sticky.
   */
  announcementVisible?: boolean;
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
  collapsed = false,
  onExpand,
  announcementVisible = false,
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
          className="fixed inset-0 z-40 cursor-pointer bg-ink/40 backdrop-blur-[2px] lg:hidden"
        />
      )}

      <aside
        id="dashboard-sidebar"
        className={`fixed inset-y-0 left-0 z-50 flex w-72 max-w-[85vw] flex-col bg-[#0B1118] text-white transition-[width,transform] duration-200 ease-out lg:sticky lg:z-30 lg:max-w-none lg:shrink-0 lg:translate-x-0 ${
          /* `top-24` (6rem) is the 64px bar plus the 32px announcement strip.
             Both offsets are written out rather than derived so the geometry
             stays greppable next to the header it mirrors. */
          announcementVisible
            ? "lg:top-24 lg:h-[calc(100vh-6rem)]"
            : "lg:top-16 lg:h-[calc(100vh-4rem)]"
        } ${
          collapsed ? "lg:w-[76px]" : "lg:w-64"
        } ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between px-4 pt-5 lg:hidden">
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

        {/* Desktop workspace label. Collapsed, it shrinks to a single centred
            initial so the rail keeps a sense of place without spending width on
            the full role name (which the topbar pill already states). */}
        <p
          className={`hidden px-5 pb-1 pt-6 text-[11px] font-semibold uppercase tracking-[0.14em] text-white/40 lg:block ${
            collapsed ? "lg:hidden" : ""
          }`}
        >
          {ROLE_LABEL[role]} workspace
        </p>
        {collapsed && (
          <p className="hidden px-2 pb-1 pt-6 text-center font-display text-sm font-bold text-white/50 lg:block">
            {ROLE_LABEL[role].charAt(0)}
          </p>
        )}

        {/* Collapsed, the rail is `overflow-visible` at `lg` so an icon's hover
            tooltip can escape the strip and sit over the content. A collapsed
            rail is short (icons only, never more items than the expanded list),
            so it does not need its own vertical scroll on desktop; but mobile
            keeps `overflow-y-auto` as the base regardless, because the drawer is
            always the full labelled list and can be taller than the viewport. */}
        <nav
          className={`flex-1 space-y-1 overflow-y-auto px-3 py-3 ${
            collapsed ? "lg:overflow-visible" : ""
          }`}
        >
          {items.map((item) =>
            item.children?.length ? (
              <SidebarGroup
                key={item.label}
                item={item}
                pathname={pathname}
                onNavigate={onClose}
                collapsed={collapsed}
                onExpand={onExpand}
              />
            ) : (
              <SidebarLink
                key={item.label}
                item={item}
                pathname={pathname}
                onNavigate={onClose}
                collapsed={collapsed}
              />
            )
          )}
        </nav>

        <div className="border-t border-white/10 p-3">
          {role === "customer" && (
            <Link
              href="/customer/support"
              onClick={onClose}
              aria-label={collapsed ? "Need a hand? Contact support" : undefined}
              className={`group relative mb-2 flex w-full cursor-pointer items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-left transition hover:border-[#81EDF4]/40 hover:bg-white/10 ${
                collapsed ? "lg:justify-center lg:px-0" : ""
              }`}
            >
              <LifeBuoy className="h-[18px] w-[18px] shrink-0 text-[#81EDF4]" />
              <span className={`min-w-0 ${collapsed ? "lg:hidden" : ""}`}>
                <span className="block text-xs font-semibold text-white">Need a hand?</span>
                <span className="mt-0.5 block text-[10px] text-white/60">Contact support</span>
              </span>
              {collapsed && <RailTooltip label="Need a hand? Contact support" />}
            </Link>
          )}
          <button
            type="button"
            onClick={handleSignOut}
            className={`group relative flex w-full cursor-pointer items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-white/60 transition hover:bg-alert-500/20 hover:text-white ${
              collapsed ? "lg:justify-center lg:px-0" : ""
            }`}
          >
            <LogOut className="h-[18px] w-[18px] shrink-0" />
            <span className={collapsed ? "lg:hidden" : ""}>Log out</span>
            {collapsed && <RailTooltip label="Log out" />}
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

/**
 * The hover/focus label that appears beside an icon when the rail is collapsed.
 *
 * Rendered as a real element rather than a `title` attribute so it can be
 * positioned, themed and — crucially — shown on keyboard focus as well as hover,
 * which a native tooltip will not do. It fades with opacity (not `display`) so
 * the transition animates, and it is `lg:`-scoped so it never appears in the
 * mobile drawer, which always shows full labels. `aria-hidden` because the link
 * already carries an accessible name via its own `aria-label` when collapsed;
 * this is a visual echo, not the label of record.
 */
function RailTooltip({ label }: { label: string }) {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute left-full top-1/2 z-50 ml-2 -translate-y-1/2 whitespace-nowrap rounded-lg border border-line bg-surface px-2.5 py-1.5 text-xs font-semibold text-ink opacity-0 shadow-card transition-opacity duration-150 lg:group-hover:opacity-100 lg:group-focus-visible:opacity-100"
    >
      {label}
    </span>
  );
}

function SidebarLink({
  item,
  pathname,
  onNavigate,
  collapsed = false,
}: {
  item: SidebarNavItem;
  pathname: string;
  onNavigate?: () => void;
  collapsed?: boolean;
}) {
  const Icon = item.icon;
  const active = isRouteActive(pathname, item.href);

  return (
    <Link
      href={item.href ?? "#"}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      // Collapsed, the visible text is gone, so the icon-only link needs its own
      // accessible name; the tooltip is aria-hidden and can't carry it.
      aria-label={collapsed ? item.label : undefined}
      className={`group relative ${ROW_BASE} ${active ? ROW_ACTIVE : ROW_IDLE} ${
        collapsed ? "lg:justify-center lg:px-0" : ""
      }`}
    >
      {Icon && <Icon className="h-[18px] w-[18px] shrink-0" />}
      <span className={`truncate ${collapsed ? "lg:hidden" : ""}`}>{item.label}</span>
      {/* Numeric badge. Hidden at `lg` only when the rail is collapsed (making
          room for the dot below); on mobile the drawer always shows it, even if
          the desktop rail happens to be collapsed. */}
      {typeof item.badge === "number" && item.badge > 0 && (
        <span
          className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
            active ? "bg-white/25 text-white" : "bg-white/10 text-white/70"
          } ${collapsed ? "lg:hidden" : ""}`}
        >
          {item.badge > 99 ? "99+" : item.badge}
        </span>
      )}
      {/* Collapsed, a badge becomes a dot so the rail still signals "something
          here" without room for a number. Desktop-only; the mobile drawer keeps
          the numeric badge above. */}
      {typeof item.badge === "number" && item.badge > 0 && collapsed && (
        <span
          aria-hidden="true"
          className="absolute right-2 top-2 hidden h-2 w-2 rounded-full bg-accent-500 ring-2 ring-[#0B1B33] lg:block"
        />
      )}
      {collapsed && <RailTooltip label={item.label} />}
    </Link>
  );
}

function SidebarGroup({
  item,
  pathname,
  onNavigate,
  collapsed = false,
  onExpand,
}: {
  item: SidebarNavItem;
  pathname: string;
  onNavigate?: () => void;
  collapsed?: boolean;
  onExpand?: () => void;
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

  // Collapsed, the group can't reveal its children in a 76px rail, so the parent
  // icon's job flips from "toggle the sublist" to "open the rail". Clicking it
  // expands the sidebar (and the group stays open, so the children are right
  // there). Without this the group would be a dead end with no way to its pages.
  function handleParentClick() {
    if (collapsed) {
      onExpand?.();
      setOpen(true);
      return;
    }
    setOpen((previous) => !previous);
  }

  return (
    <div>
      <button
        type="button"
        onClick={handleParentClick}
        aria-expanded={collapsed ? undefined : open}
        aria-label={collapsed ? item.label : undefined}
        className={`group relative ${ROW_BASE} w-full text-left ${
          activeChild && !open ? ROW_ACTIVE : ROW_IDLE
        } ${collapsed ? "lg:justify-center lg:px-0" : ""}`}
      >
        {Icon && <Icon className="h-[18px] w-[18px] shrink-0" />}
        <span className={`flex-1 truncate ${collapsed ? "lg:hidden" : ""}`}>{item.label}</span>
        {badgeTotal > 0 && !open && (
          <span
            className={`shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[11px] font-semibold text-white/70 ${
              collapsed ? "lg:hidden" : ""
            }`}
          >
            {badgeTotal}
          </span>
        )}
        {badgeTotal > 0 && collapsed && (
          <span
            aria-hidden="true"
            className="absolute right-2 top-2 hidden h-2 w-2 rounded-full bg-accent-500 ring-2 ring-[#0B1B33] lg:block"
          />
        )}
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-white/40 transition-transform duration-200 ${
            open ? "rotate-180" : ""
          } ${collapsed ? "lg:hidden" : ""}`}
        />
        {collapsed && <RailTooltip label={item.label} />}
      </button>

      {/* Children render whenever the group is open; when the desktop rail is
          collapsed they're hidden at `lg` only, so the mobile drawer still
          reveals them (a globally-collapsed rail must not cripple the drawer). */}
      {open && (
        <div
          className={`ml-4 mt-1 space-y-1 border-l border-white/10 pl-2 ${
            collapsed ? "lg:hidden" : ""
          }`}
        >
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
