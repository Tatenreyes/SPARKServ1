"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { useUser } from "@/hooks/useUser";
import StatusBadge from "@/components/StatusBadge";
import { Plus, Pencil, Trash2, Refrigerator, X } from "lucide-react";

type Appliance = {
  id: string;
  customer_id: string;
  appliance_type: string;
  brand: string | null;
  model_number: string | null;
  serial_number: string | null;
  purchase_date: string | null;
  warranty_status: string;
  warranty_type: string | null;
  warranty_expiry_date: string | null;
  warranty_proof_url: string | null;
  notes: string | null;
  created_at: string;
};

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

export default function AppliancesPage() {
  const { profile } = useUser();
  const supabase = createClient();
  const [appliances, setAppliances] = useState<Appliance[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    appliance_type: "Refrigerator",
    brand: "",
    model_number: "",
    serial_number: "",
    purchase_date: "",
    warranty_status: "unknown",
    warranty_type: "",
    warranty_expiry_date: "",
    notes: "",
  });

  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    async function loadAppliances() {
      setLoading(true);
      const { data, error } = await supabase
        .from("appliances")
        .select("*")
        .order("created_at", { ascending: false });

      if (!error && data) {
        setAppliances(data);
      }
      setLoading(false);
    }
    loadAppliances();
  }, [supabase, reloadKey]);

  function openCreate() {
    setEditingId(null);
    setForm({
      appliance_type: "Refrigerator",
      brand: "",
      model_number: "",
      serial_number: "",
      purchase_date: "",
      warranty_status: "unknown",
      warranty_type: "",
      warranty_expiry_date: "",
      notes: "",
    });
    setShowForm(true);
  }

  function openEdit(appliance: Appliance) {
    setEditingId(appliance.id);
    setForm({
      appliance_type: appliance.appliance_type,
      brand: appliance.brand ?? "",
      model_number: appliance.model_number ?? "",
      serial_number: appliance.serial_number ?? "",
      purchase_date: appliance.purchase_date ?? "",
      warranty_status: appliance.warranty_status ?? "unknown",
      warranty_type: appliance.warranty_type ?? "",
      warranty_expiry_date: appliance.warranty_expiry_date ?? "",
      notes: appliance.notes ?? "",
    });
    setShowForm(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);

    const payload = {
      ...form,
      brand: form.brand || null,
      model_number: form.model_number || null,
      serial_number: form.serial_number || null,
      purchase_date: form.purchase_date || null,
      warranty_type: form.warranty_type || null,
      warranty_expiry_date: form.warranty_expiry_date || null,
      notes: form.notes || null,
    };

    if (editingId) {
      const { error } = await supabase.from("appliances").update(payload).eq("id", editingId);
      if (error) alert(error.message);
    } else {
      const { error } = await supabase.from("appliances").insert({ ...payload, customer_id: profile!.id });
      if (error) alert(error.message);
    }

    setShowForm(false);
    setEditingId(null);
    setSaving(false);
    setReloadKey((prev) => prev + 1);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-600">Account & Appliances</p>
          <h1 className="mt-2 font-display text-3xl font-bold text-ink">My Appliances</h1>
          <p className="mt-1.5 text-sm text-slate-500">Manage your registered appliances for faster service requests.</p>
        </div>
        <button
          onClick={openCreate}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-brand-700 hover:shadow-md"
        >
          <Plus className="h-4 w-4" />
          Add Appliance
        </button>
      </div>

      {showForm && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg font-semibold text-ink">{editingId ? "Edit Appliance" : "Register Appliance"}</h2>
            <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600">
              <X className="h-5 w-5" />
            </button>
          </div>
          <form onSubmit={handleSubmit} className="mt-4 space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-ink/80">Appliance Type *</label>
                <select
                  value={form.appliance_type}
                  onChange={(e) => setForm({ ...form, appliance_type: e.target.value })}
                  className="w-full rounded-xl border border-ink/10 bg-white px-3.5 py-2.5 text-sm"
                >
                  {APPLIANCE_TYPES.map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-ink/80">Brand</label>
                <input
                  value={form.brand}
                  onChange={(e) => setForm({ ...form, brand: e.target.value })}
                  className="w-full rounded-xl border border-ink/10 bg-white px-3.5 py-2.5 text-sm"
                  placeholder="Samsung, LG, Panasonic..."
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-ink/80">Model Number</label>
                <input
                  value={form.model_number}
                  onChange={(e) => setForm({ ...form, model_number: e.target.value })}
                  className="w-full rounded-xl border border-ink/10 bg-white px-3.5 py-2.5 text-sm"
                  placeholder="Model number"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-ink/80">Serial Number</label>
                <input
                  value={form.serial_number}
                  onChange={(e) => setForm({ ...form, serial_number: e.target.value })}
                  className="w-full rounded-xl border border-ink/10 bg-white px-3.5 py-2.5 text-sm"
                  placeholder="Serial number"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-ink/80">Purchase Date</label>
                <input
                  type="date"
                  value={form.purchase_date}
                  onChange={(e) => setForm({ ...form, purchase_date: e.target.value })}
                  className="w-full rounded-xl border border-ink/10 bg-white px-3.5 py-2.5 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-ink/80">Warranty Status</label>
                <select
                  value={form.warranty_status}
                  onChange={(e) => setForm({ ...form, warranty_status: e.target.value })}
                  className="w-full rounded-xl border border-ink/10 bg-white px-3.5 py-2.5 text-sm"
                >
                  <option value="unknown">Not Sure</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </select>
              </div>
              {form.warranty_status === "yes" && (
                <>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-ink/80">Warranty Type</label>
                    <select
                      value={form.warranty_type}
                      onChange={(e) => setForm({ ...form, warranty_type: e.target.value })}
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
                      value={form.warranty_expiry_date}
                      onChange={(e) => setForm({ ...form, warranty_expiry_date: e.target.value })}
                      className="w-full rounded-xl border border-ink/10 bg-white px-3.5 py-2.5 text-sm"
                    />
                  </div>
                </>
              )}
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-ink/80">Notes</label>
              <textarea
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                rows={3}
                className="w-full rounded-xl border border-ink/10 bg-white px-3.5 py-2.5 text-sm"
                placeholder="Additional notes about this appliance..."
              />
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                disabled={saving}
                className="rounded-full bg-brand-500 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-600 disabled:opacity-40"
              >
                {saving ? "Saving..." : editingId ? "Update" : "Save Appliance"}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="rounded-full border border-ink/15 px-5 py-2.5 text-sm font-medium text-ink/70"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="py-12 text-center text-sm text-slate-500">Loading appliances...</div>
      ) : appliances.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50/50 p-12 text-center">
          <Refrigerator className="mx-auto h-12 w-12 text-slate-300" />
          <h3 className="mt-4 text-lg font-semibold text-slate-900">No appliances registered yet</h3>
          <p className="mt-2 text-sm text-slate-500">Add your first appliance to speed up future service requests.</p>
          <button
            onClick={openCreate}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-brand-700"
          >
            <Plus className="h-4 w-4" /> Add Appliance
          </button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {appliances.map((appliance) => (
            <div
              key={appliance.id}
              className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-brand-200 hover:shadow-md"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold text-slate-900">{appliance.appliance_type}</span>
                <StatusBadge status={appliance.warranty_status === "yes" ? "completed" : appliance.warranty_status === "no" ? "cancelled" : "pending"} />
              </div>
              <div className="space-y-1 text-xs text-slate-600">
                {appliance.brand && <p><span className="font-medium">Brand:</span> {appliance.brand}</p>}
                {appliance.model_number && <p><span className="font-medium">Model:</span> {appliance.model_number}</p>}
                {appliance.serial_number && <p><span className="font-medium">Serial:</span> {appliance.serial_number}</p>}
                {appliance.purchase_date && <p><span className="font-medium">Purchased:</span> {new Date(appliance.purchase_date).toLocaleDateString()}</p>}
                {appliance.warranty_type && <p><span className="font-medium">Warranty:</span> {appliance.warranty_type}</p>}
                {appliance.warranty_expiry_date && <p><span className="font-medium">Expires:</span> {new Date(appliance.warranty_expiry_date).toLocaleDateString()}</p>}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => openEdit(appliance)}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:border-brand-200 hover:text-brand-700"
                >
                  <Pencil className="h-3.5 w-3.5" /> Edit
                </button>
                <button
                  onClick={async () => {
                    if (confirm("Delete this appliance?")) {
                      await supabase.from("appliances").delete().eq("id", appliance.id);
                      setReloadKey((prev) => prev + 1);
                    }
                  }}
                  className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-red-600 transition hover:border-red-200 hover:text-red-700"
                >
                  <Trash2 className="h-3.5 w-3.5" /> Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
