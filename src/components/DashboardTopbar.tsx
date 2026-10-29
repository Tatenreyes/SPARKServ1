"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Settings, UserRound, X } from "lucide-react";
import BrandLogo from "@/components/BrandLogo";
import NotificationBell from "@/components/NotificationBell";
import PlatformAnnouncementTicker from "@/components/PlatformAnnouncementTicker";
import LoadingScreen from "@/components/LoadingScreen";
import { useUser } from "@/hooks/useUser";
import { signOut } from "@/lib/signOut";
import type { DashboardRole } from "@/components/DashboardShell";
import { ROLE_HOME, ROLE_LABEL, ROLE_PROFILE_HREF, ROLE_SETTINGS_HREF } from "@/lib/roleMeta";

/**
 * Brand, notifications and the signed-in user, in one sticky bar above the
 * workspace — plus the platform announcement, when there is one, as a scrolling
 * strip along its bottom edge.
 *
 * The announcement lives here rather than in a page because it is platform-wide:
 * every workspace shares this bar, so publishing one reaches all four roles
 * without a per-route change.
 */
export default function DashboardTopbar({
  role,
  menuOpen,
  onMenuToggle,
  collapsed,
  onToggleCollapsed,
  announcement,
  onDismissAnnouncement,
}: {
  role: DashboardRole;
  menuOpen: boolean;
  onMenuToggle: () => void;
  /** Desktop rail collapsed state, owned by `DashboardShell`. */
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /**
   * The platform announcement to scroll, or `""` for none. Resolved by
   * `DashboardShell` from `usePlatformAnnouncement`, so the shell also knows
   * whether the bar is currently taller than its 64px base.
   */
  announcement: string;
  /** Hide the announcement for the rest of this browser session. */
  onDismissAnnouncement: () => void;
}) {
  const { profile } = useUser();
  const router = useRouter();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Dismiss the user menu on outside click or Escape — a dropdown that can only
  // be closed by re-clicking its trigger is a common a11y annoyance.
  useEffect(() => {
    if (!userMenuOpen) return;

    function handlePointerDown(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setUserMenuOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [userMenuOpen]);

  async function handleSignOut() {
    setSigningOut(true);
    await signOut(router);
  }

  const profileHref = ROLE_PROFILE_HREF[role];
  const settingsHref = ROLE_SETTINGS_HREF[role];

  return (
    <>
      {signingOut && <LoadingScreen message="Signing you out..." />}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#070D12]/95 text-white shadow-sm backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-[1800px] items-center gap-3 px-4 sm:px-6 lg:px-8">
          {/* Desktop rail collapse toggle. Its own control, distinct from the
              hamburger below (which only opens the mobile drawer): the rail is a
              persistent part of the desktop layout, so collapsing it is a
              first-class action, not a mobile-only affordance. */}
          <button
            type="button"
            onClick={onToggleCollapsed}
            aria-label={collapsed ? "Expand navigation sidebar" : "Collapse navigation sidebar"}
            aria-expanded={!collapsed}
            aria-controls="dashboard-sidebar"
            className="hidden h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-white/20 text-white/75 transition hover:border-white/40 hover:bg-white/10 hover:text-white lg:inline-flex"
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>

          <button
            type="button"
            onClick={onMenuToggle}
            aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={menuOpen}
            aria-controls="dashboard-sidebar"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/20 text-white/75 transition hover:border-white/40 hover:bg-white/10 hover:text-white lg:hidden"
          >
            {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>

          <Link
            href={ROLE_HOME[role]}
            aria-label="SPARKServ dashboard home"
            className="flex min-w-0 items-center gap-2 font-display text-base font-bold tracking-tight text-white"
          >
            <BrandLogo size={28} variant="light" />
            <span className="truncate">
              SPARK<span className="text-[#81EDF4]">Serv</span>
            </span>
          </Link>

          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            {profile && <NotificationBell userId={profile.id} />}

            {profile && (
              <div className="relative" ref={menuRef}>
                <button
                  type="button"
                  onClick={() => setUserMenuOpen((open) => !open)}
                  aria-haspopup="menu"
                  aria-expanded={userMenuOpen}
                    className="flex cursor-pointer items-center gap-2 rounded-xl px-1.5 py-1.5 transition hover:bg-white/10 sm:pr-2.5"
                >
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-soft text-sm font-bold text-brand-ink ring-1 ring-line"
                    style={
                      profile.avatar_url
                        ? {
                            backgroundImage: `url(${profile.avatar_url})`,
                            backgroundSize: "cover",
                            backgroundPosition: "center",
                          }
                        : undefined
                    }
                  >
                    {!profile.avatar_url && (profile.name?.charAt(0)?.toUpperCase() ?? "S")}
                  </span>
                  <span className="hidden min-w-0 text-left sm:block">
                    <span className="block max-w-[9rem] truncate text-xs font-semibold text-white">
                      {profile.name ?? "Welcome"}
                    </span>
                    <span className="block text-[11px] text-white/60">{ROLE_LABEL[role]}</span>
                  </span>
                  <ChevronDown
                    className={`hidden h-3.5 w-3.5 text-white/60 transition-transform duration-200 sm:block ${
                      userMenuOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>

                {userMenuOpen && (
                  <div
                    role="menu"
                    className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-card border border-line bg-surface p-1.5 shadow-card"
                  >
                    <div className="border-b border-line px-3 pb-2.5 pt-2">
                      <p className="truncate text-sm font-semibold text-ink">
                        {profile.name ?? "Signed in"}
                      </p>
                      <p className="truncate text-[11px] text-muted">{profile.email}</p>
                    </div>

                    {profileHref && (
                      <Link
                        href={profileHref}
                        role="menuitem"
                        onClick={() => setUserMenuOpen(false)}
                        className="mt-1 flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-ink/80 transition hover:bg-brand-soft hover:text-brand-ink"
                      >
                        <UserRound className="h-4 w-4 text-muted/80" />
                        Profile
                      </Link>
                    )}

                    {settingsHref && (
                      <Link
                        href={settingsHref}
                        role="menuitem"
                        onClick={() => setUserMenuOpen(false)}
                        className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm font-medium text-ink/80 transition hover:bg-brand-soft hover:text-brand-ink"
                      >
                        <Settings className="h-4 w-4 text-muted/80" />
                        Settings
                      </Link>
                    )}

                    <button
                      type="button"
                      role="menuitem"
                      onClick={handleSignOut}
                      className="flex w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium text-ink/80 transition hover:bg-alert-soft hover:text-alert-ink"
                    >
                      <LogOut className="h-4 w-4 text-muted/80" />
                      Log out
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* The platform announcement, when one is published and not dismissed.
            Inside the sticky header rather than below it: a strip rendered as a
            sibling would scroll away from the bar it belongs to. `h-8` is
            deliberate — the sidebar's sticky offset and the request wizard's
            `top-24` are both written against a 64px + 32px header. */}
        {announcement && (
          <PlatformAnnouncementTicker message={announcement} onDismiss={onDismissAnnouncement} />
        )}
      </header>
    </>
  );
}
