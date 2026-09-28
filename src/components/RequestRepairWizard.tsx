"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Wrench, CheckCircle2 } from "lucide-react";
import AssignmentStatusCard from "@/components/AssignmentStatusCard";
import { createClient } from "@/lib/supabase/client";
import type { ApplianceRow, AssignmentStatus } from "@/types/database";

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
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [serviceRequestId, setServiceRequestId] = useState<string | null>(null);
  const [assignmentStatus, setAssignmentStatus] = useState<AssignmentStatus>("matching");
  const [assignedTechnician, setAssignedTechnician] = useState<{ id: string; name: string } | null>(null);
  const [offersExpiresAt, setOffersExpiresAt] = useState<string | null>(null);

  const [applianceType, setApplianceType] = useState("");
  const [brand, setBrand] = useState("");
  const [modelNumber, setModelNumber] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [purchaseDate, setPurchaseDate] = useState("");
  const [warrantyStatus, setWarrantyStatus] = useState("unknown");
  const [warrantyExpiryDate, setWarrantyExpiryDate] = useState("");
  const [selectedProblem, setSelectedProblem] = useState("");
  const [problemDescription, setProblemDescription] = useState("");
  const [photos, setPhotos] = useState<string[]>([]);
  const [serviceType, setServiceType] = useState("on_site");
  const [preferredDate, setPreferredDate] = useState("");
  const [preferredStart, setPreferredStart] = useState("");
  const [preferredEnd, setPreferredEnd] = useState("");
  const [serviceAddress, setServiceAddress] = useState("");
  const [additionalNotes, setAdditionalNotes] = useState("");

  const [customerAppliances, setCustomerAppliances] = useState<ApplianceRow[]>([]);
  const [useExistingAppliance, setUseExistingAppliance] = useState(false);
  const [selectedExistingId, setSelectedExistingId] = useState<string | null>(null);

  useEffect(() => {
    async function loadAppliances() {
      const { data } = await supabase.from("appliances").select("*").order("created_at", { ascending: false });
      if (data) setCustomerAppliances(data);
    }
    loadAppliances();
  }, [supabase]);

  useEffect(() => {
    if (useExistingAppliance && selectedExistingId) {
      const appliance = customerAppliances.find((a) => a.id === selectedExistingId);
      if (appliance) {
        setApplianceType(appliance.appliance_type);
        setBrand(appliance.brand ?? "");
        setModelNumber(appliance.model_number ?? "");
        setSerialNumber(appliance.serial_number ?? "");
        setPurchaseDate(appliance.purchase_date ?? "");
        setWarrantyStatus(appliance.warranty_status);
        setWarrantyExpiryDate(appliance.warranty_expiry_date ?? "");
      }
    }
  }, [useExistingAppliance, selectedExistingId, customerAppliances]);

  function getProblemsForType(type: string): string[] {
    return APPLIANCE_PROBLEMS[type] || ["Other"];
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    // A requested window has to be a real window: the queue compares it against
    // bookings, so an end time at or before the start would match nobody.
    if (preferredDate && (preferredStart || preferredEnd) && !(preferredStart && preferredEnd)) {
      setError("Fill in both a start and an end time, or leave both blank.");
      setSubmitting(false);
      return;
    }
    if (preferredDate && preferredStart && preferredEnd && preferredEnd <= preferredStart) {
      setError("The preferred end time must be after the start time.");
      setSubmitting(false);
      return;
    }

    try {
      let applianceId: string | null = null;

      if (useExistingAppliance && selectedExistingId) {
        applianceId = selectedExistingId;
      } else {
        const { data: appliance, error: applianceError } = await supabase
          .from("appliances")
          .insert({
            appliance_type: applianceType,
            brand: brand || null,
            model_number: modelNumber || null,
            serial_number: serialNumber || null,
            purchase_date: purchaseDate || null,
            warranty_status: warrantyStatus,
            warranty_expiry_date: warrantyExpiryDate || null,
          })
          .select()
          .single();

        if (applianceError) throw applianceError;
        applianceId = appliance.id;
      }

      const res = await fetch("/api/service-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          appliance_id: applianceId,
          appliance_type: applianceType,
          issue_category: selectedProblem,
          problem_description: problemDescription,
          photos,
          service_type: serviceType,
          location: serviceAddress,
          chatbot_resolved: false,
          ...(preferredDate
            ? {
                preferred_date: preferredDate,
                ...(preferredStart ? { preferred_start_time: preferredStart } : {}),
                ...(preferredEnd ? { preferred_end_time: preferredEnd } : {}),
              }
            : {}),
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        // The API returns `detail` in development only; prefer it when present
        // so a schema problem reads as "42703: column ... does not exist"
        // instead of an unexplained failure.
        const detail = json.detail?.message
          ? ` — ${json.detail.code ?? "error"}: ${json.detail.message}`
          : "";
        throw new Error((json.error ?? "Failed to submit request") + detail);
      }

      setServiceRequestId(json.data.id);
      setAssignmentStatus(json.data.assignment_status);
      setAssignedTechnician(json.assigned_technician ?? null);
      setOffersExpiresAt(json.data.offers_expires_at ?? null);
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted && serviceRequestId) {
    return (
      <div className="max-w-2xl">
        <div className="rounded-2xl border border-line bg-signal-soft p-8 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-signal-soft text-signal-ink">
            <CheckCircle2 className="h-7 w-7" />
          </div>
          <h2 className="mt-4 font-display text-xl font-semibold text-ink">Repair Request Submitted</h2>
          <p className="mt-2 text-sm text-muted">Your request has been submitted successfully. The system will check eligible technicians and place your request in the technician queue.</p>
          <div className="mt-6">
            <button
              onClick={() => router.push(`/customer/service-request/${serviceRequestId}`)}
              className="inline-flex h-11 items-center justify-center rounded-xl bg-brand-600 px-6 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700"
            >
              View Repair Status
            </button>
          </div>
        </div>

        <div className="mt-6">
          <AssignmentStatusCard
            status={assignmentStatus}
            applianceType={applianceType}
            technician={assignedTechnician}
            offersExpiresAt={offersExpiresAt}
            onBackToAppliances={() => {
              setSubmitted(false);
              setServiceRequestId(null);
              setAssignedTechnician(null);
            }}
          />
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-3xl space-y-8">
      <div>
        <h1 className="font-display text-2xl font-semibold text-ink">Request a Repair</h1>
        <p className="mt-1 text-sm text-ink/65">Fill out the form below and we will match you with a qualified technician.</p>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl bg-alert-soft px-4 py-3 text-sm text-alert-ink">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Section 1: Appliance Information */}
      <section className="rounded-2xl border border-line bg-surface p-6 shadow-sm">
        <h2 className="font-display text-lg font-semibold text-ink">1. Appliance Information</h2>

        {customerAppliances.length > 0 && (
          <div className="mt-4 rounded-xl border border-line bg-brand-soft p-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={useExistingAppliance}
                onChange={(e) => setUseExistingAppliance(e.target.checked)}
                className="h-4 w-4"
              />
              <span className="text-sm font-medium text-ink/80">Use an existing appliance</span>
            </label>
            {useExistingAppliance && (
              <select
                value={selectedExistingId ?? ""}
                onChange={(e) => setSelectedExistingId(e.target.value)}
                className="mt-3 w-full rounded-xl border border-ink/10 bg-surface px-3.5 py-2.5 text-sm"
              >
                <option value="">Select an appliance</option>
                {customerAppliances.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.appliance_type} {a.brand ? `• ${a.brand}` : ""}
                  </option>
                ))}
              </select>
            )}
          </div>
        )}

        {!useExistingAppliance && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink/80">Appliance *</label>
              <select
                value={applianceType}
                onChange={(e) => setApplianceType(e.target.value)}
                required
                className="w-full rounded-xl border border-ink/10 bg-surface px-3.5 py-2.5 text-sm"
              >
                <option value="">Select appliance</option>
                {APPLIANCE_TYPES.map((type) => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink/80">Brand *</label>
              <select
                value={brand}
                onChange={(e) => setBrand(e.target.value)}
                required
                className="w-full rounded-xl border border-ink/10 bg-surface px-3.5 py-2.5 text-sm"
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
                className="w-full rounded-xl border border-ink/10 bg-surface px-3.5 py-2.5 text-sm"
                placeholder="Model number"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink/80">Serial Number</label>
              <input
                value={serialNumber}
                onChange={(e) => setSerialNumber(e.target.value)}
                className="w-full rounded-xl border border-ink/10 bg-surface px-3.5 py-2.5 text-sm"
                placeholder="Serial number"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink/80">Purchase Date</label>
              <input
                type="date"
                value={purchaseDate}
                onChange={(e) => setPurchaseDate(e.target.value)}
                className="w-full rounded-xl border border-ink/10 bg-surface px-3.5 py-2.5 text-sm"
              />
            </div>
          </div>
        )}

        <div className="mt-4">
          <label className="mb-2 block text-sm font-medium text-ink/80">Is it still under warranty? *</label>
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
                <span className="text-sm text-ink/80 capitalize">{option === "unknown" ? "Not Sure" : option}</span>
              </label>
            ))}
          </div>
        </div>

        {warrantyStatus === "yes" && (
          <div className="mt-4 grid gap-4 sm:grid-cols-2 rounded-xl border border-line bg-brand-soft p-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-ink/80">Warranty Expiration Date</label>
              <input
                type="date"
                value={warrantyExpiryDate}
                onChange={(e) => setWarrantyExpiryDate(e.target.value)}
                className="w-full rounded-xl border border-ink/10 bg-surface px-3.5 py-2.5 text-sm"
              />
            </div>
          </div>
        )}
      </section>

      {/* Section 2: Describe the Problem */}
      <section className="rounded-2xl border border-line bg-surface p-6 shadow-sm">
        <h2 className="font-display text-lg font-semibold text-ink">2. Describe the Problem</h2>

        <div className="mt-4">
          <label className="mb-1 block text-sm font-medium text-ink/80">What problem are you experiencing? *</label>
          <select
            value={selectedProblem}
            onChange={(e) => setSelectedProblem(e.target.value)}
            required
            className="w-full rounded-xl border border-ink/10 bg-surface px-3.5 py-2.5 text-sm"
          >
            <option value="">Select problem</option>
            {getProblemsForType(applianceType || "Refrigerator").map((problem) => (
              <option key={problem} value={problem}>{problem}</option>
            ))}
          </select>
        </div>

        <div className="mt-4">
          <label className="mb-1 block text-sm font-medium text-ink/80">Describe the problem</label>
          <textarea
            value={problemDescription}
            onChange={(e) => setProblemDescription(e.target.value)}
            rows={4}
            required
            className="w-full rounded-xl border border-ink/10 bg-surface px-3.5 py-2.5 text-sm"
            placeholder="Tell us what happened..."
          />
        </div>
      </section>

      {/* Section 3: Photos */}
      <section className="rounded-2xl border border-line bg-surface p-6 shadow-sm">
        <h2 className="font-display text-lg font-semibold text-ink">3. Photos / Evidence</h2>
        <p className="mt-1 text-sm text-muted">Upload photos of the appliance, model label, or problem area.</p>

        <div className="mt-4 rounded-2xl border-2 border-dashed border-ink/20 p-8 text-center">
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
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft text-brand-ink">
              <Wrench className="h-6 w-6" />
            </div>
            <p className="mt-2 text-sm font-medium text-ink/80">Click to upload photos or videos</p>
            <p className="mt-1 text-xs text-muted">PNG, JPG, MP4 up to 10MB</p>
          </label>
        </div>

        {photos.length > 0 && (
          <div className="mt-4 grid grid-cols-3 gap-3">
            {photos.map((url, index) => (
              <div key={index} className="relative aspect-square rounded-xl border border-line bg-soft">
                <img src={url} alt={`Upload ${index + 1}`} className="h-full w-full rounded-xl object-cover" />
                <button
                  type="button"
                  onClick={() => setPhotos(photos.filter((_, i) => i !== index))}
                  className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-red-500 text-white"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Section 4: Service Details */}
      <section className="rounded-2xl border border-line bg-surface p-6 shadow-sm">
        <h2 className="font-display text-lg font-semibold text-ink">4. Service Details</h2>

        <div className="mt-4">
          <label className="mb-2 block text-sm font-medium text-ink/80">Service Type *</label>
          <div className="flex gap-4">
            {[
              { value: "on_site", label: "On-site Repair" },
              { value: "home_service", label: "Home Service" },
              { value: "pickup_return", label: "Pickup & Return" },
            ].map((option) => (
              <label key={option.value} className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="service_type"
                  value={option.value}
                  checked={serviceType === option.value}
                  onChange={(e) => setServiceType(e.target.value)}
                  className="h-4 w-4"
                />
                <span className="text-sm text-ink/80">{option.label}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-ink/80">Preferred Service Date</label>
            <input
              type="date"
              value={preferredDate}
              onChange={(e) => setPreferredDate(e.target.value)}
              className="w-full rounded-xl border border-ink/10 bg-surface px-3.5 py-2.5 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink/80">Service Address</label>
            <input
              value={serviceAddress}
              onChange={(e) => setServiceAddress(e.target.value)}
              required
              className="w-full rounded-xl border border-ink/10 bg-surface px-3.5 py-2.5 text-sm"
              placeholder="Enter service address"
            />
          </div>

          <div className="sm:col-span-2">
            <label className="mb-1 block text-sm font-medium text-ink/80">
              Preferred Time Window <span className="font-normal text-ink/40">(optional)</span>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <input
                type="time"
                aria-label="Preferred start time"
                value={preferredStart}
                onChange={(e) => setPreferredStart(e.target.value)}
                disabled={!preferredDate}
                className="w-full rounded-xl border border-ink/10 bg-surface px-3.5 py-2.5 text-sm disabled:opacity-50"
              />
              <input
                type="time"
                aria-label="Preferred end time"
                value={preferredEnd}
                onChange={(e) => setPreferredEnd(e.target.value)}
                disabled={!preferredDate}
                className="w-full rounded-xl border border-ink/10 bg-surface px-3.5 py-2.5 text-sm disabled:opacity-50"
              />
            </div>
            <p className="mt-1 text-xs text-ink/50">
              Times are Philippine time (GMT+8). Leave them blank if any time that day works —
              only technicians free in your window get offered the job, and you confirm the exact
              slot with your technician before the visit.
            </p>
          </div>
        </div>

        <div className="mt-4">
          <label className="mb-1 block text-sm font-medium text-ink/80">Additional Notes</label>
          <textarea
            value={additionalNotes}
            onChange={(e) => setAdditionalNotes(e.target.value)}
            rows={3}
            className="w-full rounded-xl border border-ink/10 bg-surface px-3.5 py-2.5 text-sm"
            placeholder="Anything else the technician should know..."
          />
        </div>
      </section>

      {/* Section 5: Summary */}
      <section className="rounded-2xl border border-line bg-surface p-6 shadow-sm">
        <h2 className="font-display text-lg font-semibold text-ink">Repair Request Summary</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <SummaryRow label="Appliance" value={applianceType || "—"} />
          <SummaryRow label="Brand" value={brand || "—"} />
          {modelNumber && <SummaryRow label="Model" value={modelNumber} />}
          {serialNumber && <SummaryRow label="Serial" value={serialNumber} />}
          <SummaryRow label="Warranty" value={warrantyStatus === "yes" ? "Yes" : warrantyStatus === "no" ? "No" : "Not Sure"} />
          <SummaryRow label="Problem" value={selectedProblem || "—"} />
          <SummaryRow label="Service Type" value={serviceType === "on_site" ? "On-site Repair" : serviceType === "home_service" ? "Home Service" : "Pickup & Return"} />
          <SummaryRow label="Service Address" value={serviceAddress || "—"} />
          {preferredDate && !preferredStart && (
            <SummaryRow
              label="Preferred Date"
              value={`${new Date(`${preferredDate}T00:00:00`).toLocaleDateString()} — time to be agreed`}
            />
          )}
          {preferredDate && preferredStart && preferredEnd && (
            <SummaryRow
              label="Preferred Date"
              value={new Date(`${preferredDate}T00:00:00`).toLocaleDateString()}
            />
          )}
          {preferredDate && preferredStart && preferredEnd && (
            <SummaryRow label="Preferred Window" value={`${preferredStart} – ${preferredEnd} (PH time)`} />
          )}
        </div>
      </section>

      <button
        type="submit"
        disabled={submitting}
        className="w-full rounded-xl bg-brand-600 px-6 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 disabled:opacity-60"
      >
        {submitting ? "Submitting..." : "Submit Repair Request"}
      </button>
    </form>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-muted">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-ink">{value}</p>
    </div>
  );
}
