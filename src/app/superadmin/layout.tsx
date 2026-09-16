import Sidebar, { type SidebarNavItem } from "@/components/Sidebar";

const SUPERADMIN_NAV: SidebarNavItem[] = [
  { label: "Dashboard", href: "/superadmin/dashboard", icon: "gauge" },
  { label: "Administrators", href: "/superadmin/admins", icon: "history" },
  { label: "Technicians", href: "/admin/technicians", icon: "refrigerator" },
  { label: "All Users", href: "/admin/users", icon: "message" },
  { label: "Activity Log", href: "/superadmin/activity", icon: "clipboard" },
  { label: "System Settings", href: "/superadmin/settings", icon: "file" },
];

export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[calc(100vh-65px)]">
      <Sidebar items={SUPERADMIN_NAV} role="super_admin" />
      <div className="min-w-0 flex-1 bg-[#F5F7FB] px-4 py-5 sm:px-8 sm:py-6 lg:px-10">
        <div className="mx-auto max-w-7xl">{children}</div>
      </div>
    </div>
  );
}
