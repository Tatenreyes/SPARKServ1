import DashboardShell from "@/components/DashboardShell";

/** The technician workspace. Nav comes from `src/lib/navConfig.ts`. */
export default function TechnicianLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardShell role="technician">{children}</DashboardShell>
  );
}

