"use client";

import { useEffect, useState } from "react";
import { Camera, Check, Loader2, MapPin, Phone, Save, UserRound, Wrench } from "lucide-react";

type ProfileFormProps = { role: "customer" | "technician" };
type Profile = { name: string; email: string; phone: string | null; location: string | null; avatar_url: string | null };
type TechnicianProfile = { specializations: string[]; experience_years: number; availability: boolean } | null;

export default function ProfileForm({ role }: ProfileFormProps) {
  const [profile, setProfile] = useState<Profile>({ name: "", email: "", phone: "", location: "", avatar_url: null });
  const [technician, setTechnician] = useState<TechnicianProfile>({ specializations: [], experience_years: 0, availability: true });
  const [specializations, setSpecializations] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/profile").then(async (response) => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Unable to load profile");
      setProfile(result.data);
      if (result.technician) {
        setTechnician(result.technician);
        setSpecializations(result.technician.specializations.join(", "));
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
        ...profile,
        specializations: specializations.split(",").map((item) => item.trim()).filter(Boolean),
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

  if (loading) return <div className="rounded-2xl border border-slate-200 bg-white p-8 text-sm text-slate-500">Loading profile...</div>;

  return (
    <form onSubmit={saveProfile} className="max-w-2xl space-y-6 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
      <div className="flex items-center gap-5 border-b border-slate-100 pb-6">
        <div className="relative flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-50 text-brand-600 ring-4 ring-brand-50">
          {profile.avatar_url ? <div className="h-full w-full bg-cover bg-center" style={{ backgroundImage: `url(${profile.avatar_url})` }} /> : <UserRound className="h-10 w-10" />}
          {uploading && <div className="absolute inset-0 flex items-center justify-center bg-slate-950/50 text-white"><Loader2 className="h-6 w-6 animate-spin" /></div>}
        </div>
        <div>
          <h2 className="font-display text-lg font-semibold text-slate-900">Profile picture</h2>
          <p className="mt-1 text-xs text-slate-500">Use a clear JPG, PNG, or WebP image up to 5 MB.</p>
          <label className="mt-3 inline-flex cursor-pointer items-center rounded-lg border border-brand-200 px-3 py-2 text-xs font-semibold text-brand-700 transition hover:bg-brand-50">
            <Camera className="mr-2 h-4 w-4" /> {uploading ? "Uploading..." : "Upload photo"}
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={uploadAvatar} disabled={uploading} className="sr-only" />
          </label>
        </div>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Full name" icon={<UserRound />} value={profile.name} onChange={(value) => setProfile({ ...profile, name: value })} required />
        <Field label="Email address" value={profile.email} disabled />
        <Field label="Phone number" icon={<Phone />} value={profile.phone ?? ""} onChange={(value) => setProfile({ ...profile, phone: value })} placeholder="09XX XXX XXXX" />
        <Field label="Location" icon={<MapPin />} value={profile.location ?? ""} onChange={(value) => setProfile({ ...profile, location: value })} placeholder="City or municipality" />
      </div>

      {role === "technician" && technician && (
        <div className="border-t border-slate-100 pt-6">
          <div className="mb-4 flex items-center gap-2"><Wrench className="h-4 w-4 text-brand-600" /><h2 className="font-display text-lg font-semibold text-slate-900">Technician details</h2></div>
          <div className="grid gap-5 sm:grid-cols-2">
            <div className="sm:col-span-2"><label className="mb-1.5 block text-xs font-semibold text-slate-700">Specializations</label><input value={specializations} onChange={(event) => setSpecializations(event.target.value)} placeholder="Refrigerator, air conditioner" className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100" /><p className="mt-1 text-xs text-slate-500">Separate specialties with commas.</p></div>
            <div><label className="mb-1.5 block text-xs font-semibold text-slate-700">Years of experience</label><input type="number" min="0" value={technician.experience_years} onChange={(event) => setTechnician({ ...technician, experience_years: Number(event.target.value) })} className="w-full rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm outline-none focus:border-brand-500 focus:ring-4 focus:ring-brand-100" /></div>
            <label className="flex items-center gap-3 self-end pb-2 text-sm font-medium text-slate-700"><input type="checkbox" checked={technician.availability} onChange={(event) => setTechnician({ ...technician, availability: event.target.checked })} className="h-4 w-4 accent-brand-600" /> Available for new jobs</label>
          </div>
        </div>
      )}

      {error && <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
      {message && <p className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700"><Check className="h-4 w-4" />{message}</p>}
      <button disabled={saving} className="inline-flex items-center rounded-lg bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50">{saving ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}Save profile</button>
    </form>
  );
}

function Field({ label, icon, value, onChange, placeholder, disabled, required }: { label: string; icon?: React.ReactNode; value: string; onChange?: (value: string) => void; placeholder?: string; disabled?: boolean; required?: boolean }) {
  return <div><label className="mb-1.5 block text-xs font-semibold text-slate-700">{label}</label><div className="relative">{icon && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 [&>svg]:h-4 [&>svg]:w-4">{icon}</span>}<input required={required} disabled={disabled} value={value} onChange={(event) => onChange?.(event.target.value)} placeholder={placeholder} className={`w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm outline-none ${icon ? "pl-10" : ""} ${disabled ? "bg-slate-100 text-slate-500" : "bg-slate-50 focus:border-brand-500 focus:bg-white focus:ring-4 focus:ring-brand-100"}`} /></div></div>;
}
