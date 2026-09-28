"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, LogOut, Menu, UserRound, X } from "lucide-react";
import BrandLogo from "@/components/BrandLogo";
import NotificationBell from "@/components/NotificationBell";
import ThemeToggle from "@/components/ThemeToggle";
import LoadingScreen from "@/components/LoadingScreen";
import { useUser } from "@/hooks/useUser";
import { signOut } from "@/lib/signOut";
import type { DashboardRole } from "@/components/DashboardShell";
import { ROLE_DOT, ROLE_HOME, ROLE_LABEL, ROLE_PROFILE_HREF } from "@/lib/roleMeta";

/**
 * Brand, notifications and the signed-in user, in one sticky bar above the
 * workspace. The role is stated once here (coloured dot + label) so every
 * dashboard gets identical chrome instead of a different-coloured shell per
 * role.
 */
export default function DashboardTopbar({
  role,
  menuOpen,
  onMenuToggle,
}: {
  role: DashboardRole;
  menuOpen: boolean;
  onMenuToggle: () => void;
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

  return (
    <>
      {signingOut && <LoadingScreen message="Signing you out..." />}
      <header className="sticky top-0 z-40 border-b border-line bg-surface/95 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-[1400px] items-center gap-3 px-4 sm:px-6 lg:px-8">
          <button
            type="button"
            onClick={onMenuToggle}
            aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
            aria-expanded={menuOpen}
            aria-controls="dashboard-sidebar"
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line text-muted transition hover:border-brand-300 hover:bg-brand-soft hover:text-brand-ink md:hidden"
          >
            {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
          </button>

          <Link
            href={ROLE_HOME[role]}
            className="flex min-w-0 items-center gap-2 font-display text-base font-bold tracking-tight text-brand-ink"
          >
            <BrandLogo size={30} className="rounded-lg" />
            <span className="truncate">
              SPARK<span className="text-brand-ink">Serv</span>
            </span>
          </Link>

          <span className="hidden items-center gap-1.5 rounded-full border border-line bg-soft px-2.5 py-1 text-[11px] font-semibold text-muted sm:inline-flex">
            <span className={`h-1.5 w-1.5 rounded-full ${ROLE_DOT[role]}`} aria-hidden="true" />
            {ROLE_LABEL[role]}
          </span>

          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <ThemeToggle />
            {profile && <NotificationBell userId={profile.id} />}

            {profile && (
              <div className="relative" ref={menuRef}>
                <button
                  type="button"
                  onClick={() => setUserMenuOpen((open) => !open)}
                  aria-haspopup="menu"
                  aria-expanded={userMenuOpen}
                  className="flex cursor-pointer items-center gap-2 rounded-xl px-1.5 py-1.5 transition hover:bg-soft sm:pr-2.5"
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
                    <span className="block max-w-[9rem] truncate text-xs font-semibold text-ink">
                      {profile.name ?? "Welcome"}
                    </span>
                    <span className="block text-[11px] text-muted">{ROLE_LABEL[role]}</span>
                  </span>
                  <ChevronDown
                    className={`hidden h-3.5 w-3.5 text-muted/80 transition-transform duration-200 sm:block ${
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
                        Profile &amp; settings
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
      </header>
    </>
  );
}
