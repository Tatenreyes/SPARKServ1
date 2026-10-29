"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Star } from "lucide-react";

export type ExistingRating = {
  rating: number;
  comment: string | null;
};

/** Read-only star row for the "already rated" and "thank you" states. */
function Stars({ value }: { value: number }) {
  return (
    <span
      className="inline-flex items-center gap-0.5"
      aria-label={`Rated ${value} out of 5`}
    >
      {[1, 2, 3, 4, 5].map((step) => (
        <Star
          key={step}
          aria-hidden="true"
          className={`h-5 w-5 ${
            step <= value ? "fill-warn-ink text-warn-ink" : "text-line"
          }`}
        />
      ))}
    </span>
  );
}

/**
 * Customer feedback for a completed repair. One rating per booking — the API
 * and the unique `ratings.booking_id` constraint both enforce that. Uses radio
 * semantics so the stars are reachable by keyboard and announced as one choice.
 */
export default function RatingForm({
  bookingId,
  technicianName,
  existingRating = null,
}: {
  bookingId: string;
  technicianName: string;
  existingRating?: ExistingRating | null;
}) {
  const router = useRouter();
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (existingRating) {
    return (
      <section className="rounded-card border border-line bg-surface p-5 shadow-card">
        <h2 className="font-display text-base font-semibold text-ink">
          Your rating
        </h2>
        <div className="mt-2">
          <Stars value={existingRating.rating} />
        </div>
        {existingRating.comment && (
          <p className="mt-2 text-sm leading-relaxed text-ink/70">
            {existingRating.comment}
          </p>
        )}
        <p className="mt-3 flex items-center gap-1.5 text-xs text-muted">
          <CheckCircle2 className="h-3.5 w-3.5 text-signal-ink" aria-hidden="true" />
          Thanks for helping us keep technicians accountable.
        </p>
      </section>
    );
  }

  if (done) {
    return (
      <section className="rounded-card border border-line bg-surface p-5 shadow-card">
        <h2 className="flex items-center gap-2 font-display text-base font-semibold text-ink">
          <CheckCircle2 className="h-5 w-5 text-signal-ink" aria-hidden="true" />
          Thanks for your feedback
        </h2>
        <p className="mt-1 text-sm text-muted">
          Your rating helps other customers choose the right technician.
        </p>
      </section>
    );
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (rating < 1) {
      setError("Choose a star rating first.");
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/bookings/${bookingId}/rating`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, comment }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(payload.error ?? "Unable to save your rating.");
        return;
      }
      setDone(true);
      router.refresh();
    } catch {
      setError("Unable to save your rating.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="rounded-card border border-line bg-surface p-5 shadow-card">
      <h2 className="font-display text-base font-semibold text-ink">
        Rate your technician
      </h2>
      <p className="mt-1 text-sm text-muted">
        How did {technicianName} do on this repair?
      </p>

      <form onSubmit={submit} className="mt-4">
        <fieldset>
          <legend className="sr-only">Star rating</legend>
          <div
            className="flex items-center gap-1"
            role="radiogroup"
            aria-label="Star rating"
          >
            {[1, 2, 3, 4, 5].map((step) => (
              <button
                key={step}
                type="button"
                role="radio"
                aria-checked={rating === step}
                aria-label={`${step} star${step === 1 ? "" : "s"}`}
                onClick={() => setRating(step)}
                className="cursor-pointer rounded-md p-0.5 transition duration-150 hover:scale-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
              >
                <Star
                  aria-hidden="true"
                  className={`h-8 w-8 ${
                    step <= rating
                      ? "fill-warn-ink text-warn-ink"
                      : "text-line hover:text-warn-ink/60"
                  }`}
                />
              </button>
            ))}
          </div>
        </fieldset>

        <label
          htmlFor="rating-comment"
          className="mt-4 block text-xs font-semibold text-ink/80"
        >
          Comment (optional)
        </label>
        <textarea
          id="rating-comment"
          rows={3}
          maxLength={1000}
          value={comment}
          onChange={(event) => setComment(event.target.value)}
          placeholder="Tell us about the service — punctuality, workmanship, anything helpful."
          className="mt-1.5 w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-line"
        />
        <p className="mt-1 text-right text-[11px] text-muted">
          {comment.length}/1000
        </p>

        {error && (
          <p
            role="alert"
            className="mt-2 rounded-lg bg-alert-soft px-3 py-2 text-sm text-alert-ink"
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting || rating < 1}
          className="mt-3 inline-flex h-11 cursor-pointer items-center gap-2 rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white transition duration-200 hover:bg-brand-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {submitting ? "Saving..." : "Submit rating"}
        </button>
      </form>
    </section>
  );
}
