"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import {
  CalendarDays,
  ClipboardList,
  FileText,
  Gauge,
  HelpCircle,
  History,
  LogOut,
  MessageSquare,
  Refrigerator,
  Wrench,
  UserCircle,
  ChevronDown,
  type LucideIcon,
} from "lucide-react";
import { useUser } from "@/hooks/useUser";
import { createClient } from "@/lib/supabase/client";
import LoadingScreen from "@/components/LoadingScreen";
import NotificationBell from "@/components/NotificationBell";
import BrandLogo from "@/components/BrandLogo";

export interface SidebarNavItem {
  label: string;
  href?: string;
  icon?: SidebarIconName;
  children?: SidebarNavItem[];
}

export type SidebarIconName =
  | "calendar"
  | "clipboard"
  | "file"
  | "gauge"
  | "help"
  | "history"
  | "message"
  | "refrigerator"
  | "wrench"
  | "profile"
  | "settings";

const SIDEBAR_ICONS: Record<SidebarIconName, LucideIcon> = {
  calendar: CalendarDays,
  clipboard: ClipboardList,
  file: FileText,
  gauge: Gauge,
  help: HelpCircle,
  history: History,
  message: MessageSquare,
  refrigerator: Refrigerator,
  wrench: Wrench,
  profile: UserCircle,
  settings: UserCircle,
};

interface SidebarProps {
  items: SidebarNavItem[];
  role?: "customer" | "technician" | "admin" | "super_admin";
}

const ROLE_STYLES = {
  customer: { shell: "bg-[#071D35]", active: "bg-[#1264D6]", accent: "text-[#6FB4FF]" },
  technician: { shell: "bg-[#21124D]", active: "bg-[#6F3FC2]", accent: "text-[#C5A7FF]" },
  admin: { shell: "bg-[#063A3D]", active: "bg-[#078A74]", accent: "text-[#6DE3C3]" },
  super_admin: { shell: "bg-[#3B0817]", active: "bg-[#E42F47]", accent: "text-[#FF9AA8]" },
} as const;

export default function Sidebar({ items, role = "customer" }: SidebarProps) {
  const pathname = usePathname();
  const { profile } = useUser();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);
  const roleStyle = ROLE_STYLES[role];
  const profileHref = role === "customer" ? "/customer/profile" : role === "technician" ? "/technician/profile" : null;

  async function handleSignOut() {
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <>
      {signingOut && <LoadingScreen message="Signing you out..." />}
      <aside className={`border-b border-white/10 text-white md:min-h-screen md:w-60 md:shrink-0 md:border-b-0 md:border-r ${roleStyle.shell}`}>
        <div className="flex h-full flex-col gap-6 px-3 py-4 md:px-3 md:py-5">
          <div className="border-b border-white/10 px-2 pb-5">
            <div className="flex items-center justify-between">
              <p className="flex items-center gap-2 text-sm font-bold tracking-tight">
                <BrandLogo size={28} className="rounded-lg" />
                SPARKServ
              </p>
            </div>
            {profileHref ? (
              <div className="mt-3 flex items-center gap-2">
                <Link href={profileHref} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-1 -mx-1 transition hover:bg-white/10">
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/10 text-sm font-bold ${roleStyle.accent}`}
                    style={profile?.avatar_url ? { backgroundImage: `url(${profile.avatar_url})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
                  >
                    {!profile?.avatar_url && (profile?.name?.charAt(0)?.toUpperCase() ?? "S")}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">{profile?.name ?? "Welcome"}</p>
                    <p className="truncate text-[11px] capitalize text-white/50">
                      {profile?.role.replace("_", " ") ?? "Member"}
                    </p>
                  </div>
                </Link>
                {profile && (
                  <div className="text-white [&_svg]:text-white/70 [&_button]:hover:bg-white/10">
                    <NotificationBell userId={profile.id} />
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-3 flex items-center gap-2">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/10 text-sm font-bold ${roleStyle.accent}`}
                    style={profile?.avatar_url ? { backgroundImage: `url(${profile.avatar_url})`, backgroundSize: "cover", backgroundPosition: "center" } : undefined}
                  >
                    {!profile?.avatar_url && (profile?.name?.charAt(0)?.toUpperCase() ?? "S")}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-white">{profile?.name ?? "Welcome"}</p>
                    <p className="truncate text-[11px] capitalize text-white/50">
                      {profile?.role.replace("_", " ") ?? "Member"}
                    </p>
                  </div>
                </div>
                {profile && (
                  <div className="text-white [&_svg]:text-white/70 [&_button]:hover:bg-white/10">
                    <NotificationBell userId={profile.id} />
                  </div>
                )}
              </div>
            )}
          </div>

          <nav className="grid grid-cols-2 gap-2 pb-1 md:flex md:flex-col md:overflow-visible">
            {items.map((item) => {
              if (item.children) {
                return <SidebarGroup key={item.label} item={item} pathname={pathname} roleStyle={roleStyle} />;
              }
              const active = pathname === item.href || (item.href && item.href !== "/" && pathname.startsWith(`${item.href}/`));
              return (
                <Link
                  key={item.href}
                  href={item.href!}
                  className={`flex min-w-0 items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition md:w-full ${
                    active
                      ? `${roleStyle.active} text-white shadow-lg`
                      : "text-white/60 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  {item.icon && (() => {
                    const Icon = SIDEBAR_ICONS[item.icon];
                    return <Icon className="h-4 w-4 shrink-0" />;
                  })()}
                  <span className="truncate">{item.label}</span>
                </Link>
              );
            })}
          </nav>

          <button
            onClick={handleSignOut}
            className="mt-auto flex items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-medium text-white/55 transition hover:bg-white/10 hover:text-white"
          >
            <LogOut className="h-4 w-4" />
            <span>Log out</span>
          </button>
        </div>
      </aside>
    </>
  );
}

function SidebarGroup({ item, pathname, roleStyle }: { item: SidebarNavItem; pathname: string; roleStyle: { active: string; accent: string } }) {
  const [open, setOpen] = useState(false);
  const activeChild = item.children?.some((child) => pathname === child.href || (child.href && child.href !== "/" && pathname.startsWith(`${child.href}/`)));
  const Icon = item.icon ? SIDEBAR_ICONS[item.icon] : null;

  return (
    <div className="md:w-full">
      <button
        onClick={() => setOpen((prev) => !prev)}
        className={`flex min-w-0 w-full items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-medium transition ${
          activeChild ? `${roleStyle.active} text-white shadow-lg` : "text-white/60 hover:bg-white/10 hover:text-white"
        }`}
      >
        {Icon && <Icon className="h-4 w-4 shrink-0" />}
        <span className="truncate flex-1 text-left">{item.label}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="mt-1 ml-4 grid grid-cols-2 gap-2 md:flex md:flex-col md:ml-3">
          {item.children?.map((child) => {
            const active = pathname === child.href || (child.href && child.href !== "/" && pathname.startsWith(`${child.href}/`));
            return (
              <Link
                key={child.href}
                href={child.href!}
                className={`flex min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition md:w-full ${
                  active
                    ? `${roleStyle.active} text-white shadow-lg`
                    : "text-white/60 hover:bg-white/10 hover:text-white"
                }`}
              >
                {child.icon && (() => {
                  const ChildIcon = SIDEBAR_ICONS[child.icon];
                  return <ChildIcon className="h-4 w-4 shrink-0" />;
                })()}
                <span className="truncate">{child.label}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
