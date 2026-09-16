"use client";

import { useState } from "react";
import Image from "next/image";
import { Wrench } from "lucide-react";
import { APPLIANCES } from "@/lib/appliances";
import type { ApplianceRow } from "@/types/database";

const APPLIANCE_TYPES = APPLIANCES.map((a) => a.value);

function ApplianceIcon({ type }: { type: string }) {
  const Icon = APPLIANCES.find((a) => a.value === type)?.icon ?? Wrench;
  return <Icon className="h-5 w-5" />;
}

function applianceImage(type: string) {
  return APPLIANCES.find((appliance) => appliance.value === type)?.image;
}

export default function AppliancesClient({
  initialAppliances,
  needsRepairTypes,
}: {
  initialAppliances: ApplianceRow[];
  needsRepairTypes: string[];
}) {
  const [appliances, setAppliances] = useState(initialAppliances);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [applianceType, setApplianceType] = useState(APPLIANCE_TYPES[0]);
  const [brand, setBrand] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsRepairSet = new Set(needsRepairTypes);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/appliances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, appliance_type: applianceType, brand: brand || undefined }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      setAppliances((prev) => [json.data, ...prev]);
      setName("");
      setBrand("");
      setShowForm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to add appliance");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: string) {
    setAppliances((prev) => prev.filter((a) => a.id !== id));
    await fetch(`/api/appliances/${id}`, { method: "DELETE" });
  }

  return (
    <div className="mt-6">
      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          className="rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-600"
        >
          + Add appliance
        </button>
      ) : (
        <form
          onSubmit={handleAdd}
          className="mb-6 max-w-md space-y-3 rounded-card border border-ink/8 bg-white p-4 shadow-card"
        >
          <div>
            <label className="mb-1 block text-sm font-medium text-ink/80">Name</label>
            <input
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Kitchen refrigerator"
              className="w-full rounded-lg border border-ink/15 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink/80">Type</label>
            <select
              value={applianceType}
              onChange={(e) => setApplianceType(e.target.value)}
              className="w-full rounded-lg border border-ink/15 px-3 py-2 text-sm"
            >
              {APPLIANCE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace("_", " ")}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-ink/80">Brand (optional)</label>
            <input
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              className="w-full rounded-lg border border-ink/15 px-3 py-2 text-sm"
            />
          </div>
          {error && <p className="text-sm text-alert-500">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={submitting}
              className="rounded-full bg-brand-500 px-4 py-1.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
            >
              {submitting ? "Saving..." : "Save"}
            </button>
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-full border border-ink/15 px-4 py-1.5 text-sm font-medium text-ink/70"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {!appliances.length ? (
        <p className="text-sm text-ink/50">No appliances added yet.</p>
      ) : (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {appliances.map((a) => {
            const needsRepair = needsRepairSet.has(a.appliance_type);
            return (
              <div key={a.id} className="overflow-hidden rounded-card border border-ink/8 bg-white shadow-card">
                <div className="relative h-32 bg-gradient-to-br from-brand-50 to-canvas">
                  {applianceImage(a.appliance_type) ? (
                    <Image
                      src={applianceImage(a.appliance_type) as string}
                      alt={a.name}
                      fill
                      sizes="(max-width: 640px) 100vw, 50vw"
                      className="object-contain p-3"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center text-brand-600">
                      <ApplianceIcon type={a.appliance_type} />
                    </div>
                  )}
                  <span className="absolute right-3 top-3">
                    <span
                      className={`whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold shadow-sm ${
                        needsRepair
                          ? "bg-alert-50 text-alert-600"
                          : "bg-signal-50 text-signal-600"
                      }`}
                    >
                      {needsRepair ? "Repair needed" : "Good"}
                    </span>
                  </span>
                </div>
                <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-50 text-brand-600">
                      <ApplianceIcon type={a.appliance_type} />
                    </span>
                    <div>
                      <p className="font-medium text-ink">{a.name}</p>
                      <p className="mt-0.5 text-xs capitalize text-ink/50">
                        {a.brand ? a.brand : a.appliance_type.replace("_", " ")}
                        {a.model ? ` · ${a.model}` : ""}
                      </p>
                    </div>
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => handleDelete(a.id)}
                    className="text-xs font-medium text-ink/40 hover:text-alert-500"
                  >
                    Remove
                  </button>
                </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
