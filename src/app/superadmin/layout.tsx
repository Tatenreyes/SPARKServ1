import DashboardShell from "@/components/DashboardShell";

/** The super-admin workspace. Nav comes from `src/lib/navConfig.ts`. */
export default function SuperAdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardShell role="super_admin">{children}</DashboardShell>
  );
}

