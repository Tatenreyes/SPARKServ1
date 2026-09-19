"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, AlertCircle, Wrench } from "lucide-react";
import AssignmentStatusCard from "@/components/AssignmentStatusCard";
import { createClient } from "@/lib/supabase/client";
import type { ApplianceRow, AssignmentStatus } from "@/types/database";

type Step = 1 | 2 | 3 | 4 | 5 | 6;

const APPLIANCE_TYPES = [
  "Refrigerator",
  "Air Conditioner",
  "Washing Machine",
  "Television",
  "Electric Fan",
  "Microwave Oven",
  "Rice Cooker",
  "Electric Stove",
  "Induction Cooker",
  "Water Dispenser",
  "Electric Kettle",
  "Vacuum Cleaner",
  "Clothes Dryer",
  "Freezer",
  "Water Heater",
];

const APPLIANCE_PROBLEMS: Record<string, string[]> = {
  Refrigerator: ["Not cooling", "Not turning on", "Leaking water", "Making unusual noise", "Not making ice", "Freezer not freezing", "Over-freezing", "Not defrosting", "Error code", "Other"],
  "Air Conditioner": ["Not cooling", "Not turning on", "Leaking water", "Weak airflow", "Making noise", "Remote not working", "Ice/frost formation", "Error code", "Other"],
  "Washing Machine": ["Not spinning", "Not draining", "Not filling", "Leaking", "Making noise", "Not turning on", "Error code", "Other"],
  Television: ["No display", "No sound", "Screen flickering", "Lines on screen", "Remote not working", "Error code", "Other"],
  "Electric Fan": ["Not turning on", "Not spinning", "Making noise", "Weak airflow", "Other"],
  "Microwave Oven": ["Not turning on", "Not heating", "Making noise", "Error code", "Other"],
  "Rice Cooker": ["Not turning on", "Not cooking", "Leaking", "Error code", "Other"],
  "Electric Stove": ["Not turning on", "Not heating", "Error code", "Other"],
  "Induction Cooker": ["Not turning on", "Not heating", "Error code", "Other"],
  "Water Dispenser": ["Not dispensing", "Not cooling/heating", "Leaking", "Error code", "Other"],
  "Electric Kettle": ["Not turning on", "Not heating", "Leaking", "Error code", "Other"],
  "Vacuum Cleaner": ["Not turning on", "Weak suction", "Making noise", "Error code", "Other"],
  "Clothes Dryer": ["Not spinning", "Not heating", "Not draining", "Error code", "Other"],
  Freezer: ["Not freezing", "Not turning on", "Leaking water", "Making noise", "Error code", "Other"],
  "Water Heater": ["Not heating", "Not turning on", "Leaking", "Error code", "Other"],
};

const BRANDS: Record<string, string[]> = {
  Refrigerator: ["Samsung", "LG", "Panasonic", "Whirlpool", "Haier", "Condura", "Fujidenzo", "Sharp", "Electrolux", "Other"],
  "Air Conditioner": ["Samsung", "LG", "Panasonic", "Daikin", "Mitsubishi", "Carrier", "Other"],
  "Washing Machine": ["Samsung", "LG", "Panasonic", "Whirlpool", "Haier", "Condura", "Fujidenzo", "Other"],
};

export default function RequestRepairWizard() {
  const router = useRouter();
  const supabase = createClient();
  const [step, setStep] = useState<Step>(1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedApplianceId, setSelectedApplianceId] = useState<string | null>(null);
  const [customerAppliances, setCustomerAppliances] = useState<ApplianceRow[]>([]);
  const [useExisting, setUseExisting] = useState(false);

  const [applianceType, setApplianceType] = useState("");
  const [brand, setBrand] = useState("");
  const [modelNumber, setModelNumber] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [warrantyStatus, setWarrantyStatus] = useState("unknown");
  const [warrantyType, setWarrantyType] = useState("");
  const [warrantyExpiryDate, setWarrantyExpiryDate] = useState("");

  const [selectedProblem, setSelectedProblem] = useState("");
  const [problemDescription, setProblemDescription] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);

  const [serviceRequestId, setServiceRequestId] = useState<string | null>(null);
  const [assignmentStatus, setAssignmentStatus] = useState<AssignmentStatus>("matching");
  const [assignedTechnician, setAssignedTechnician] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    if (useExisting && selectedApplianceId) {
      const appliance = customerAppliances.find((a) => a.id === selectedApplianceId);
      if (appliance) {
        setApplianceType(appliance.appliance_type);
        setBrand(appliance.brand ?? "");
        setModelNumber(appliance.model_number ?? "");
        setSerialNumber(appliance.serial_number ?? "");
        setPurchaseDate(appliance.purchase_date ?? "");
        setWarrantyStatus(appliance.warranty_status);
        setWarrantyType(appliance.warranty_type ?? "");
        setWarrantyExpiryDate(appliance.warranty_expiry_date ?? "");
      }
    }
  }, [useExisting, selectedApplianceId, customerAppliances]);

  useEffect(() => {
    async function loadCustomerAppliances() {
      const { data, error } = await supabase.from("appliances").select("*").order("created_at", { ascending: false });
      if (!error && data) {
        setCustomerAppliances(data);
      }
    }
    loadCustomerAppliances();
  }, [supabase]);

  function getProblemsForType(type: string): string[] {
    return APPLIANCE_PROBLEMS[type] || ["Other"];
  }

  async function createApplianceAndContinue() {
    setSubmitting(true);
    setError(null);

    try {
      const { data, error } = await supabase
        .from("appliances")
        .insert({
          appliance_type: applianceType,
          brand: brand || null,
          model_number: modelNumber || null,
          serial_number: serialNumber || null,
          purchase_date: purchaseDate || null,
          warranty_status: warrantyStatus,
          warranty_type: warrantyType || null,
          warranty_expiry_date: warrantyExpiryDate || null,
        })
        .select()
        .single();

      if (error) throw error;
      setSelectedApplianceId(data.id);
      setStep(3);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save appliance");
    } finally {
      setSubmitting(false);
    }
  }

  async function submitServiceRequest() {
    if (!selectedApplianceId) {
      setError("Please select or create an appliance first");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/service-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appliance_id: selectedApplianceId,
          appliance_type: applianceType,
          issue_category: selectedProblem,
          problem_description: problemDescription,
          photos,
          chatbot_resolved: false,
        }),
      });

      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Failed to submit request");

      setServiceRequestId(json.data.id);
      setAssignmentStatus(json.data.assignment_status);
      setAssignedTechnician(json.assigned_technician ?? null);
      setStep(6);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  const stepLabels: Record<number, string> = {
    1: "Appliance",
    2: "Details",
    3: "Problem",
    4: "Photos",
    5: "Review",
    6: "Queue",
  };

  return (
    <div className="max-w-2xl">
      <div className="mb-6 flex flex-wrap items-center gap-1.5">
        {([1, 2, 3, 4, 5, 6] as Step[]).map((s) => (
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
              {s}. {stepLabels[s]}
            </span>
            {s < 6 && <ArrowRight className="h-3 w-3 text-ink/20" />}
          </div>
        ))}
      </div>

      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {step === 1 && (
        <div className="space-y-4">
          <h2 className="font-display text-lg font-semibold text-ink">What appliance needs repair?</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {APPLIANCE_TYPES.map((type) => (
              <button
                key={type}
                onClick={() => {
                  setApplianceType(type);
                  setStep(2);
                }}
                className={`flex flex-col items-center gap-2 rounded-xl border p-4 text-center transition ${
                  applianceType === type ? "border-brand-500 bg-brand-50" : "border-ink/8 bg-white hover:border-brand-300"
                }`}
              >
                <Wrench className={`h-6 w-6 ${applianceType === type ? "text-brand-600" : "text-ink/50"}`} />
                <span className="text-sm font-medium text-ink">{type}</span>
              </button>
            ))}
          </div>

          {customerAppliances.length > 0 && (
            <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
              <p className="text-sm font-semibold text-slate-900">Or select an existing appliance:</p>
              <div className="mt-3 space-y-2">
                {customerAppliances.map((appliance) => (
                  <button
                    key={appliance.id}
                    onClick={() => {
                      setSelectedApplianceId(appliance.id);
                      setUseExisting(true);
                      setStep(3);
                    }}
                    className="flex w-full items-center justify-between rounded-xl border border-slate-200 p-3 text-left transition hover:border-brand-200"
                  >
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{appliance.appliance_type}</p>
                      <p className="text-xs text-slate-500">
                        {appliance.brand} {appliance.model_number} • {appliance.warranty_status === "yes" ? "Under warranty" : "No warranty"}
                      </p>
                    </div>
                    <ArrowRight className="h-4 w-4 text-slate-300" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {step === 2 && (
        <div className="space-y-4">
          <h2 className="font-display text-lg font-semibold text-ink">Appliance Details</h2>
          <p className="text-sm text-slate-600">Tell us more about your {applianceType}.</p>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink/80">Brand *</label>
              <select
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                className="w-full rounded-xl border border-ink/10 bg-white px-3.5 py-2.5 text-sm"
              >
                <option value="">Select brand</option>
                {(BRANDS[applianceType] || ["Other"]).map((b) => (
                  <option key={b} value={b}>{b}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink/80">Model Number</label>
              <input
                value={modelNumber}
                onChange={(e) => setModelNumber(e.target.value)}
                className="w-full rounded-xl border border-ink/10 bg-white px-3.5 py-2.5 text-sm"
                placeholder="Model number"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink/80">Serial Number</label>
              <input
                value={serialNumber}
                onChange={(e) => setSerialNumber(e.target.value)}
                className="w-full rounded-xl border border-ink/10 bg-white px-3.5 py-2.5 text-sm"
                placeholder="Serial number"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink/80">Purchase Date</label>
              <input
                type="date"
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
                className="w-full rounded-xl border border-ink/10 bg-white px-3.5 py-2.5 text-sm"
              />
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-ink/80">Is this appliance still under warranty? *</label>
            <div className="flex gap-4">
              {["yes", "no", "unknown"].map((option) => (
                <label key={option} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="warranty"
                    value={option}
                    checked={warrantyStatus === option}
                    onChange={(e) => setWarrantyStatus(e.target.value)}
                    className="h-4 w-4"
                  />
                  <span className="text-sm text-slate-700 capitalize">{option === "unknown" ? "Not Sure" : option}</span>
                </label>
              ))}
            </div>
          </div>

          {warrantyStatus === "yes" && (
            <div className="grid gap-4 sm:grid-cols-2 rounded-xl border border-brand-100 bg-brand-50 p-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-ink/80">Warranty Type</label>
                <select
                  value={warrantyType}
                  onChange={(e) => setWarrantyType(e.target.value)}
                  className="w-full rounded-xl border border-ink/10 bg-white px-3.5 py-2.5 text-sm"
                >
                  <option value="">Select type</option>
                  <option value="Manufacturer Warranty">Manufacturer Warranty</option>
                  <option value="Extended Warranty">Extended Warranty</option>
                  <option value="Store Warranty">Store Warranty</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-ink/80">Warranty Expiry Date</label>
                <input
                  type="date"
                  value={warrantyExpiryDate}
                  onChange={(e) => setWarrantyExpiryDate(e.target.value)}
                  className="w-full rounded-xl border border-ink/10 bg-white px-3.5 py-2.5 text-sm"
                />
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setStep(1)}
              className="rounded-full border border-ink/15 px-5 py-2.5 text-sm font-medium text-ink/70"
            >
              Back
            </button>
            <button
              onClick={createApplianceAndContinue}
              disabled={submitting || !brand}
              className="rounded-full bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-40"
            >
              {submitting ? "Saving..." : "Next step"}
            </button>
          </div>
        </div>
      )}

      {step === 3 && (
        <div className="space-y-4">
          <h2 className="font-display text-lg font-semibold text-ink">What problem are you experiencing?</h2>
          <p className="text-sm text-slate-600">Select the issue that best describes your {applianceType}.</p>

          <div className="grid grid-cols-2 gap-3">
            {getProblemsForType(applianceType).map((problem) => (
              <button
                key={problem}
                onClick={() => setSelectedProblem(problem)}
                className={`rounded-xl border p-3 text-left text-sm transition ${
                  selectedProblem === problem ? "border-brand-500 bg-brand-50" : "border-ink/8 bg-white hover:border-brand-300"
                }`}
              >
                {problem}
              </button>
            ))}
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-ink/80">Describe the problem</label>
            <textarea
              value={problemDescription}
              onChange={(e) => setProblemDescription(e.target.value)}
              rows={4}
              className="w-full rounded-xl border border-ink/10 bg-white px-3.5 py-2.5 text-sm"
              placeholder="Tell us what happened..."
            />
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setStep(2)}
              className="rounded-full border border-ink/15 px-5 py-2.5 text-sm font-medium text-ink/70"
            >
              Back
            </button>
            <button
              onClick={() => setStep(4)}
              disabled={!selectedProblem || !problemDescription}
              className="rounded-full bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-40"
            >
              Next step
            </button>
          </div>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-4">
          <h2 className="font-display text-lg font-semibold text-ink">Add Photos (Optional)</h2>
          <p className="text-sm text-slate-600">Upload photos of the appliance, model label, or problem area.</p>

          <div className="rounded-2xl border-2 border-dashed border-slate-300 p-8 text-center">
            <input
              type="file"
              multiple
              accept="image/*,video/*"
              onChange={(e) => {
                const files = Array.from(e.target.files || []);
                const urls = files.map((f) => URL.createObjectURL(f));
                setPhotos([...photos, ...urls]);
              }}
              className="hidden"
              id="photo-upload"
            />
            <label htmlFor="photo-upload" className="cursor-pointer">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600">
                <Wrench className="h-6 w-6" />
              </div>
              <p className="mt-2 text-sm font-medium text-slate-700">Click to upload photos or videos</p>
              <p className="mt-1 text-xs text-slate-500">PNG, JPG, MP4 up to 10MB</p>
            </label>
          </div>

          {photos.length > 0 && (
            <div className="grid grid-cols-3 gap-3">
              {photos.map((url, index) => (
                <div key={index} className="relative aspect-square rounded-xl border border-slate-200 bg-slate-50">
                  <img src={url} alt={`Upload ${index + 1}`} className="h-full w-full rounded-xl object-cover" />
                  <button
                    onClick={() => setPhotos(photos.filter((_, i) => i !== index))}
                    className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-white"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setStep(3)}
              className="rounded-full border border-ink/15 px-5 py-2.5 text-sm font-medium text-ink/70"
            >
              Back
            </button>
            <button
              onClick={() => setStep(5)}
              className="rounded-full bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-600"
            >
              Next step
            </button>
          </div>
        </div>
      )}

      {step === 5 && (
        <div className="space-y-4">
          <h2 className="font-display text-lg font-semibold text-ink">Review Your Request</h2>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 space-y-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Appliance</p>
              <p className="mt-1 text-sm font-medium text-slate-900">{applianceType}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Brand / Model</p>
              <p className="mt-1 text-sm text-slate-700">{brand} {modelNumber}</p>
            </div>
            {serialNumber && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Serial Number</p>
                <p className="mt-1 text-sm text-slate-700">{serialNumber}</p>
              </div>
            )}
            {purchaseDate && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Purchase Date</p>
                <p className="mt-1 text-sm text-slate-700">{new Date(purchaseDate).toLocaleDateString()}</p>
              </div>
            )}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Warranty Status</p>
              <p className="mt-1 text-sm text-slate-700 capitalize">{warrantyStatus}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Problem</p>
              <p className="mt-1 text-sm font-medium text-slate-900">{selectedProblem}</p>
              <p className="mt-1 text-sm text-slate-600">{problemDescription}</p>
            </div>
            {photos.length > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">Photos</p>
                <div className="mt-2 grid grid-cols-3 gap-2">
                  {photos.map((url, index) => (
                    <img key={index} src={url} alt={`Upload ${index + 1}`} className="h-20 w-full rounded-lg object-cover" />
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setStep(4)}
              className="rounded-full border border-ink/15 px-5 py-2.5 text-sm font-medium text-ink/70"
            >
              Back
            </button>
            <button
              onClick={submitServiceRequest}
              disabled={submitting}
              className="rounded-full bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-40"
            >
              {submitting ? "Submitting..." : "Submit Request"}
            </button>
          </div>
        </div>
      )}

      {step === 6 && (
        <div>
          {serviceRequestId && (
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
          )}
          {assignmentStatus === "accepted" && (
            <div className="mt-6 flex gap-2">
              <button
                onClick={() => router.push(`/customer/service-request/${serviceRequestId}`)}
                className="rounded-full bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-600"
              >
                View Request <ArrowRight className="ml-2 h-4 w-4 inline" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
