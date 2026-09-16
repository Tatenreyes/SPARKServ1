import Sidebar, { type SidebarNavItem } from "@/components/Sidebar";

const CUSTOMER_NAV: SidebarNavItem[] = [
  { label: "Overview", href: "/customer/dashboard", icon: "gauge" },
  { label: "Start a repair", href: "/customer/inquiry", icon: "wrench" },
  { label: "My bookings", href: "/customer/bookings", icon: "calendar" },
  { label: "Estimates", href: "/customer/estimates", icon: "file" },
  { label: "Repair progress", href: "/customer/progress-tracking", icon: "clipboard" },
  { label: "Messages", href: "/customer/messages", icon: "message" },
  { label: "My appliances", href: "/customer/appliances", icon: "refrigerator" },
  { label: "Support", href: "/customer/support", icon: "help" },
  { label: "Repair history", href: "/customer/repair-history", icon: "history" },
];

export default function CustomerLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-[calc(100vh-65px)]">
      <Sidebar items={CUSTOMER_NAV} role="customer" />
      <div className="min-w-0 flex-1 bg-[#F5F7FB] px-4 py-5 sm:px-8 sm:py-6 lg:px-10">
        <div className="mx-auto max-w-7xl">{children}</div>
      </div>
    </div>
  );
}
