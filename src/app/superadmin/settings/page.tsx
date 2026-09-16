import { createClient } from "@/lib/supabase/server";
import SystemSettingsClient from "@/components/SystemSettingsClient";

export default async function SuperAdminSettingsPage() {
  const supabase = createClient();
  const { data: settings } = await supabase.from("system_settings").select("*");

  const map = Object.fromEntries((settings ?? []).map((s) => [s.key, s.value]));

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-ink">System settings</h1>
      <p className="mt-1 text-sm text-ink/65">
        Platform-wide controls. Changes apply immediately to every user.
      </p>
      <SystemSettingsClient
        initialMaintenanceMode={map.maintenance_mode === "true"}
        initialAnnouncement={map.platform_announcement ?? ""}
      />
    </div>
  );
}
