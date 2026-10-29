"use client";

import { AlertTriangle, RotateCcw } from "lucide-react";
import {
  PAYMENTS_QUEUE_UNAVAILABLE_BODY,
  PAYMENTS_QUEUE_UNAVAILABLE_TITLE,
} from "@/lib/payments-queue";

/**
 * The safe error state for `/admin/payments`.
 *
 * A failed query must never be able to look like an empty queue, so this renders the
 * opposite claim: the queue is UNKNOWN, not empty, and there may still be references
 * waiting to be verified. It is scoped to this route on purpose — it catches the
 * throws from `requireRows()` in this page and nothing else.
 *
 * `error.digest` is Next.js's own hash of the server error. It is safe to show and
 * is the only value here that identifies the failure, which lets an administrator
 * quote it in a bug report without the page echoing a row, a GCash reference or a
 * credential. The error's `message` is deliberately not rendered.
 */
export default function AdminPaymentsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="rounded-card border border-alert-500/30 bg-alert-soft p-5 shadow-card">
      <h1 className="flex items-center gap-2 font-display text-lg font-semibold text-alert-ink">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
        {PAYMENTS_QUEUE_UNAVAILABLE_TITLE}
      </h1>

      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-alert-ink">
        {PAYMENTS_QUEUE_UNAVAILABLE_BODY}
      </p>

      <button
        type="button"
        onClick={() => reset()}
        className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-alert-600 px-4 py-2 text-sm font-semibold text-white hover:bg-alert-700"
      >
        <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" /> Try again
      </button>

      {error.digest && (
        <p className="mt-3 font-mono text-[11px] text-alert-ink/70">
          Reference for support: {error.digest}
        </p>
      )}
    </div>
  );
}
