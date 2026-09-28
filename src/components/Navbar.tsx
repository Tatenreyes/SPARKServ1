"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useUser } from "@/hooks/useUser";
import { Menu, Phone, X } from "lucide-react";
import BrandLogo from "@/components/BrandLogo";
import ThemeToggle from "@/components/ThemeToggle";

const ROLE_HOME: Record<string, string> = {
  customer: "/customer/dashboard",
  technician: "/technician/dashboard",
  admin: "/admin/dashboard",
  super_admin: "/superadmin/dashboard",
};

const NAV_ITEMS = [
  { label: "Home", href: "/" },
  { label: "Services", href: "/services" },
  { label: "How It Works", href: "/how-it-works" },
  { label: "About Us", href: "/about" },
  { label: "Contact", href: "mailto:support@sparkserv.com" },
];

export default function Navbar() {
  const { profile, loading } = useUser();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const isDashboard = Object.values(ROLE_HOME).some((path) => pathname.startsWith(path.split("/dashboard")[0]));

  if (isDashboard) return null;

  // `Contact` is a `mailto:`, which `usePathname` can never match — excluding it
  // stops that link rendering as permanently active.
  const isActive = (href: string) =>
    href !== "/" && !href.startsWith("mailto:") && pathname.startsWith(href);

  return (
    <header className="sticky top-0 z-50 bg-surface/85 backdrop-blur-md">
      <div className="spark-section py-3">
        {/* The mockup floats the bar on its own white plate rather than bleeding
            it edge to edge. With no full-width rule, the border + soft shadow is
            what separates chrome from content, and the translucent header keeps
            the card legible as content scrolls behind it. */}
        <div className="relative z-10 rounded-2xl border border-line bg-surface shadow-[0_12px_30px_-16px_rgba(16,38,74,0.4)]">
          <div className="flex h-16 items-center justify-between gap-4 px-4 md:px-6">
            <Link
              href={profile ? ROLE_HOME[profile.role] ?? "/" : "/"}
              className="flex items-center gap-2.5"
            >
              {/* No rounding or shadow on the plate: the source PNG is opaque
                  white, so a shadow paints a grey square halo behind the mark. */}
              <BrandLogo size={36} className="rounded-xl" />
              <span className="flex flex-col">
                <span className="font-display text-lg font-bold leading-none tracking-tight text-brand-ink">
                  SPARK<span className="text-brand-ink">Serv</span>
                </span>
                <small className="mt-1 hidden text-[8px] font-semibold uppercase leading-none tracking-[0.14em] text-muted sm:block">
                  Appliance Repair &amp; Maintenance
                </small>
              </span>
            </Link>

            {!profile && !loading && (
              <nav className="hidden items-center gap-6 lg:flex">
                {NAV_ITEMS.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={isActive(item.href) ? "page" : undefined}
                    className={`text-[13px] font-semibold transition-colors duration-200 hover:text-brand-ink ${
                      isActive(item.href) ? "text-brand-ink" : "text-muted"
                    }`}
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
            )}

            <div className="flex items-center gap-2 sm:gap-3">
              <ThemeToggle />
              {loading ? null : profile ? (
                <span className="hidden rounded-full border border-line bg-brand-soft px-3 py-1.5 text-xs font-semibold capitalize text-brand-ink sm:inline-flex">
                  {profile.role.replace("_", " ")}
                </span>
              ) : (
                <>
                  <a href="tel:+639123456789" className="hidden items-center gap-2.5 pr-1 xl:flex">
                    <Phone className="h-4 w-4 text-brand-ink" />
                    <span className="leading-tight">
                      <strong className="block text-xs font-bold text-ink">+63 912 345 6789</strong>
                      <small className="block text-[9px] text-muted">Call for Immediate Support</small>
                    </span>
                  </a>
                  <Link
                    href="/login"
                    className="hidden h-9 cursor-pointer items-center justify-center rounded-full border border-ink/20 px-5 text-xs font-semibold text-ink/80 transition-colors duration-200 hover:border-brand-400 hover:text-brand-ink sm:inline-flex"
                  >
                    Login
                  </Link>
                  <Link
                    href="/register"
                    className="inline-flex h-9 cursor-pointer items-center justify-center rounded-full bg-brand-500 px-5 text-xs font-semibold text-white transition-colors duration-200 hover:bg-brand-600"
                  >
                    Sign Up
                  </Link>
                  <button
                    type="button"
                    aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
                    aria-expanded={menuOpen}
                    onClick={() => setMenuOpen((open) => !open)}
                    className="inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-ink/20 text-ink/80 transition-colors duration-200 hover:border-brand-400 hover:text-brand-ink lg:hidden"
                  >
                    {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
                  </button>
                </>
              )}
            </div>
          </div>
          {/* The mobile menu folds into the same card. It used to render as a
              second full-width bar under the header, which read as two stacked
              navigations. */}
          {!profile && !loading && menuOpen && (
            <nav className="border-t border-line px-3 pb-3 pt-2 lg:hidden">
              <div className="flex flex-col gap-1">
                {NAV_ITEMS.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMenuOpen(false)}
                    aria-current={isActive(item.href) ? "page" : undefined}
                    className={`rounded-xl px-3 py-3 text-sm font-semibold transition-colors duration-200 ${
                      isActive(item.href)
                        ? "bg-brand-soft text-brand-ink"
                        : "text-ink/80 hover:bg-soft hover:text-brand-ink"
                    }`}
                  >
                    {item.label}
                  </Link>
                ))}
                <Link
                  href="/login"
                  onClick={() => setMenuOpen(false)}
                  className="mt-1 rounded-xl border border-line px-3 py-3 text-center text-sm font-semibold text-ink/80 transition-colors duration-200 hover:border-brand-300 hover:text-brand-ink"
                >
                  Log in
                </Link>
              </div>
            </nav>
          )}
        </div>
      </div>
    </header>
  );
}
