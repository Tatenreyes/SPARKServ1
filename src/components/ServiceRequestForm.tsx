"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Chatbot from "@/components/Chatbot";

const APPLIANCE_TYPES = [
  "refrigerator",
  "washing_machine",
  "aircon",
  "water_dispenser",
  "microwave",
  "tv",
  "other",
];

export default function ServiceRequestForm() {
  const router = useRouter();
  const [applianceType, setApplianceType] = useState(APPLIANCE_TYPES[0]);
  const [issueDescription, setIssueDescription] = useState("");
  const [location, setLocation] = useState("");
  const [chatbotTried, setChatbotTried] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      const res = await fetch("/api/service-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appliance_type: applianceType,
          issue_description: issueDescription,
          location,
          chatbot_resolved: false,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to submit request");

      router.push(`/customer/service-request/${json.data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <form onSubmit={handleSubmit} className="space-y-4 rounded-card border border-ink/8 p-6">
        <h2 className="text-lg font-semibold text-ink">Describe your appliance issue</h2>

        <div>
          <label className="mb-1 block text-sm font-medium text-ink/80">Appliance type</label>
          <select
            value={applianceType}
            onChange={(e) => setApplianceType(e.target.value)}
            className="w-full rounded-lg border border-ink/15 px-3 py-2 text-sm"
          >
            {APPLIANCE_TYPES.map((type) => (
              <option key={type} value={type}>
                {type.replace("_", " ")}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-ink/80">Issue description</label>
          <textarea
            required
            rows={4}
            value={issueDescription}
            onChange={(e) => setIssueDescription(e.target.value)}
            className="w-full rounded-lg border border-ink/15 px-3 py-2 text-sm"
            placeholder="e.g. Refrigerator is not cooling, been warm since yesterday"
          />
        </div>

        <div>
          <label className="mb-1 block text-sm font-medium text-ink/80">Location</label>
          <input
            required
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="w-full rounded-lg border border-ink/15 px-3 py-2 text-sm"
            placeholder="Barangay, City"
          />
        </div>

        {!chatbotTried && (
          <p className="rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-700">
            Tip: try the troubleshooting assistant on the right first — it might save you a service call.
          </p>
        )}

        {error && <p className="text-sm text-alert-500">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="w-full rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
        >
          {submitting ? "Submitting..." : "Submit request & find technicians"}
        </button>
      </form>

      <Chatbot onFirstMessage={() => setChatbotTried(true)} />
    </div>
  );
}
