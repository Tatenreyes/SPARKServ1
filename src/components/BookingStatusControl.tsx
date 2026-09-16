"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const STATUS_FLOW: Record<string, string | null> = {
  pending: "in_progress",
  in_progress: "awaiting_inspection",
  awaiting_inspection: null,
  completed: null,
  cancelled: null,
};

const NEXT_LABEL: Record<string, string> = {
  pending: "Start job (In progress)",
  in_progress: "Mark repair completed",
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

  const nextStatus = STATUS_FLOW[currentStatus];

  async function handleAdvance() {
    if (!nextStatus) return;
    setUpdating(true);
    setError(null);
    try {
      const res = await fetch(`/api/bookings/${bookingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus }),
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
    <div className="mt-3">
      <button
        onClick={handleAdvance}
        disabled={updating}
        className="rounded-lg bg-ink px-3 py-1.5 text-xs font-medium text-white hover:bg-ink/80 disabled:opacity-50"
      >
        {updating ? "Updating..." : NEXT_LABEL[currentStatus]}
      </button>
      {error && <p className="mt-1 text-xs text-alert-500">{error}</p>}
    </div>
  );
}
