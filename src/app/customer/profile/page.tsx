import ProfileForm from "@/components/ProfileForm";

export default function CustomerProfilePage() {
  return (
    <div className="space-y-6">
      <div><p className="text-sm font-semibold uppercase tracking-[0.16em] text-brand-700">Account</p><h1 className="mt-2 font-display text-3xl font-semibold text-slate-900">My profile</h1><p className="mt-2 text-sm text-slate-500">Keep your contact details up to date for smoother service.</p></div>
      <ProfileForm role="customer" />
    </div>
  );
}
