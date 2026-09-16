import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import AppliancesClient from "@/components/AppliancesClient";

export default async function AppliancesPage() {
  const user = await getCurrentUser();
  const supabase = createClient();

  const { data: appliances } = await supabase
    .from("appliances")
    .select("*")
    .eq("customer_id", user!.id)
    .order("created_at", { ascending: false });

  // Derive "repair needed" status from real active requests — no new column needed.
  const { data: activeRequests } = await supabase
    .from("service_requests")
    .select("appliance_type")
    .eq("customer_id", user!.id)
    .not("status", "in", "(completed,cancelled)");

  const applianceTypesNeedingRepair = new Set(
    (activeRequests ?? []).map((r) => r.appliance_type)
  );

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-ink">My appliances</h1>
      <p className="mt-1 text-sm text-ink/65">
        Keep a record of what you own — makes filing a repair request faster.
      </p>
      <AppliancesClient
        initialAppliances={appliances ?? []}
        needsRepairTypes={Array.from(applianceTypesNeedingRepair)}
      />
    </div>
  );
}
