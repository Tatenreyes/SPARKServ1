"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarX } from "lucide-react";

/**
 * Cancelling an upcoming appointment, before the technician starts.
 *
 * The server decides whether it is allowed (a booking is cancellable only while it
 * is still `pending`); this control is only rendered in that state, so the button a
 * customer sees and the rule the database enforces are the same rule. Cancelling
 * releases the reserved slot and returns the request to "ready to book": the
 * approved estimate and the technician who accepted the job are kept, so the
 * customer can pick another time without raising a new request or paying a fee.
 */
export default function CancelBookingControl({
  bookingId,
  scheduledAt,
}: {
  bookingId: string;
  /** The appointment being cancelled, shown in the confirmation step. */
  scheduledAt: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancelBooking() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/bookings/${bookingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "cancelled" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to cancel this appointment");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-card border border-ink/8 bg-surface p-5 shadow-card">
      <h3 className="font-display text-base font-semibold text-ink">
        Need a different time?
      </h3>
      <p className="mt-1 text-sm text-ink/60">
        You can cancel this appointment until the technician starts the repair. Your
        approved estimate and your technician are kept, so you can book another time
        straight away — no new request and no cancellation fee.
      </p>

      {error && <p className="mt-2 text-sm text-alert-ink">{error}</p>}

      {!confirming ? (
        <button
          onClick={() => setConfirming(true)}
          className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-alert-500/30 px-4 py-2 text-sm font-semibold text-alert-ink hover:bg-alert-soft"
        >
          <CalendarX className="h-4 w-4" aria-hidden="true" />
          Cancel this appointment
        </button>
      ) : (
        <div className="mt-4 space-y-2">
          <p className="text-sm font-medium text-ink">
            Cancel the appointment on {new Date(scheduledAt).toLocaleString()}?
          </p>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={cancelBooking}
              disabled={submitting}
              className="rounded-full bg-alert-500 px-4 py-2 text-sm font-semibold text-white hover:bg-alert-600 disabled:opacity-50"
            >
              {submitting ? "Cancelling..." : "Yes, cancel it"}
            </button>
            <button
              onClick={() => setConfirming(false)}
              disabled={submitting}
              className="rounded-full border border-ink/15 px-4 py-2 text-sm font-medium text-ink/70"
            >
              Keep the appointment
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
