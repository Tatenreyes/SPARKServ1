import Sidebar, { type SidebarNavItem } from "@/components/Sidebar";

const ADMIN_NAV: SidebarNavItem[] = [
  { label: "Dashboard", href: "/admin/dashboard", icon: "gauge" },
  { label: "Progress Management", href: "/admin/progress", icon: "clipboard" },
  { label: "Technician Queue", href: "/admin/technician-queue", icon: "gauge" },
  { label: "Job Monitoring", href: "/admin/job-monitoring", icon: "wrench" },
  { label: "Technicians", href: "/admin/technicians", icon: "refrigerator" },
  { label: "User Management", href: "/admin/users", icon: "message" },
  { label: "Booking Review", href: "/admin/bookings", icon: "calendar" },
  { label: "Support Tickets", href: "/admin/support-tickets", icon: "help" },
  { label: "Transactions", href: "/admin/payments", icon: "file" },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[calc(100vh-65px)]">
      <Sidebar items={ADMIN_NAV} role="admin" />
      <div className="min-w-0 flex-1 bg-[#F5F7FB] px-4 py-5 sm:px-8 sm:py-6 lg:px-10">
        <div className="mx-auto max-w-7xl">{children}</div>
      </div>
    </div>
  );
}
