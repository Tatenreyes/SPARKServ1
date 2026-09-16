"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import AssignmentStatusCard from "@/components/AssignmentStatusCard";
import { APPLIANCES } from "@/lib/appliances";
import type { AssignmentStatus } from "@/types/database";

type Step = 1 | 2 | 3 | 4 | 5;
const STEP_LABELS: Record<Step, string> = {
  1: "Appliance",
  2: "Problem",
  3: "Technician",
  4: "Schedule",
  5: "Confirm",
};

interface AssignedTechnician {
  id: string;
  name: string;
}

export default function RequestRepairWizard() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);

  const [applianceType, setApplianceType] = useState<string | null>(null);
  const [issueDescription, setIssueDescription] = useState("");
  const [location, setLocation] = useState("");

  const [serviceRequestId, setServiceRequestId] = useState<string | null>(null);
  const [assignmentStatus, setAssignmentStatus] = useState<AssignmentStatus>("matching");
  const [assignedTechnician, setAssignedTechnician] = useState<AssignedTechnician | null>(null);

  const [scheduledAt, setScheduledAt] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // SPARKServ assigns a technician automatically by fair rotation — there is
  // no customer-facing picker. This step just submits the request and shows
  // whatever the queue returns (assigned, or "no technicians available").
  async function submitAndFindTechnician() {
    setSubmitting(true);
    setError(null);
    setStep(3);
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
      setServiceRequestId(json.data.id);
      setAssignmentStatus(json.data.assignment_status);
      setAssignedTechnician(json.assigned_technician ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleConfirm() {
    if (!serviceRequestId || !assignedTechnician || !scheduledAt) return;
    router.push(`/customer/service-request/${serviceRequestId}`);
  }

  const selectedAppliance = APPLIANCES.find((a) => a.value === applianceType) ?? null;

  return (
    <div className="max-w-2xl">
      <div className="mb-6 flex flex-wrap items-center gap-1.5">
        {([1, 2, 3, 4, 5] as Step[]).map((s, i) => (
          <div key={s} className="flex items-center gap-1.5">
            <span
              className={`whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold ${
                s === step
                  ? "bg-brand-500 text-white"
                  : s < step
                    ? "bg-signal-50 text-signal-600"
                    : "bg-ink/5 text-ink/40"
              }`}
            >
              {s}. {STEP_LABELS[s]}
            </span>
            {i < 4 && <ArrowRight className="h-3 w-3 text-ink/20" />}
          </div>
        ))}
      </div>

      {error && <p className="mb-4 text-sm text-alert-500">{error}</p>}

      {step === 1 && (
        <div>
          <h2 className="font-display text-lg font-semibold text-ink">
            What appliance needs repair?
          </h2>
          <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {APPLIANCES.map((a) => {
              const Icon = a.icon;
              const selected = applianceType === a.value;
              return (
                <button
                  key={a.value}
                  onClick={() => setApplianceType(a.value)}
                  className={`flex flex-col items-center gap-2 rounded-card border p-4 text-center transition ${
                    selected
                      ? "border-brand-500 bg-brand-50"
                      : "border-ink/8 bg-white hover:border-brand-300"
                  }`}
                >
                  <Icon className={`h-6 w-6 ${selected ? "text-brand-600" : "text-ink/50"}`} />
                  <span className="text-sm font-medium text-ink">{a.label}</span>
                </button>
              );
            })}
          </div>
          <button
            disabled={!applianceType}
            onClick={() => setStep(2)}
            className="mt-6 rounded-full bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-40"
          >
            Next step
          </button>
        </div>
      )}

      {step === 2 && (
        <div>
          <h2 className="font-display text-lg font-semibold text-ink">Describe the problem</h2>
          <div className="mt-4 space-y-3">
            <textarea
              required
              rows={4}
              value={issueDescription}
              onChange={(e) => setIssueDescription(e.target.value)}
              placeholder="e.g. Not cooling, making a loud buzzing noise"
              className="w-full rounded-lg border border-ink/15 px-3 py-2 text-sm"
            />
            <input
              required
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              placeholder="Your location (Barangay, City)"
              className="w-full rounded-lg border border-ink/15 px-3 py-2 text-sm"
            />
          </div>
          <div className="mt-6 flex gap-2">
            <button
              onClick={() => setStep(1)}
              className="rounded-full border border-ink/15 px-5 py-2.5 text-sm font-medium text-ink/70"
            >
              Back
            </button>
            <button
              disabled={!issueDescription || !location || submitting}
              onClick={submitAndFindTechnician}
              className="rounded-full bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-40"
            >
              {submitting ? "Submitting..." : "Next step"}
            </button>
          </div>
        </div>
      )}

      {step === 3 && applianceType && (
        <div>
          <h2 className="font-display text-lg font-semibold text-ink">Technician</h2>
          <div className="mt-4">
            <AssignmentStatusCard
              status={assignmentStatus}
              applianceType={applianceType}
              technician={assignedTechnician}
              onBackToAppliances={() => {
                setStep(1);
                setServiceRequestId(null);
                setAssignedTechnician(null);
              }}
            />
          </div>
          <div className="mt-6 flex gap-2">
            <button
              onClick={() => setStep(2)}
              className="rounded-full border border-ink/15 px-5 py-2.5 text-sm font-medium text-ink/70"
            >
              Back
            </button>
            <button
              disabled={assignmentStatus !== "accepted"}
              onClick={() => setStep(4)}
              className="rounded-full bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-40"
            >
              Next step
            </button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div>
          <h2 className="font-display text-lg font-semibold text-ink">Pick a schedule</h2>
          <input
            type="datetime-local"
            value={scheduledAt}
            onChange={(e) => setScheduledAt(e.target.value)}
            className="mt-4 w-full rounded-lg border border-ink/15 px-3 py-2 text-sm"
          />
          <div className="mt-6 flex gap-2">
            <button
              onClick={() => setStep(3)}
              className="rounded-full border border-ink/15 px-5 py-2.5 text-sm font-medium text-ink/70"
            >
              Back
            </button>
            <button
              disabled={!scheduledAt}
              onClick={() => setStep(5)}
              className="rounded-full bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-40"
            >
              Next step
            </button>
          </div>
        </div>
      )}

      {step === 5 && (
        <div>
          <h2 className="font-display text-lg font-semibold text-ink">Confirm your request</h2>
          <div className="mt-4 space-y-2 rounded-card border border-ink/8 bg-white p-4 shadow-card">
            <SummaryRow label="Appliance" value={selectedAppliance?.label ?? "—"} />
            <SummaryRow label="Issue" value={issueDescription} />
            <SummaryRow label="Location" value={location} />
            <SummaryRow label="Technician" value={assignedTechnician?.name ?? "—"} />
            <SummaryRow
              label="Schedule"
              value={scheduledAt ? new Date(scheduledAt).toLocaleString() : "—"}
            />
          </div>
          <p className="mt-3 text-xs text-ink/45">
            Your technician will send a cost estimate. You can choose a schedule and create the booking after accepting it.
          </p>
          <div className="mt-6 flex gap-2">
            <button
              onClick={() => setStep(4)}
              className="rounded-full border border-ink/15 px-5 py-2.5 text-sm font-medium text-ink/70"
            >
              Back
            </button>
            <button
              onClick={handleConfirm}
              disabled={submitting}
              className="rounded-full bg-signal-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-signal-600 disabled:opacity-50"
            >
              View request and await estimate
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span className="text-ink/40">{label}</span>
      <span className="text-right font-medium text-ink">{value}</span>
    </div>
  );
}
