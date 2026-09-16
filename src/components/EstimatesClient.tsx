"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { EstimateRow } from "@/types/database";
import StatusBadge from "@/components/StatusBadge";

interface RequestInfo {
  id: string;
  appliance_type: string;
  issue_description: string;
}

export default function EstimatesClient({
  initialEstimates,
  requestInfo,
}: {
  initialEstimates: EstimateRow[];
  requestInfo: Record<string, RequestInfo>;
}) {
  const router = useRouter();
  const [estimates, setEstimates] = useState(initialEstimates);
  const [schedulingId, setSchedulingId] = useState<string | null>(null);
  const [scheduledAt, setScheduledAt] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleAccept(est: EstimateRow) {
    if (!scheduledAt) {
      setError("Pick a date and time first.");
      return;
    }
    setBusyId(est.id);
    setError(null);
    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service_request_id: est.service_request_id,
          technician_id: est.technician_id,
          estimate_id: est.id,
          scheduled_at: new Date(scheduledAt).toISOString(),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      router.push(`/customer/bookings/${json.data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to book this estimate");
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/estimates/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "rejected" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setEstimates((prev) => prev.map((e) => (e.id === id ? json.data : e)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reject estimate");
    } finally {
      setBusyId(null);
    }
  }

  if (!estimates.length) {
    return <p className="mt-6 text-sm text-ink/50">No estimates yet.</p>;
  }

  return (
    <div className="mt-6 space-y-4">
      {error && <p className="text-sm text-alert-500">{error}</p>}
      {estimates.map((est) => {
        const request = requestInfo[est.service_request_id];
        const isScheduling = schedulingId === est.id;
        return (
          <div key={est.id} className="rounded-card border border-ink/8 bg-white p-5 shadow-card">
            <div className="flex items-center justify-between">
              <p className="text-xs font-medium capitalize text-ink/50">
                {request?.appliance_type.replace("_", " ") ?? "Repair"}
              </p>
              <StatusBadge status={est.status} />
            </div>

            <p className="mt-2 font-display text-2xl font-semibold text-ink">
              ₱{est.estimated_cost.toFixed(2)}
            </p>
            {request?.issue_description && (
              <p className="mt-1 text-sm text-ink/60">{request.issue_description}</p>
            )}
            {est.notes && (
              <p className="mt-2 rounded-lg bg-canvas px-3 py-2 text-sm text-ink/65">{est.notes}</p>
            )}

            {est.status === "pending" && (
              <div className="mt-4 space-y-2">
                {isScheduling ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      type="datetime-local"
                      value={scheduledAt}
                      onChange={(e) => setScheduledAt(e.target.value)}
                      className="rounded-lg border border-ink/15 px-3 py-2 text-sm"
                    />
                    <button
                      onClick={() => handleAccept(est)}
                      disabled={busyId === est.id}
                      className="rounded-full bg-signal-500 px-4 py-2 text-sm font-semibold text-white hover:bg-signal-600 disabled:opacity-50"
                    >
                      {busyId === est.id ? "Booking..." : "Confirm booking"}
                    </button>
                    <button
                      onClick={() => setSchedulingId(null)}
                      className="text-sm font-medium text-ink/50 hover:text-ink"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <button
                      onClick={() => setSchedulingId(est.id)}
                      className="flex-1 rounded-full bg-signal-500 px-4 py-2 text-sm font-semibold text-white hover:bg-signal-600"
                    >
                      Accept estimate
                    </button>
                    <button
                      onClick={() => handleReject(est.id)}
                      disabled={busyId === est.id}
                      className="flex-1 rounded-full border border-alert-500/30 px-4 py-2 text-sm font-semibold text-alert-500 hover:bg-alert-50 disabled:opacity-50"
                    >
                      {busyId === est.id ? "..." : "Reject"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
