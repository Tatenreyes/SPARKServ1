import { createServiceRoleClient } from "@/lib/supabase/server";
import AdminPaymentsClient from "@/components/AdminPaymentsClient";

export default async function AdminPaymentsPage() {
  const supabase = createServiceRoleClient();

  const { data: payments } = await supabase
    .from("payments")
    .select("*")
    .order("created_at", { ascending: false });

  const userIds = Array.from(new Set((payments ?? []).map((p) => p.customer_id)));
  const { data: users } = userIds.length
    ? await supabase.from("users").select("id, name").in("id", userIds)
    : { data: [] };

  const totalTransactions = payments?.length ?? 0;
  const pendingVerification =
    payments?.filter((p) => p.status === "pending_verification").length ?? 0;
  const confirmedPayments = payments?.filter((p) => p.status === "confirmed").length ?? 0;

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-ink">Transactions</h1>
      <p className="mt-1 text-sm text-ink/65">Manage GCash payment references and verifications.</p>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Total Transactions" value={totalTransactions} />
        <StatCard label="Pending Verification" value={pendingVerification} />
        <StatCard label="Confirmed Payments" value={confirmedPayments} />
      </div>

      <AdminPaymentsClient
        initialPayments={payments ?? []}
        customerNames={Object.fromEntries((users ?? []).map((u) => [u.id, u.name]))}
      />
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-card border border-ink/8 bg-white p-3 shadow-card">
      <p className="font-display text-lg font-semibold text-ink">{value}</p>
      <p className="mt-0.5 text-xs text-ink/50">{label}</p>
    </div>
  );
}
