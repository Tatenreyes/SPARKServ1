"use client";

import { useState } from "react";

export default function EstimateForm({ serviceRequestId }: { serviceRequestId: string }) {
  const [open, setOpen] = useState(false);
  const [cost, setCost] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    if (!cost) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/estimates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service_request_id: serviceRequestId,
          estimated_cost: Number(cost),
          notes: notes || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setDone(true);
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit estimate");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return <p className="mt-2 text-xs text-signal-600">Estimate submitted.</p>;
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="mt-2 rounded-lg border border-ink/15 px-3 py-1.5 text-xs font-medium text-ink/80 hover:bg-canvas"
      >
        Submit an estimate
      </button>
    );
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <input
        type="number"
        min="0"
        step="0.01"
        placeholder="Estimated cost (₱)"
        value={cost}
        onChange={(e) => setCost(e.target.value)}
        className="w-36 rounded-lg border border-ink/15 px-2 py-1.5 text-sm"
      />
      <input
        type="text"
        placeholder="Notes (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        className="flex-1 rounded-lg border border-ink/15 px-2 py-1.5 text-sm"
      />
      <button
        onClick={handleSubmit}
        disabled={submitting}
        className="rounded-full bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
      >
        {submitting ? "Sending..." : "Send estimate"}
      </button>
      {error && <p className="w-full text-xs text-alert-500">{error}</p>}
    </div>
  );
}
