"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useUser } from "@/hooks/useUser";
import { Menu, Phone, X } from "lucide-react";
import BrandLogo from "@/components/BrandLogo";

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
  { label: "About", href: "/about" },
  { label: "Contact", href: "/contact" },
];

export default function Navbar() {
  const { profile, loading } = useUser();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const isDashboard = Object.values(ROLE_HOME).some((path) => pathname.startsWith(path.split("/dashboard")[0]));
  const isLanding = pathname === "/";
  const isAuthPage = pathname === "/login" || pathname === "/register";
  const useReferencePalette = isLanding || isAuthPage;
  const landingAccent = useReferencePalette ? "text-[#81EDF4]" : "text-brand-300";

  if (isDashboard) return null;

  // Home is active only at the exact root; every other item matches by prefix
  // so nested service pages keep their section lit. `Contact` is now a real
  // route (`/contact`), not a `mailto:`, so it can participate in this check.
  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <header className={`sticky top-0 z-50 ${useReferencePalette ? "bg-[#070D12]/95" : "bg-navy-900/95"} text-white shadow-sm backdrop-blur-md`}>
      <div className="mx-auto max-w-6xl px-4 md:px-6">
        <div className="relative z-10">
          <div className="flex h-16 items-center justify-between gap-2 sm:gap-4">
            <Link
              href={profile ? ROLE_HOME[profile.role] ?? "/" : "/"}
              aria-label="SPARKServ home"
              className="flex items-center gap-1.5 sm:gap-2.5"
            >
              <BrandLogo size={30} variant="light" />
              <span className="hidden flex-col min-[360px]:flex">
                  <span className="font-display text-base font-bold leading-none tracking-tight text-white sm:text-lg">
                  SPARK<span className={landingAccent}>Serv</span>
                </span>
                <small className="mt-1 hidden text-[8px] font-semibold uppercase leading-none tracking-[0.14em] text-white/55 sm:block">
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
                    className={`relative flex h-16 items-center text-[13px] font-semibold transition-colors duration-200 ${
                      isActive(item.href)
                        ? `text-white after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 ${useReferencePalette ? "after:bg-[#6D70F0]" : "after:bg-brand-400"}`
                        : "text-white/70 hover:text-white"
                    }`}
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
            )}

            <div className="flex shrink-0 items-center gap-2 sm:gap-3">
              {loading ? null : profile ? (
                <span className="hidden rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold capitalize text-white/85 sm:inline-flex">
                  {profile.role.replace("_", " ")}
                </span>
              ) : (
                <>
                  {!isLanding && (
                    <a href="tel:+639123456789" className="hidden items-center gap-2.5 pr-1 xl:flex">
                      <Phone className={`h-4 w-4 ${landingAccent}`} />
                      <span className="leading-tight">
                        <strong className="block text-xs font-bold text-white">+63 912 345 6789</strong>
                        <small className="block text-[9px] text-white/55">Call for Immediate Support</small>
                      </span>
                    </a>
                  )}
                  <Link
                    href="/login"
                    className="hidden h-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-white/25 px-5 text-xs font-semibold text-white/85 transition-colors duration-200 hover:border-white/50 hover:bg-white/10 hover:text-white sm:inline-flex"
                  >
                    Login
                  </Link>
                  <Link
                    href="/register"
                    className={`inline-flex h-10 shrink-0 cursor-pointer items-center justify-center rounded-full ${useReferencePalette ? "bg-[#6D70F0] hover:bg-[#8587FF]" : "bg-brand-500 hover:bg-brand-400"} px-5 text-xs font-semibold text-white transition-colors duration-200 sm:h-9`}
                  >
                    Sign Up
                  </Link>
                  <button
                    type="button"
                    aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
                    aria-expanded={menuOpen}
                    onClick={() => setMenuOpen((open) => !open)}
                    className="inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full border border-white/25 text-white/80 transition-colors duration-200 hover:border-white/50 hover:text-white sm:h-9 sm:w-9 lg:hidden"
                  >
                    {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
                  </button>
                </>
              )}
            </div>
          </div>
          {/* The mobile menu folds into the same navy bar so it reads as one
              navigation instead of two stacked headers. */}
          {!profile && !loading && menuOpen && (
            <nav className="border-t border-white/10 px-3 pb-3 pt-2 lg:hidden">
              <div className="flex flex-col gap-1">
                {NAV_ITEMS.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMenuOpen(false)}
                    aria-current={isActive(item.href) ? "page" : undefined}
                    className={`rounded-xl px-3 py-3 text-sm font-semibold transition-colors duration-200 ${
                      isActive(item.href)
                        ? "bg-white/10 text-white"
                        : "text-white/75 hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    {item.label}
                  </Link>
                ))}
                <Link
                  href="/login"
                  onClick={() => setMenuOpen(false)}
                  className="mt-1 rounded-xl border border-white/25 px-3 py-3 text-center text-sm font-semibold text-white/85 transition-colors duration-200 hover:border-white/50 hover:text-white"
                >
                  Login
                </Link>
                <Link
                  href="/register"
                  onClick={() => setMenuOpen(false)}
                  className="rounded-xl bg-brand-500 px-3 py-3 text-center text-sm font-semibold text-white transition-colors duration-200 hover:bg-brand-600"
                >
                  Sign Up
                </Link>
              </div>
            </nav>
          )}
        </div>
      </div>
    </header>
  );
}
