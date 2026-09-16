"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, AlertTriangle } from "lucide-react";

export default function CustomerInspectionControl({
  bookingId,
  applianceType,
}: {
  bookingId: string;
  applianceType: string;
}) {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [reportingProblem, setReportingProblem] = useState(false);
  const [problemDescription, setProblemDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function confirmWorking() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/bookings/${bookingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "completed" }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to confirm");
    } finally {
      setSubmitting(false);
    }
  }

  async function reportProblem() {
    if (!problemDescription.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/support-tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subject: `Issue after ${applianceType.replace("_", " ")} repair`,
          message: problemDescription,
          type: "technical_issue",
          priority: "high",
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-card border border-spark-400/30 bg-spark-50 p-5">
      <h3 className="font-display text-base font-semibold text-ink">
        Please check your appliance before completing payment
      </h3>
      <p className="mt-1 text-sm text-ink/60">
        Take a moment to confirm the repair actually fixed the problem.
      </p>

      {error && <p className="mt-2 text-sm text-alert-500">{error}</p>}

      {!reportingProblem ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            onClick={confirmWorking}
            disabled={submitting}
            className="flex items-center gap-1.5 rounded-full bg-signal-500 px-4 py-2 text-sm font-semibold text-white hover:bg-signal-600 disabled:opacity-50"
          >
            <CheckCircle2 className="h-4 w-4" />
            {submitting ? "Confirming..." : "Appliance is working properly"}
          </button>
          <button
            onClick={() => setReportingProblem(true)}
            className="flex items-center gap-1.5 rounded-full border border-alert-500/30 px-4 py-2 text-sm font-semibold text-alert-500 hover:bg-white"
          >
            <AlertTriangle className="h-4 w-4" />
            I still have a problem
          </button>
        </div>
      ) : (
        <div className="mt-4 space-y-2">
          <textarea
            rows={3}
            value={problemDescription}
            onChange={(e) => setProblemDescription(e.target.value)}
            placeholder="Describe what's still wrong..."
            className="w-full rounded-lg border border-ink/15 px-3 py-2 text-sm"
          />
          <div className="flex gap-2">
            <button
              onClick={reportProblem}
              disabled={submitting || !problemDescription.trim()}
              className="rounded-full bg-alert-500 px-4 py-2 text-sm font-semibold text-white hover:bg-alert-600 disabled:opacity-50"
            >
              {submitting ? "Submitting..." : "Submit issue"}
            </button>
            <button
              onClick={() => setReportingProblem(false)}
              className="rounded-full border border-ink/15 px-4 py-2 text-sm font-medium text-ink/70"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
