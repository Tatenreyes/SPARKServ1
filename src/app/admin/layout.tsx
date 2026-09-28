import DashboardShell from "@/components/DashboardShell";

/** The admin workspace. Nav comes from `src/lib/navConfig.ts`. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardShell role="admin">{children}</DashboardShell>
  );
}

