"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { PaymentRow } from "@/types/database";

const STATUS_LABEL: Record<string, string> = {
  pending_verification: "Pending verification",
  confirmed: "Confirmed",
  rejected: "Rejected — please re-submit",
};

const STATUS_COLOR: Record<string, string> = {
  pending_verification: "bg-spark-50 text-spark-700",
  confirmed: "bg-signal-50 text-signal-600",
  rejected: "bg-alert-50 text-alert-600",
};

export default function PaymentForm({
  bookingId,
  existingPayment,
}: {
  bookingId: string;
  existingPayment: PaymentRow | null;
}) {
  const router = useRouter();
  const [reference, setReference] = useState("");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const showForm = !existingPayment || existingPayment.status === "rejected";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          booking_id: bookingId,
          gcash_reference: reference,
          amount: parseFloat(amount),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit payment");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-card border border-ink/8 bg-white p-5 shadow-card">
      <h3 className="font-display text-base font-semibold text-ink">Payment</h3>
      <p className="mt-1 text-xs text-ink/50">
        Pay the technician via GCash, then submit the reference number here so admin can
        verify it. Only you (the customer) can submit this.
      </p>

      {existingPayment && (
        <div className="mt-3 rounded-lg bg-canvas p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-ink">₱{existingPayment.amount.toFixed(2)}</p>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS_COLOR[existingPayment.status]}`}
            >
              {STATUS_LABEL[existingPayment.status]}
            </span>
          </div>
          <p className="mt-1 text-xs text-ink/40">Ref: {existingPayment.gcash_reference}</p>
        </div>
      )}

      {showForm && (
        <form onSubmit={handleSubmit} className="mt-3 space-y-2">
          <input
            required
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            placeholder="GCash reference number"
            className="w-full rounded-lg border border-ink/15 px-3 py-2 text-sm"
          />
          <input
            required
            type="number"
            step="0.01"
            min="0"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Amount paid (₱)"
            className="w-full rounded-lg border border-ink/15 px-3 py-2 text-sm"
          />
          {error && <p className="text-xs text-alert-500">{error}</p>}
          <button
            type="submit"
            disabled={submitting}
            className="rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
          >
            {submitting ? "Submitting..." : "Submit payment reference"}
          </button>
        </form>
      )}
    </div>
  );
}
