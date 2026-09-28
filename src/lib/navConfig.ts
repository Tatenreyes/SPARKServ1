import {
  Activity,
  Boxes,
  CalendarClock,
  CircleDollarSign,
  ClipboardList,
  Headset,
  LayoutDashboard,
  LifeBuoy,
  ListOrdered,
  MessageSquareText,
  Plus,
  Settings,
  ShieldCheck,
  Timer,
  UserRound,
  Users,
  Wrench,
} from "lucide-react";
import type { SidebarNavItem } from "@/components/Sidebar";
import type { UserRole } from "@/types/database";

/**
 * Sidebar navigation for all four workspaces.
 *
 * This lives in client code (it's only imported by `DashboardShell`, a client
 * component) because each item carries a lucide icon *component*, and functions
 * can't be serialized across the server/client boundary — a route layout can't
 * hand an array of icons down to a client shell. So layouts only declare their
 * `role`; the nav itself is resolved here.
 *
 * Every `href` below is unchanged from the per-route definitions this replaced.
 */
export function navForRole(role: UserRole): SidebarNavItem[] {
  switch (role) {
    case "technician":
      return [
        { label: "Dashboard", href: "/technician/dashboard", icon: LayoutDashboard },
        {
          label: "Pending Assignments",
          href: "/technician/estimate-requests",
          icon: ListOrdered,
        },
        { label: "My Jobs", href: "/technician/jobs", icon: Wrench },
        { label: "Queue / Schedule", href: "/technician/queue", icon: CalendarClock },
        { label: "Messages", href: "/technician/messages", icon: MessageSquareText },
        { label: "Profile & Availability", href: "/technician/profile", icon: UserRound },
      ];

    case "admin":
      return [
        { label: "Dashboard", href: "/admin/dashboard", icon: LayoutDashboard },
        { label: "Progress Management", href: "/admin/progress", icon: Activity },
        { label: "Technician Queue", href: "/admin/technician-queue", icon: ListOrdered },
        { label: "Job Monitoring", href: "/admin/job-monitoring", icon: Timer },
        { label: "Technicians", href: "/admin/technicians", icon: Users },
        { label: "User Management", href: "/admin/users", icon: UserRound },
        { label: "Booking Review", href: "/admin/bookings", icon: CalendarClock },
        { label: "Support Tickets", href: "/admin/support-tickets", icon: Headset },
        { label: "Transactions", href: "/admin/payments", icon: CircleDollarSign },
      ];

    case "super_admin":
      return [
        { label: "Dashboard", href: "/superadmin/dashboard", icon: LayoutDashboard },
        { label: "Administrators", href: "/superadmin/admins", icon: ShieldCheck },
        { label: "Technicians", href: "/admin/technicians", icon: Users },
        { label: "All Users", href: "/admin/users", icon: UserRound },
        { label: "Activity Log", href: "/superadmin/activity", icon: Activity },
        { label: "System Settings", href: "/superadmin/settings", icon: Settings },
      ];

    case "customer":
    default:
      return [
        { label: "Dashboard", href: "/customer/dashboard", icon: LayoutDashboard },
        { label: "My Appliances", href: "/customer/appliances", icon: Boxes },
        {
          label: "Service Requests",
          icon: Wrench,
          children: [
            { label: "Service Inquiry", href: "/customer/request-repair", icon: Plus },
            { label: "Estimates", href: "/customer/estimates", icon: ClipboardList },
            { label: "Bookings", href: "/customer/bookings", icon: CalendarClock },
            { label: "Repair Progress", href: "/customer/progress-tracking", icon: Timer },
            { label: "Service History", href: "/customer/repair-history", icon: ClipboardList },
          ],
        },
        {
          label: "Support & Feedback",
          icon: LifeBuoy,
          children: [
            { label: "Support Tickets", href: "/customer/support", icon: Headset },
            { label: "Messages", href: "/customer/messages", icon: MessageSquareText },
          ],
        },
      ];
  }
}
