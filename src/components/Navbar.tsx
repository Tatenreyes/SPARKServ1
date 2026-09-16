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
  { label: "About Us", href: "/about" },
  { label: "Contact", href: "mailto:support@sparkserv.com" },
];

export default function Navbar() {
  const { profile, loading } = useUser();
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const isDashboard = Object.values(ROLE_HOME).some((path) => pathname.startsWith(path.split("/dashboard")[0]));

  if (isDashboard) return null;

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200 bg-white/95 text-slate-900 backdrop-blur">
      <div className="spark-section flex h-16 items-center justify-between gap-3">
        <Link
          href={profile ? ROLE_HOME[profile.role] ?? "/" : "/"}
          className="flex items-center gap-2 font-display text-lg font-bold tracking-tight text-brand-700"
        >
          <BrandLogo size={32} className="rounded-lg shadow-soft" />
          <span className="min-w-0 truncate">
            SPARK<span className="text-brand-500">Serv</span>
            <small className="ml-2 hidden text-[7px] font-medium leading-none tracking-normal text-slate-500 sm:block">Appliance Repair &amp; Maintenance</small>
          </span>
        </Link>

        {!profile && !loading && !isDashboard && (
          <nav className="hidden items-center gap-7 md:flex">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-sm font-semibold text-slate-600 transition hover:text-brand-600"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        )}

        <div className="flex items-center gap-2 sm:gap-3">
          {loading || isDashboard ? null : profile ? (
            <span className="hidden rounded-full border border-brand-200 bg-brand-50 px-3 py-1.5 text-xs font-semibold capitalize text-brand-700 sm:inline-flex">
              {profile.role.replace("_", " ")}
            </span>
          ) : (
            <>
              <a href="tel:+639123456789" className="hidden items-center gap-2 px-2 text-right sm:flex">
                <Phone className="h-4 w-4 text-brand-700" />
                <span><strong className="block text-xs text-slate-800">+63 912 345 6789</strong><small className="block text-[9px] text-slate-500">Call for Immediate Support</small></span>
              </a>
              <Link href="/login" className="hidden rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 transition hover:border-brand-400 hover:text-brand-600 sm:inline-flex">
                Login
              </Link>
              <Link href="/register" className="inline-flex h-9 items-center justify-center rounded-lg bg-brand-600 px-4 text-xs font-semibold text-white transition hover:bg-brand-700">
                Sign Up
              </Link>
              <button
                type="button"
                aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
                aria-expanded={menuOpen}
                onClick={() => setMenuOpen((open) => !open)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-slate-300 text-slate-700 transition hover:border-brand-400 hover:text-brand-600 md:hidden"
              >
                {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
              </button>
            </>
          )}
        </div>
      </div>
      {!profile && !loading && menuOpen && (
        <nav className="border-t border-slate-100 bg-white px-4 py-3 md:hidden">
          <div className="mx-auto flex max-w-6xl flex-col gap-1">
            {NAV_ITEMS.map((item) => (
              <Link key={item.href} href={item.href} onClick={() => setMenuOpen(false)} className="rounded-lg px-3 py-3 text-sm font-semibold text-slate-700 hover:bg-brand-50 hover:text-brand-600">
                {item.label}
              </Link>
            ))}
            <Link href="/login" onClick={() => setMenuOpen(false)} className="mt-1 rounded-lg border border-slate-200 px-3 py-3 text-center text-sm font-semibold text-slate-700">Log in</Link>
          </div>
        </nav>
      )}
    </header>
  );
}
