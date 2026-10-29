import DashboardShell from "@/components/DashboardShell";

/**
 * Every admin screen reads live operational data — the payments queue, bookings,
 * technician approvals, the user list — and each one fetches it with the
 * service-role client, which reads no cookies. Without this, Next.js has no dynamic
 * signal in those pages and PRERENDERS them at build time, so the admin workspace
 * serves a snapshot frozen at deploy: a customer's submitted payment never appears,
 * and there is nothing to Confirm.
 *
 * `force-dynamic` is set here, on the segment, rather than per page, so a new admin
 * screen cannot reintroduce the bug by forgetting it.
 */
export const dynamic = "force-dynamic";

/** The admin workspace. Nav comes from `src/lib/navConfig.ts`. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  return (
    <DashboardShell role="admin">{children}</DashboardShell>
  );
}

