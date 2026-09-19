import Sidebar, { type SidebarNavItem } from "@/components/Sidebar";

const CUSTOMER_NAV: SidebarNavItem[] = [
  { label: "Dashboard", href: "/customer/dashboard", icon: "gauge" },
  {
    label: "Account & Appliances",
    icon: "refrigerator",
    children: [
      { label: "My Appliances", href: "/customer/appliances", icon: "refrigerator" },
      { label: "Profile", href: "/customer/profile", icon: "profile" },
    ],
  },
  {
    label: "Service Requests",
    icon: "wrench",
    children: [
      { label: "Service Inquiry", href: "/customer/request-repair", icon: "wrench" },
      { label: "Repair Requests", href: "/customer/service-request", icon: "file" },
      { label: "Estimates", href: "/customer/estimates", icon: "file" },
      { label: "Bookings", href: "/customer/bookings", icon: "calendar" },
      { label: "Repair Progress", href: "/customer/progress-tracking", icon: "clipboard" },
      { label: "Service History", href: "/customer/repair-history", icon: "history" },
    ],
  },
  {
    label: "Support & Feedback",
    icon: "help",
    children: [
      { label: "Support Tickets", href: "/customer/support", icon: "help" },
      { label: "Messages", href: "/customer/messages", icon: "message" },
    ],
  },
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
