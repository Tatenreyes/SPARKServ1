"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSearchParams } from "next/navigation";
import Image from "next/image";
import {
  Snowflake,
  Wind,
  Waves,
  Droplet,
  Zap,
  Tv,
  Wrench,
  Check,
  ArrowRight,
} from "lucide-react";
import type { ChatbotSuggestion } from "@/types";

const APPLIANCES: { value: string; label: string; icon: React.ElementType; image: string }[] = [
  { value: "refrigerator", label: "Refrigerator", icon: Snowflake, image: "/images/Refrigerator-Repair-Service-Repair-Factor-1.webp" },
  { value: "aircon", label: "Air Conditioner", icon: Wind, image: "/images/about-image-1.jpg" },
  { value: "washing_machine", label: "Washing Machine", icon: Waves, image: "/images/background-1536x1025-1-1.jpeg" },
  { value: "tv", label: "Television", icon: Tv, image: "/images/tv repairs.jpg" },
  { value: "electric_fan", label: "Electric Fan", icon: Wind, image: "" },
  { value: "microwave", label: "Microwave Oven", icon: Zap, image: "/images/Microwave-Oven-Repairing.jpg" },
  { value: "rice_cooker", label: "Rice Cooker", icon: Zap, image: "" },
  { value: "electric_stove", label: "Electric Stove", icon: Zap, image: "" },
  { value: "induction_cooker", label: "Induction Cooker", icon: Zap, image: "" },
  { value: "water_dispenser", label: "Water Dispenser", icon: Droplet, image: "/images/waterdispenser.jpg" },
  { value: "electric_kettle", label: "Electric Kettle", icon: Droplet, image: "" },
  { value: "vacuum_cleaner", label: "Vacuum Cleaner", icon: Wind, image: "" },
  { value: "clothes_dryer", label: "Clothes Dryer", icon: Waves, image: "" },
  { value: "freezer", label: "Freezer", icon: Snowflake, image: "" },
  { value: "water_heater", label: "Water Heater", icon: Droplet, image: "" },
  { value: "other", label: "Other", icon: Wrench, image: "" },
];

type Step = "appliance" | "issue" | "troubleshooting";

export default function InquiryWizard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [step, setStep] = useState<Step>("appliance");
  const [applianceType, setApplianceType] = useState<string | null>(null);
  const [issueDescription, setIssueDescription] = useState("");
  const [location, setLocation] = useState("");
  const [suggestion, setSuggestion] = useState<ChatbotSuggestion | null>(null);
  const [checkingTips, setCheckingTips] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const appliance = searchParams.get("appliance");
    const issue = searchParams.get("issue");
    if (!appliance || !APPLIANCES.some((item) => item.value === appliance)) return;

    setApplianceType(appliance);
    if (issue) {
      const issueLabel = issue.split("-").map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(" ");
      setIssueDescription(issueLabel);
      setStep("issue");
    }
  }, [searchParams]);

  async function goToTroubleshooting() {
    setCheckingTips(true);
    setError(null);
    try {
      const res = await fetch("/api/chatbot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: issueDescription, applianceType }),
      });
      const json = await res.json();
      setSuggestion(json.data);
      setStep("troubleshooting");
    } catch {
      setError("Couldn't load troubleshooting tips — you can still request an estimate.");
      setStep("troubleshooting");
    } finally {
      setCheckingTips(false);
    }
  }

  async function requestEstimate() {
    setSubmitting(true);
    setError(null);
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

  const steps: { key: Step; label: string }[] = [
    { key: "appliance", label: "1. Appliance" },
    { key: "issue", label: "2. Describe problem" },
    { key: "troubleshooting", label: "3. Troubleshoot" },
  ];

  return (
    <div className="max-w-2xl">
      {/* Step indicator */}
      <div className="mb-6 flex items-center gap-2">
        {steps.map((s, i) => (
          <div key={s.key} className="flex items-center gap-2">
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                s.key === step
                  ? "bg-brand-500 text-white"
                  : steps.findIndex((x) => x.key === step) > i
                    ? "bg-signal-50 text-signal-600"
                    : "bg-ink/5 text-ink/40"
              }`}
            >
              {s.label}
            </span>
            {i < steps.length - 1 && <ArrowRight className="h-3 w-3 text-ink/20" />}
          </div>
        ))}
      </div>

      {step === "appliance" && (
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
                  className={`group flex flex-col items-center gap-2 rounded-card border p-4 text-center transition ${
                    selected
                      ? "border-brand-500 bg-brand-50"
                      : "border-ink/8 bg-white hover:border-brand-300"
                  }`}
                >
                  <div className={`relative h-20 w-full overflow-hidden rounded-lg ${a.image ? "bg-ink/5" : "bg-[linear-gradient(135deg,#eef5ff_0%,#dce8fb_50%,#eef5ff_100%)]"}`}>
                    {a.image ? <Image src={a.image} alt="" fill sizes="(max-width: 640px) 45vw, 180px" className="object-cover transition duration-300 group-hover:scale-105" /> : <div className="absolute inset-0 bg-[repeating-linear-gradient(135deg,rgba(14,66,159,0.08)_0,rgba(14,66,159,0.08)_2px,transparent_2px,transparent_10px)]" />}
                    <div className={`absolute inset-0 ${a.image ? "bg-gradient-to-t from-slate-950/35 to-transparent" : "bg-gradient-to-t from-brand-900/10 to-transparent"}`} />
                    <Icon className={`absolute bottom-2 left-2 h-5 w-5 ${selected ? "text-white" : "text-white/90"}`} />
                  </div>
                  <span className="text-sm font-medium text-ink">{a.label}</span>
                </button>
              );
            })}
          </div>
          <button
            disabled={!applianceType}
            onClick={() => setStep("issue")}
            className="mt-6 rounded-full bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-40"
          >
            Next step
          </button>
        </div>
      )}

      {step === "issue" && (
        <div>
          <h2 className="font-display text-lg font-semibold text-ink">
            Describe what&apos;s wrong
          </h2>
          <div className="mt-4 space-y-3">
            <textarea
              required
              rows={4}
              value={issueDescription}
              onChange={(e) => setIssueDescription(e.target.value)}
              placeholder="e.g. It's making a loud noise and not cooling anymore"
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
              onClick={() => setStep("appliance")}
              className="rounded-full border border-ink/15 px-5 py-2.5 text-sm font-medium text-ink/70"
            >
              Back
            </button>
            <button
              disabled={!issueDescription || !location || checkingTips}
              onClick={goToTroubleshooting}
              className="rounded-full bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-40"
            >
              {checkingTips ? "Checking..." : "Get troubleshooting tips"}
            </button>
          </div>
        </div>
      )}

      {step === "troubleshooting" && (
        <div>
          <h2 className="font-display text-lg font-semibold text-ink">
            Issue review and troubleshooting
          </h2>

          {suggestion ? (
            <div className="mt-4 rounded-card border border-ink/8 bg-white p-4 shadow-card">
              {suggestion.safetyWarning && <p className="mb-3 rounded-lg bg-alert-50 p-3 text-sm font-semibold text-alert-600">Safety warning: stop using the appliance and request professional help.</p>}
              <p className="text-sm text-ink">{suggestion.message}</p>
              {suggestion.needsClarification && suggestion.issueOptions && suggestion.issueOptions.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {suggestion.issueOptions.map((option) => (
                    <button
                      key={option.value}
                      onClick={async () => {
                        setCheckingTips(true);
                        const res = await fetch("/api/chatbot", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: issueDescription, applianceType, issueCategory: option.value }) });
                        const json = await res.json();
                        setSuggestion(json.data);
                        setCheckingTips(false);
                      }}
                      className="rounded-lg border border-brand-200 px-3 py-2 text-sm font-medium text-brand-700 hover:bg-brand-50"
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              )}
              {suggestion.tips.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {suggestion.tips.map((tip, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm text-ink/70">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-signal-500" />
                      {tip}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ) : (
            <p className="mt-3 text-sm text-ink/50">
              No specific tips available for this issue — a technician can take it from here.
            </p>
          )}

          {!suggestion?.needsClarification && <p className="mt-4 text-sm text-ink/65">Still not fixed?</p>}
          {error && <p className="mt-1 text-sm text-alert-500">{error}</p>}
          <div className="mt-3 flex gap-2">
            {!suggestion?.needsClarification && !suggestion?.safetyWarning && (
              <button
                onClick={() => {
                  if (suggestion) setSuggestion({ ...suggestion, message: "Troubleshooting marked as resolved.", tips: [], shouldEscalate: false });
                }}
                className="rounded-full border border-signal-500 px-5 py-2.5 text-sm font-medium text-signal-600"
              >
                Yes, it worked
              </button>
            )}
            {!suggestion?.needsClarification && (
              <button
                onClick={requestEstimate}
                disabled={submitting}
                className="rounded-full bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
              >
                {submitting ? "Submitting..." : "No, I still need help - Request an estimate"}
              </button>
            )}
            {suggestion?.needsClarification && (
              <button
              onClick={() => setStep("issue")}
              className="rounded-full border border-ink/15 px-5 py-2.5 text-sm font-medium text-ink/70"
            >
              Back
            </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
