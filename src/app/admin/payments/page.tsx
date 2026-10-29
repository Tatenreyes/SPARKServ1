import { createServiceRoleClient } from "@/lib/supabase/server";
import AdminPaymentsClient from "@/components/AdminPaymentsClient";
import { requireRows } from "@/lib/payments-queue";

/**
 * `/admin/payments` is the queue an administrator has to be able to trust: a payment
 * that is in the database but missing from this page is money nobody verifies. The
 * route therefore declares its own dynamic rendering instead of inheriting one from
 * the `/admin` segment, so the guarantee stays local to the page that needs it.
 *
 * It is load-bearing, not decoration. Every read below goes through
 * `createServiceRoleClient()`, which reads no cookies, so without this export Next.js
 * has no dynamic signal here and PRERENDERS the route at build time. The page then
 * becomes a payments list frozen at deploy: a customer's later payment is in the
 * database but never in the page, and there is nothing to Confirm.
 */
export const dynamic = "force-dynamic";

export default async function AdminPaymentsPage() {
  const supabase = createServiceRoleClient();

  // Every query below is guarded by `requireRows()`, which raises on a query error
  // instead of returning `[]`. A failed SELECT must never render as an empty queue —
  // see `src/lib/payments-queue.ts` for why, and for exactly what is (and is not)
  // written to the server log.
  const paymentsResult = await supabase
    .from("payments")
    .select("*")
    .order("created_at", { ascending: false });
  const payments = requireRows("payments", paymentsResult.data, paymentsResult.error);

  const userIds = Array.from(new Set(payments.map((p) => p.customer_id)));
  const usersResult = userIds.length
    ? await supabase.from("users").select("id, name").in("id", userIds)
    : null;
  const users = usersResult
    ? requireRows("customer names", usersResult.data, usersResult.error)
    : [];

  // What verifying each payment actually does. Confirming a reference is not a
  // bookkeeping step: it is the moment the repair becomes `completed`, so the admin
  // needs to see which repair they are closing and what state it is in.
  const bookingIds = Array.from(new Set(payments.map((p) => p.booking_id)));
  const bookingsResult = bookingIds.length
    ? await supabase
        .from("bookings")
        .select("id, service_request_id, status, scheduled_at, final_cost")
        .in("id", bookingIds)
    : null;
  const bookings = bookingsResult
    ? requireRows("bookings", bookingsResult.data, bookingsResult.error)
    : [];

  const requestIds = Array.from(new Set(bookings.map((b) => b.service_request_id)));
  const requestsResult = requestIds.length
    ? await supabase.from("service_requests").select("id, appliance_type").in("id", requestIds)
    : null;
  const requests = requestsResult
    ? requireRows("appliance types", requestsResult.data, requestsResult.error)
    : [];

  const applianceByRequest = new Map(requests.map((r) => [r.id, r.appliance_type]));
  const repairByBooking = Object.fromEntries(
    bookings.map((b) => [
      b.id,
      {
        bookingId: b.id,
        status: b.status,
        scheduledAt: b.scheduled_at,
        finalCost: b.final_cost,
        applianceType: applianceByRequest.get(b.service_request_id) ?? null,
      },
    ])
  );

  const totalTransactions = payments.length;
  const pendingVerification = payments.filter((p) => p.status === "pending_verification").length;
  const confirmedPayments = payments.filter((p) => p.status === "confirmed").length;

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-ink">Transactions</h1>
      <p className="mt-1 text-sm text-ink/65">
        Verify GCash payment references. Confirming a reference completes the repair it
        belongs to — that is the only way a repair reaches <strong>Completed</strong>.
      </p>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Total Transactions" value={totalTransactions} />
        <StatCard label="Pending Verification" value={pendingVerification} />
        <StatCard label="Confirmed Payments" value={confirmedPayments} />
      </div>

      <AdminPaymentsClient
        initialPayments={payments}
        customerNames={Object.fromEntries(users.map((u) => [u.id, u.name]))}
        repairs={repairByBooking}
      />
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-card border border-ink/8 bg-surface p-3 shadow-card">
      <p className="font-display text-lg font-semibold text-ink">{value}</p>
      <p className="mt-0.5 text-xs text-ink/50">{label}</p>
    </div>
  );
}
