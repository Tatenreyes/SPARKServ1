"use client";

import { useEffect, useState } from "react";
import { Camera, Check, Loader2, MapPin, Phone, Save, UserRound, Wrench, X } from "lucide-react";

type ProfileFormProps = { role: "customer" | "technician" };
type Profile = { first_name: string; last_name: string; middle_initial: string | null; email: string; phone: string | null; address: string | null; avatar_url: string | null };
type TechnicianProfile = { specializations: string[]; experience_years: number; availability: boolean } | null;

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

export default function ProfileForm({ role }: ProfileFormProps) {
  const [profile, setProfile] = useState<Profile>({ first_name: "", last_name: "", middle_initial: "", email: "", phone: "", address: "", avatar_url: null });
  const [technician, setTechnician] = useState<TechnicianProfile>({ specializations: [], experience_years: 0, availability: true });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/profile").then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to load profile");
      const data = result.data as Profile & { location?: string | null; name?: string };
      const normalized: Profile = {
        first_name: data.first_name ?? "",
        last_name: data.last_name ?? "",
        middle_initial: data.middle_initial ?? null,
        email: data.email ?? "",
        phone: data.phone ?? "",
        address: data.address ?? data.location ?? null,
        avatar_url: data.avatar_url ?? null,
      };
      if ((!normalized.first_name && !normalized.last_name) && data.name) {
        const parts = data.name.trim().split(" ");
        normalized.first_name = parts[0] ?? "";
        normalized.last_name = parts.slice(1).join(" ") ?? "";
      }
      setProfile(normalized);
      if (result.technician) {
        setTechnician(result.technician);
      }
    }).catch((reason: Error) => setError(reason.message)).finally(() => setLoading(false));
  }, []);

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true); setMessage(null); setError(null);
    const response = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        first_name: profile.first_name.trim(),
        last_name: profile.last_name.trim(),
        middle_initial: profile.middle_initial?.trim() || null,
        phone: profile.phone?.trim() || null,
        address: profile.address?.trim() || null,
        specializations: technician?.specializations ?? [],
        experience_years: technician?.experience_years ?? 0,
        availability: technician?.availability ?? true,
      }),
    });
    const result = await response.json();
    if (!response.ok) setError(result.error ?? "Unable to save profile");
    else {
      setProfile(result.data);
      window.dispatchEvent(new Event("profile-updated"));
      setMessage("Profile saved successfully");
    }
    setSaving(false);
  }

  async function uploadAvatar(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true); setMessage(null); setError(null);
    const formData = new FormData();
    formData.append("avatar", file);
    const response = await fetch("/api/profile/avatar", { method: "POST", body: formData });
    const result = await response.json();
    if (!response.ok) setError(result.error ?? "Unable to upload profile picture");
    else {
      setProfile((current) => ({ ...current, avatar_url: result.avatar_url }));
      window.dispatchEvent(new Event("profile-updated"));
      setMessage("Profile picture updated");
    }
    setUploading(false);
    event.target.value = "";
  }

  function toggleSpecialization(appliance: string) {
    setTechnician((current) => {
      const specializations = current?.specializations ?? [];
      const isSelected = specializations.includes(appliance);
      return {
        ...(current ?? { specializations: [], experience_years: 0, availability: true }),
        specializations: isSelected
          ? specializations.filter((item) => item !== appliance)
          : [...specializations, appliance],
      };
    });
  }

  if (loading) return <div className="rounded-2xl border border-line bg-surface p-8 text-sm text-muted">Loading profile...</div>;

  return (
    <form onSubmit={saveProfile} className="max-w-2xl space-y-6 rounded-2xl border border-line bg-surface p-6 shadow-sm sm:p-8">
      <div className="flex items-center gap-5 border-b border-line pb-6">
        <div className="relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-soft text-brand-ink ring-4 ring-canvas">
          {profile.avatar_url ? <div className="h-full w-full bg-cover bg-center" style={{ backgroundImage: `url(${profile.avatar_url})` }} /> : <UserRound className="h-10 w-10" />}
          {uploading && <div className="absolute inset-0 flex items-center justify-center bg-canvas/70 text-white"><Loader2 className="h-6 w-6 animate-spin" /></div>}
        </div>
        <div>
          <h2 className="font-display text-lg font-semibold text-ink">Profile picture</h2>
          <p className="mt-1 text-xs text-muted">Use a clear JPG, PNG, or WebP image up to 5 MB.</p>
          <label className="mt-3 inline-flex cursor-pointer items-center rounded-lg border border-line px-3 py-2 text-xs font-semibold text-brand-ink transition hover:bg-brand-soft">
            <Camera className="mr-2 h-4 w-4" /> {uploading ? "Uploading..." : "Upload photo"}
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={uploadAvatar} disabled={uploading} className="sr-only" />
          </label>
        </div>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="First name" icon={<UserRound />} value={profile.first_name} onChange={(value) => setProfile({ ...profile, first_name: value })} required />
        <Field label="Last name" icon={<UserRound />} value={profile.last_name} onChange={(value) => setProfile({ ...profile, last_name: value })} required />
        <Field label="Middle initial" icon={<UserRound />} value={profile.middle_initial ?? ""} onChange={(value) => setProfile({ ...profile, middle_initial: value })} placeholder="M" />
        <Field label="Email address" value={profile.email} disabled />
        <Field label="Phone number" icon={<Phone />} value={profile.phone ?? ""} onChange={(value) => setProfile({ ...profile, phone: value })} placeholder="09XX XXX XXXX" />
        <Field label="Address" icon={<MapPin />} value={profile.address ?? ""} onChange={(value) => setProfile({ ...profile, address: value })} placeholder="City or municipality" />
      </div>

      {role === "technician" && technician && (
        <div className="border-t border-line pt-6">
          <div className="mb-4 flex items-center gap-2"><Wrench className="h-4 w-4 text-brand-ink" /><h2 className="font-display text-lg font-semibold text-ink">Technician details</h2></div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="mb-1.5 block text-xs font-semibold text-ink/80">Specializations</label>
              <div className="flex flex-wrap gap-2 rounded-lg border border-line bg-soft p-3">
                {APPLIANCE_TYPES.map((appliance) => {
                  const selected = technician.specializations.includes(appliance);
                  return (
                    <button
                      key={appliance}
                      type="button"
                      onClick={() => toggleSpecialization(appliance)}
                      className={`inline-flex items-center rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                        selected
                          ? "bg-brand-600 text-white shadow-sm"
                          : "bg-surface text-ink/80 border border-line hover:border-line hover:text-brand-ink"
                      }`}
                    >
                      {appliance}
                      {selected && <X className="ml-1.5 h-3 w-3" />}
                    </button>
                  );
                })}
              </div>
              <p className="mt-1 text-xs text-muted">Click an appliance to add or remove it from your specializations.</p>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-semibold text-ink/80">Years of experience</label>
              <input type="number" min="0" value={technician.experience_years} onChange={(event) => setTechnician({ ...technician, experience_years: Number(event.target.value) })} className="w-full rounded-lg border border-line bg-soft px-3 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-line" />
            </div>
            <label className="flex items-center gap-3 self-end pb-2 text-sm font-medium text-ink/80">
              <input type="checkbox" checked={technician.availability} onChange={(event) => setTechnician({ ...technician, availability: event.target.checked })} className="h-4 w-4 accent-brand-600" />
              Available for new jobs
            </label>
          </div>
        </div>
      )}

      {error && <p role="alert" className="rounded-lg bg-alert-soft px-3 py-2 text-sm text-alert-ink">{error}</p>}
      {message && <p className="flex items-center gap-2 rounded-lg bg-signal-soft px-3 py-2 text-sm text-signal-ink"><Check className="h-4 w-4" />{message}</p>}
      <button disabled={saving} className="inline-flex items-center rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save profile</button>
    </form>
  );
}

function Field({ label, icon, value, onChange, placeholder, disabled, required }: { label: string; icon?: React.ReactNode; value: string; onChange?: (value: string) => void; placeholder?: string; disabled?: boolean; required?: boolean }) {
  return <div><label className="mb-1.5 block text-xs font-semibold text-ink/80">{label}</label><div className="relative">{icon && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted/80 [&>svg]:h-4 [&>svg]:w-4">{icon}</span>}<input required={required} disabled={disabled} value={value} onChange={(event) => onChange?.(event.target.value)} placeholder={placeholder} className={`w-full rounded-lg border border-line px-3 py-2.5 text-sm outline-none ${icon ? "pl-10" : ""} ${disabled ? "bg-soft text-muted" : "bg-soft focus:border-brand-500 focus:bg-surface focus:ring-4 focus:ring-line"}`} /></div></div>;
}
