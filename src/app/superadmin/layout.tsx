import DashboardShell from "@/components/DashboardShell";

/**
 * Same reasoning as the admin workspace: these screens read live data with the
 * service-role client (no cookies, so no dynamic signal) and were being prerendered
 * as build-time snapshots. The activity log and the administrator list must reflect
 * the database as it is now.
 */
export const dynamic = "force-dynamic";

/** The super-admin workspace. Nav comes from `src/lib/navConfig.ts`. */
export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardShell role="super_admin">{children}</DashboardShell>
  );
}

