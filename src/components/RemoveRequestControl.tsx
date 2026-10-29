"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Trash2 } from "lucide-react";

/**
 * "Remove this request" — for a request that never went anywhere.
 *
 * The SERVER owns the rule. `DELETE /api/service-requests/:id` refuses the moment
 * anything real depends on the request (an accepted technician, a prepared
 * estimate, an appointment, a completed repair) and answers with the reason, so
 * this control never has to guess why — it shows what the server said. The
 * callers additionally hide it outright for the states the customer can see for
 * themselves, so the button is not offered where it can only fail.
 *
 * Removal is a hard delete: the row leaves every list. That is only offered while
 * nothing depends on it, because the delete cascades (see the route's header).
 */
export default function RemoveRequestControl({
  requestId,
  applianceType,
  variant = "panel",
  redirectTo,
}: {
  requestId: string;
  applianceType?: string | null;
  /** `panel` = a card with its own heading; `inline` = a small button for a table row. */
  variant?: "panel" | "inline";
  /** Where to go after a successful removal. Omitted → refresh in place. */
  redirectTo?: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setRemoving(true);
    setError(null);
    try {
      const res = await fetch(`/api/service-requests/${requestId}`, { method: "DELETE" });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "We could not remove this request.");
      if (redirectTo) {
        router.push(redirectTo);
      } else {
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "We could not remove this request.");
      setConfirming(false);
    } finally {
      setRemoving(false);
    }
  }

  const appliance = applianceType?.replace(/_/g, " ") ?? "this request";

  if (variant === "inline") {
    return (
      <span className="inline-flex flex-col items-end gap-1">
        {confirming ? (
          <span className="inline-flex items-center gap-1.5">
            <button
              type="button"
              onClick={remove}
              disabled={removing}
              className="rounded-lg bg-alert-500 px-2.5 py-1 text-[11px] font-semibold text-white transition hover:bg-alert-600 disabled:opacity-50"
            >
              {removing ? "Removing…" : "Remove?"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={removing}
              className="rounded-lg border border-ink/15 px-2.5 py-1 text-[11px] font-medium text-ink/70 disabled:opacity-50"
            >
              Keep
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => {
              setError(null);
              setConfirming(true);
            }}
            className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-muted transition hover:bg-alert-soft hover:text-alert-ink"
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Remove
          </button>
        )}
        {error && <span className="max-w-[16rem] text-right text-[11px] text-alert-ink">{error}</span>}
      </span>
    );
  }

  return (
    <div className="rounded-card border border-line bg-surface p-5 shadow-card">
      <h2 className="font-display text-base font-semibold text-ink">Remove this request</h2>
      <p className="mt-1 text-sm leading-relaxed text-muted">
        Use this only if you no longer need the repair. The request and its progress
        disappear from your account.
      </p>

      {error && (
        <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-alert-soft/60 px-3 py-2 text-xs leading-relaxed text-alert-ink">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}

      {confirming ? (
        <div className="mt-3 rounded-xl border border-alert-500/30 bg-alert-soft/60 p-3">
          <p className="text-xs font-semibold text-alert-ink">
            Remove your {appliance} request?
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-alert-ink/80">
            This cannot be undone. If you only need a different time or technician,
            contact support instead — removing the request starts again from scratch.
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={remove}
              disabled={removing}
              className="rounded-full bg-alert-500 px-4 py-2 text-sm font-semibold text-white transition hover:bg-alert-600 disabled:opacity-50"
            >
              {removing ? "Removing…" : "Yes, remove it"}
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              disabled={removing}
              className="rounded-full border border-ink/15 px-4 py-2 text-sm font-medium text-ink/70 disabled:opacity-50"
            >
              Keep my request
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => {
            setError(null);
            setConfirming(true);
          }}
          className="mt-3 inline-flex items-center gap-1.5 rounded-full border border-alert-500/30 px-4 py-2 text-sm font-semibold text-alert-ink transition hover:bg-alert-soft"
        >
          <Trash2 className="h-4 w-4" aria-hidden="true" /> Remove this request
        </button>
      )}
    </div>
  );
}
