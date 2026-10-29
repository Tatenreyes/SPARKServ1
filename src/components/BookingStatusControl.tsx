"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const STATUS_FLOW: Record<string, string | null> = {
  pending: "in_progress",
  in_progress: "awaiting_inspection",
  // The customer attests their inspection (awaiting_inspection → awaiting_payment),
  // and an administrator's payment verification completes the repair. The
  // technician has nothing to press from here.
  awaiting_inspection: null,
  awaiting_payment: null,
  completed: null,
  cancelled: null,
};

const NEXT_LABEL: Record<string, string> = {
  pending: "Start job (In progress)",
  // The technician finishes the physical repair; the customer's inspection and the
  // administrator's payment verification are what close the transaction, so this
  // button must not claim to complete anything.
  in_progress: "Finish repair — send for inspection",
};

export default function BookingStatusControl({
  bookingId,
  currentStatus,
}: {
  bookingId: string;
  currentStatus: string;
}) {
  const router = useRouter();
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [finalCost, setFinalCost] = useState("");

  const nextStatus = STATUS_FLOW[currentStatus];
  // The final cost must be recorded before the job goes to inspection: the
  // customer pays exactly this amount, and /api/payments refuses to accept a
  // payment while `bookings.final_cost` is null.
  const needsCost = currentStatus === "in_progress";

  async function handleAdvance() {
    if (!nextStatus) return;
    if (needsCost && (!finalCost || Number(finalCost) <= 0)) {
      setError("Enter the final repair cost before sending the job for inspection.");
      return;
    }

    setUpdating(true);
    setError(null);
    try {
      const res = await fetch(`/api/bookings/${bookingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: nextStatus,
          ...(needsCost ? { final_cost: Number(finalCost) } : {}),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update status");
    } finally {
      setUpdating(false);
    }
  }

  if (!nextStatus) return null;

  return (
    <div className="mt-3 space-y-2">
      {needsCost && (
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold text-ink/70">
            Final repair cost (₱) *
          </span>
          <input
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={finalCost}
            onChange={(event) => setFinalCost(event.target.value)}
            placeholder="e.g. 1500.00"
            className="w-full rounded-lg border border-ink/15 bg-surface px-3 py-2 text-sm"
          />
          <span className="mt-1 block text-[11px] text-muted">
            The customer pays this amount after they approve the repair.
          </span>
        </label>
      )}
      <button
        onClick={handleAdvance}
        disabled={updating}
        className="rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-white hover:bg-ink/80 disabled:opacity-50"
      >
        {updating ? "Updating..." : NEXT_LABEL[currentStatus]}
      </button>
      {error && <p className="mt-1 text-xs text-alert-ink">{error}</p>}
    </div>
  );
}
