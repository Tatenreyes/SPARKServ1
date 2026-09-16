import Sidebar, { type SidebarNavItem } from "@/components/Sidebar";

const TECHNICIAN_NAV: SidebarNavItem[] = [
  { label: "Dashboard", href: "/technician/dashboard", icon: "gauge" },
  { label: "Pending Assignments", href: "/technician/estimate-requests", icon: "file" },
  { label: "My Jobs", href: "/technician/jobs", icon: "wrench" },
  { label: "Messages", href: "/technician/messages", icon: "message" },
];

export default function TechnicianLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[calc(100vh-65px)]">
      <Sidebar items={TECHNICIAN_NAV} role="technician" />
      <div className="min-w-0 flex-1 bg-[#F5F7FB] px-4 py-5 sm:px-8 sm:py-6 lg:px-10">
        <div className="mx-auto max-w-7xl">{children}</div>
      </div>
    </div>
  );
}
