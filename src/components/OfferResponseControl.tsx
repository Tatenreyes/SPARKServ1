"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function OfferResponseControl({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [showReasonFor, setShowReasonFor] = useState(false);
  const [reason, setReason] = useState("");

  async function respond(action: "accept" | "reject") {
    setBusy(true);
    try {
      const res = await fetch(`/api/service-requests/${requestId}/offer-response`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason: reason || undefined }),
      });
      if (res.ok) {
        router.refresh();
      }
    } finally {
      setBusy(false);
      setShowReasonFor(false);
    }
  }

  if (showReasonFor) {
    return (
      <div className="mt-3 space-y-2">
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (optional)"
          className="w-full rounded-lg border border-ink/15 px-3 py-1.5 text-sm"
        />
        <div className="flex gap-2">
          <button
            onClick={() => respond("reject")}
            disabled={busy}
            className="rounded-full bg-alert-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-alert-600 disabled:opacity-50"
          >
            {busy ? "..." : "Confirm reject"}
          </button>
          <button
            onClick={() => setShowReasonFor(false)}
            className="rounded-full border border-ink/15 px-3 py-1.5 text-xs font-medium text-ink/70"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 flex gap-2">
      <button
        onClick={() => respond("accept")}
        disabled={busy}
        className="rounded-full bg-signal-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-signal-600 disabled:opacity-50"
      >
        {busy ? "..." : "Accept"}
      </button>
      <button
        onClick={() => setShowReasonFor(true)}
        disabled={busy}
        className="rounded-full border border-alert-500/30 px-4 py-1.5 text-sm font-semibold text-alert-500 hover:bg-alert-50 disabled:opacity-50"
      >
        Reject
      </button>
    </div>
  );
}
