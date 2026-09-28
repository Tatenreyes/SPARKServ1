import DashboardShell from "@/components/DashboardShell";

/**
 * The customer workspace. Sidebar nav is resolved from `role` inside
 * `DashboardShell` — see `src/lib/navConfig.ts` for why it can't live here.
 */
export default function CustomerLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardShell role="customer">{children}</DashboardShell>
  );
}

