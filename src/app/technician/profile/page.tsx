import { createClient } from "@/lib/supabase/server";
import { getServiceTimezone } from "@/lib/service-time";
import ProfileForm from "@/components/ProfileForm";
import AvailabilityManager from "@/components/AvailabilityManager";

export default async function TechnicianProfilePage() {
  const supabase = createClient();
  const serviceTimeZone = await getServiceTimezone(supabase);

  return (
    <div className="space-y-6">
      <div><p className="text-sm font-semibold uppercase tracking-[0.16em] text-brand-ink">Account</p><h1 className="mt-2 font-display text-3xl font-semibold text-ink">My profile</h1><p className="mt-2 text-sm text-muted">Show customers what you do and how they can reach you.</p></div>
      <ProfileForm role="technician" />

      <div><h2 className="mt-2 font-display text-2xl font-semibold text-ink">Availability</h2><p className="mt-2 text-sm text-muted">Control which jobs reach you. SPARKServ&apos;s queue only offers work you are qualified for, free for, and able to travel to.</p></div>
      <AvailabilityManager serviceTimeZone={serviceTimeZone} />
    </div>
  );
}
