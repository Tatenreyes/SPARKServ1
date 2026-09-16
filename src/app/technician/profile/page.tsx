import ProfileForm from "@/components/ProfileForm";

export default function TechnicianProfilePage() {
  return (
    <div className="space-y-6">
      <div><p className="text-sm font-semibold uppercase tracking-[0.16em] text-purple-700">Account</p><h1 className="mt-2 font-display text-3xl font-semibold text-slate-900">My profile</h1><p className="mt-2 text-sm text-slate-500">Show customers what you do and how they can reach you.</p></div>
      <ProfileForm role="technician" />
    </div>
  );
}
