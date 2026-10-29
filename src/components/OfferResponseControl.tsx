"use client";

/**
 * Accept / decline the offer currently held by this technician.
 *
 * Every outcome is now reported. The previous version called `router.refresh()`
 * only when the response was ok and said NOTHING otherwise — so a technician
 * whose offer had already lapsed (the engine answers HTTP 200 with
 * `outcome: "expired"` and re-offers the request) saw the card disappear with no
 * explanation, which looks exactly like "I pressed Accept and nothing happened".
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";

interface ResultMessage {
  tone: "ok" | "warn" | "error";
  message: string;
}

export default function OfferResponseControl({
  requestId,
  expired = false,
  expiresAt = null,
}: {
  requestId: string;
  /**
   * True when the offer's TTL had already passed when the server rendered this
   * card. Computed on the server so the client cannot disagree with it (and so
   * there is no hydration mismatch from reading the clock twice).
   */
  expired?: boolean;
  expiresAt?: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [showReasonFor, setShowReasonFor] = useState(false);
  const [reason, setReason] = useState("");
  const [result, setResult] = useState<ResultMessage | null>(null);

  async function respond(action: "accept" | "decline") {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch(`/api/service-requests/${requestId}/offer-response`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, reason: reason || undefined }),
      });

      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        setResult({
          tone: "error",
          message:
            json.error ??
            `Your response could not be recorded (HTTP ${res.status}). Please try again.`,
        });
        return;
      }

      // `outcome` is the engine's own verdict, not a guess: the response can be
      // a 200 and still NOT be an acceptance.
      const outcome: string | null = json.outcome?.outcome ?? null;

      if (outcome === "accepted") {
        setResult({
          tone: "ok",
          message:
            "Job accepted. Send your estimate below so the customer can approve it and book the visit.",
        });
      } else if (outcome === "expired") {
        setResult({
          tone: "warn",
          message:
            "This offer had already expired, so it was not assigned to you. SPARKServ has passed it to the next technician.",
        });
      } else if (outcome === "not_offered") {
        setResult({
          tone: "warn",
          message:
            "This offer is no longer yours — it has already been re-offered or accepted elsewhere.",
        });
      } else if (outcome === "cancelled") {
        setResult({
          tone: "warn",
          message:
            "This request was cancelled, so the offer was released. You have not taken it on.",
        });
      } else {
        setResult({
          tone: "ok",
          message: "Offer declined. SPARKServ is offering it to the next technician.",
        });
      }

      // The list, the countdown and the assignment badge are all server state:
      // refresh rather than re-deriving the new state in React (Rule 1).
      router.refresh();
    } catch {
      setResult({
        tone: "error",
        message: "We could not reach the server. Check your connection and try again.",
      });
    } finally {
      setBusy(false);
      setShowReasonFor(false);
    }
  }

  const resultNotice = result && (
    <p
      role={result.tone === "error" ? "alert" : "status"}
      className={`mt-2 flex items-start gap-1.5 rounded-lg px-2.5 py-2 text-xs ${
        result.tone === "ok"
          ? "bg-signal-soft/60 text-signal-ink"
          : result.tone === "warn"
            ? "bg-warn-soft/60 text-warn-ink"
            : "bg-alert-soft/60 text-alert-ink"
      }`}
    >
      {result.tone === "ok" ? (
        <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      ) : result.tone === "warn" ? (
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      ) : (
        <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      )}
      {result.message}
    </p>
  );

  // ---- Offer already lapsed -------------------------------------------------
  // Accepting cannot assign it (the engine lapses it and re-offers), so the
  // honest action is to release it now rather than leave the technician
  // guessing why the job never became theirs.
  if (expired) {
    return (
      <div className="mt-3">
        <p className="flex items-start gap-1.5 rounded-lg bg-warn-soft/60 px-2.5 py-2 text-xs text-warn-ink">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          This offer expired
          {expiresAt ? ` on ${new Date(expiresAt).toLocaleString()}` : ""} — it can no
          longer be accepted. Release it to hand it straight back to the queue.
        </p>
        <div className="mt-2 flex gap-2">
          <button
            onClick={() => respond("decline")}
            disabled={busy}
            className="rounded-full border border-ink/15 px-4 py-1.5 text-sm font-semibold text-ink/70 hover:bg-canvas disabled:opacity-50"
          >
            {busy ? "..." : "Release offer"}
          </button>
        </div>
        {resultNotice}
      </div>
    );
  }

  // ---- Declining, with the reason that is recorded in the audit trail -------
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
            onClick={() => respond("decline")}
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
        {resultNotice}
      </div>
    );
  }

  return (
    <div className="mt-3">
      <div className="flex gap-2">
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
          className="rounded-full border border-alert-500/30 px-4 py-1.5 text-sm font-semibold text-alert-ink hover:bg-alert-soft disabled:opacity-50"
        >
          Reject
        </button>
      </div>
      {resultNotice}
    </div>
  );
}
