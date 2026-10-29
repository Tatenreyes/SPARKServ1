"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Search, CheckCircle2, AlertTriangle } from "lucide-react";
import StatusBadge from "@/components/StatusBadge";
import type { PaymentRow } from "@/types/database";

const STATUS_COLOR: Record<string, string> = {
  pending_verification: "bg-brand-soft text-brand-ink",
  confirmed: "bg-signal-soft text-signal-ink",
  rejected: "bg-alert-soft text-alert-ink",
};

const STATUS_LABEL: Record<string, string> = {
  pending_verification: "Pending Verification",
  confirmed: "Confirmed",
  rejected: "Rejected",
};

/** The repair a payment closes, so the admin can see what confirming will complete. */
export interface PaymentRepair {
  bookingId: string;
  status: string;
  scheduledAt: string;
  finalCost: number | null;
  applianceType: string | null;
}

export default function AdminPaymentsClient({
  initialPayments,
  customerNames,
  repairs = {},
}: {
  initialPayments: PaymentRow[];
  customerNames: Record<string, string>;
  repairs?: Record<string, PaymentRepair>;
}) {
  const router = useRouter();
  const [payments, setPayments] = useState(initialPayments);
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  // Per-row result of the last action. Verification used to fail invisibly: the
  // handler only reacted to `res.ok`, so a 503/409 looked like a dead button.
  const [results, setResults] = useState<Record<string, { ok: boolean; text: string }>>({});
  // Rejecting is deliberately two-step, like the audited queue override: the
  // administrator writes a reason the CUSTOMER will read, reviews it, then
  // confirms. The reason is required client-side, by the route, and by the
  // database function, so an unexplained rejection cannot happen at any layer.
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [reviewing, setReviewing] = useState(false);

  const filtered = payments.filter((p) => {
    if (!search) return true;
    const name = customerNames[p.customer_id] ?? "";
    return (
      p.gcash_reference.toLowerCase().includes(search.toLowerCase()) ||
      name.toLowerCase().includes(search.toLowerCase())
    );
  });

  /** Clear the per-row message before a new attempt. */
  function clearResult(id: string) {
    setResults((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  function startReject(id: string) {
    setRejectingId(id);
    setReason("");
    setReviewing(false);
    clearResult(id);
  }

  function cancelReject() {
    setRejectingId(null);
    setReason("");
    setReviewing(false);
  }

  async function send(
    id: string,
    body: { status: "confirmed" } | { status: "rejected"; reason: string }
  ) {
    setBusyId(id);
    clearResult(id);

    try {
      const res = await fetch(`/api/payments/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setResults((prev) => ({
          ...prev,
          [id]: { ok: false, text: json.error ?? `Could not update this payment (HTTP ${res.status}).` },
        }));
        // A refusal is almost always "the database already decided this": a 409 from a
        // row whose status the page had not caught up with, or another administrator
        // acting first. Refresh so the row shows its REAL status. Without this the
        // queue keeps offering Confirm/Reject for a payment that was confirmed days
        // ago, and the administrator is told only "Payment has already been
        // processed" while the row still reads Pending Verification.
        router.refresh();
        return false;
      }

      if (json.data) {
        setPayments((prev) => prev.map((p) => (p.id === id ? json.data : p)));
      }

      const outcome = json.outcome as { outcome?: string; completed_now?: boolean } | undefined;
      const text =
        body.status === "rejected"
          ? "Rejected — the customer has been told why and can submit a new reference."
          : outcome?.completed_now
            ? "Payment verified — the repair is now Completed."
            : "Payment verified. The repair was already completed, so nothing else changed.";
      setResults((prev) => ({ ...prev, [id]: { ok: true, text } }));

      // The repair's status and the stat cards above live on the server; without
      // this the admin would have to reload to see the completion they just caused.
      router.refresh();
      return true;
    } catch (err) {
      setResults((prev) => ({
        ...prev,
        [id]: { ok: false, text: err instanceof Error ? err.message : "Could not reach the server." },
      }));
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function confirmPayment(id: string) {
    await send(id, { status: "confirmed" });
  }

  async function rejectPayment(id: string) {
    const trimmed = reason.trim();
    if (!trimmed) return;
    const ok = await send(id, { status: "rejected", reason: trimmed });
    if (ok) cancelReject();
  }

  return (
    <div className="mt-6">
      <div className="mb-3 flex items-center gap-2 rounded-lg border border-ink/15 bg-surface px-3 py-2">
        <Search className="h-4 w-4 text-white/70" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by reference or customer..."
          className="w-full bg-transparent text-sm text-white placeholder:text-white/60 outline-none"
        />
      </div>

      <div className="overflow-x-auto rounded-card border border-ink/8 bg-surface shadow-card">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-ink/8 bg-canvas text-xs uppercase tracking-wide text-ink/40">
            <tr>
              <th className="px-4 py-3 font-medium">Customer</th>
              <th className="px-4 py-3 font-medium">Repair</th>
              <th className="px-4 py-3 font-medium">Amount</th>
              <th className="px-4 py-3 font-medium">Reference #</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {!filtered.length ? (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-sm text-ink/40">
                  No transactions yet.
                </td>
              </tr>
            ) : (
              filtered.map((p) => {
                const repair = repairs[p.booking_id];
                const result = results[p.id];
                return (
                  <tr key={p.id} className="border-b border-ink/5 last:border-0">
                    <td className="px-4 py-3 text-ink/70">{customerNames[p.customer_id] ?? "—"}</td>
                    <td className="px-4 py-3">
                      <p className="text-ink/70 capitalize">
                        {repair?.applianceType?.replace(/_/g, " ") ?? "—"}
                      </p>
                      {repair && (
                        <span className="mt-1 inline-flex items-center gap-1.5">
                          <StatusBadge status={repair.status} size="sm" />
                          <span className="text-[11px] text-ink/40">
                            {new Date(repair.scheduledAt).toLocaleDateString()}
                          </span>
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-medium text-ink">₱{p.amount.toFixed(2)}</td>
                    <td className="px-4 py-3 font-mono text-xs text-ink/60">{p.gcash_reference}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_COLOR[p.status]}`}
                      >
                        {STATUS_LABEL[p.status]}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {p.status === "pending_verification" ? (
                        <div className="space-y-2">
                          <div className="flex gap-2">
                            <button
                              onClick={() => confirmPayment(p.id)}
                              disabled={busyId === p.id}
                              className="rounded-full bg-signal-500 px-3 py-1 text-xs font-semibold text-white hover:bg-signal-600 disabled:opacity-50"
                            >
                              Confirm
                            </button>
                            <button
                              onClick={() => (rejectingId === p.id ? cancelReject() : startReject(p.id))}
                              disabled={busyId === p.id}
                              className="rounded-full border border-alert-500/30 px-3 py-1 text-xs font-semibold text-alert-ink hover:bg-alert-soft disabled:opacity-50"
                            >
                              {rejectingId === p.id ? "Cancel" : "Reject"}
                            </button>
                          </div>

                          {/* Two steps on purpose: write the reason the customer
                              will read, review it, then confirm. */}
                          {rejectingId === p.id && (
                            <div className="rounded-lg border border-line bg-canvas px-3 py-2">
                              <input
                                value={reason}
                                onChange={(event) => {
                                  setReason(event.target.value);
                                  setReviewing(false);
                                }}
                                maxLength={500}
                                placeholder="Reason (required — the customer sees this)"
                                className="w-full rounded-lg border border-ink/15 px-3 py-1.5 text-xs"
                              />
                              {!reviewing ? (
                                <button
                                  onClick={() => setReviewing(true)}
                                  disabled={!reason.trim()}
                                  className="mt-2 rounded-full bg-alert-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-alert-600 disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  Review rejection
                                </button>
                              ) : (
                                <div className="mt-2 rounded-lg border border-line bg-alert-soft px-3 py-2">
                                  <p className="flex items-start gap-1.5 text-[11px] font-semibold leading-relaxed text-alert-ink">
                                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                                    <span>
                                      The customer will read: “{reason.trim()}”. This is recorded
                                      against your account, the repair stays at the payment step, and
                                      no refund is recorded.
                                    </span>
                                  </p>
                                  <div className="mt-2 flex gap-2">
                                    <button
                                      onClick={() => rejectPayment(p.id)}
                                      disabled={busyId === p.id}
                                      className="rounded-full bg-alert-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-alert-700 disabled:opacity-50"
                                    >
                                      {busyId === p.id ? "Rejecting…" : "Confirm rejection"}
                                    </button>
                                    <button
                                      onClick={() => setReviewing(false)}
                                      className="rounded-full border border-ink/15 px-3 py-1.5 text-xs font-medium text-ink/70 hover:bg-surface"
                                    >
                                      Back
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-ink/35">—</span>
                      )}

                      {result && (
                        <p
                          className={`mt-1.5 flex items-start gap-1 text-[11px] leading-relaxed ${
                            result.ok ? "text-signal-ink" : "text-alert-ink"
                          }`}
                          role={result.ok ? "status" : "alert"}
                        >
                          {result.ok ? (
                            <CheckCircle2 className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                          ) : (
                            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                          )}
                          {result.text}
                        </p>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
