import {
  Activity,
  Boxes,
  CalendarClock,
  CircleDollarSign,
  ClipboardList,
  Headset,
  Home,
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
import type { LucideIcon } from "lucide-react";
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
        { label: "Support Tickets", href: "/admin/support-tickets", icon: Headset },
        { label: "Transactions", href: "/admin/payments", icon: CircleDollarSign },
      ];

    case "super_admin":
      return [
        { label: "Dashboard", href: "/superadmin/dashboard", icon: LayoutDashboard },
        { label: "Administrators", href: "/superadmin/admins", icon: ShieldCheck },
        { label: "Technicians", href: "/admin/technicians", icon: Users },
        { label: "All Users", href: "/admin/users", icon: UserRound },
        // Verifying a GCash reference is what completes a repair, and /admin is
        // reachable for a super_admin — but without this entry there was no link to
        // it anywhere in this navigation, so the only way to finish a repair was to
        // type the URL.
        { label: "Transactions", href: "/admin/payments", icon: CircleDollarSign },
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
            // The index of the section: every request this customer has submitted.
            // It was reachable from the dashboard tile and the phone hub, but the
            // sidebar had no entry for it at all.
            { label: "Repair Requests", href: "/customer/repairs/requests", icon: ClipboardList },
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

/** One destination in the mobile bottom navigation. */
export interface BottomNavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  /**
   * Additional route prefixes that should keep this tab highlighted.
   *
   * A tab points at a section hub, but the section's real pages live under
   * different paths (`/customer/estimates`, `/customer/bookings`, …). Without
   * this, opening an estimate would light no tab at all and the phone would lose
   * its sense of place. Routes are matched by prefix, longest first — see
   * `MobileBottomNav`.
   */
  alsoMatches?: string[];
}

/**
 * The four primary destinations for the mobile bottom navigation.
 *
 * Deliberately four, and deliberately not the full sidebar: a bottom bar is a
 * thumb-reachable shortcut, and every extra tab shrinks the tap target until it
 * stops being reachable. Everything else stays one tap deeper, through its
 * section hub, or in the slide-out drawer behind the hamburger.
 *
 * Role-specific because the four things a customer, a technician and an
 * administrator need at a glance are genuinely different jobs.
 */
export function bottomNavForRole(role: UserRole): BottomNavItem[] {
  switch (role) {
    case "technician":
      return [
        {
          label: "Home",
          href: "/technician/dashboard",
          icon: Home,
          alsoMatches: ["/technician/dashboard"],
        },
        {
          label: "Jobs",
          href: "/technician/jobs",
          icon: Wrench,
          alsoMatches: ["/technician/jobs", "/technician/estimate-requests"],
        },
        {
          label: "Schedule",
          href: "/technician/queue",
          icon: CalendarClock,
          alsoMatches: ["/technician/queue", "/technician/bookings"],
        },
        {
          label: "Me",
          href: "/technician/profile",
          icon: UserRound,
          alsoMatches: ["/technician/profile", "/technician/messages"],
        },
      ];

    case "admin":
      return [
        { label: "Home", href: "/admin/dashboard", icon: Home },
        {
          label: "Repairs",
          href: "/admin/progress",
          icon: Activity,
          alsoMatches: [
            "/admin/progress",
            "/admin/job-monitoring",
            "/admin/bookings",
          ],
        },
        {
          label: "Queue",
          href: "/admin/technician-queue",
          icon: ListOrdered,
          alsoMatches: ["/admin/technician-queue", "/admin/technicians"],
        },
        {
          label: "Payments",
          href: "/admin/payments",
          icon: CircleDollarSign,
          alsoMatches: ["/admin/payments"],
        },
      ];

    case "super_admin":
      return [
        { label: "Home", href: "/superadmin/dashboard", icon: Home },
        {
          label: "Admins",
          href: "/superadmin/admins",
          icon: ShieldCheck,
          alsoMatches: ["/superadmin/admins"],
        },
        {
          label: "Payments",
          href: "/admin/payments",
          icon: CircleDollarSign,
          alsoMatches: ["/admin/payments"],
        },
        {
          label: "Audit",
          href: "/superadmin/activity",
          icon: Activity,
          alsoMatches: ["/superadmin/activity"],
        },
        {
          label: "Settings",
          href: "/superadmin/settings",
          icon: Settings,
          alsoMatches: ["/superadmin/settings"],
        },
      ];

    case "customer":
    default:
      return [
        { label: "Home", href: "/customer/dashboard", icon: Home },
        {
          label: "Repairs",
          href: "/customer/repairs",
          icon: Wrench,
          alsoMatches: [
            "/customer/repairs",
            "/customer/request-repair",
            "/customer/service-request",
            "/customer/estimates",
            "/customer/bookings",
            "/customer/progress-tracking",
            "/customer/repair-history",
          ],
        },
        {
          label: "Support",
          href: "/customer/support",
          icon: LifeBuoy,
          alsoMatches: ["/customer/support", "/customer/messages"],
        },
        {
          label: "Me",
          href: "/customer/account",
          icon: UserRound,
          alsoMatches: ["/customer/account", "/customer/appliances", "/customer/profile"],
        },
      ];
  }
}

/**
 * Routes that own the bottom of the phone screen themselves with a sticky
 * primary action, so the bottom navigation steps aside.
 *
 * Two fixed bars stacked on a phone spend roughly 120px of a ~700px viewport —
 * more than a sixth of the screen — and the submit button is the one control
 * that must never compete with a tab bar for attention. The content column swaps
 * its bottom-navigation clearance for the taller sticky-action clearance on the
 * same condition, so nothing is either hidden or left with a dead gap.
 */
const IMMERSIVE_ROUTES = ["/customer/request-repair"];

export function isImmersiveRoute(pathname: string): boolean {
  return IMMERSIVE_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`)
  );
}
