import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * "Does ANY technician currently cover this appliance type?" — read on the
 * server, for the pages that show a customer their assignment state.
 *
 * WHY THIS EXISTS. Coverage is computed once, when the request is created
 * (`POST /api/service-requests`), and handed to the wizard so it can warn the
 * customer immediately. Nothing re-read it afterwards, so after a reload the
 * dashboard strip and the request page went back to "waiting for an eligible
 * technician" / "next: technician assigned" — for an appliance nobody services,
 * a promise the platform cannot keep. The customer who most needs the answer
 * (the one who came back later) was the one who never got it.
 *
 * `appliance_has_qualified_technician()` is the same predicate the queue walk
 * and `create_booking_atomic()` use, so this answer cannot disagree with who is
 * actually offered the work. It is granted to `service_role` only by design
 * (migration 17), which is why this helper exists on the server rather than a
 * query the browser could run.
 *
 * Returns `null` — never a guess — when the answer cannot be established: no
 * service key in this environment, or the RPC failed. Every caller treats `null`
 * as "unknown" and keeps its neutral wording.
 */
export async function applianceCoverage(applianceType: string): Promise<boolean | null> {
  let serviceRole: ReturnType<typeof createServiceRoleClient> | null = null;

  try {
    serviceRole = createServiceRoleClient();
  } catch (error) {
    // A deployment without SUPABASE_SERVICE_ROLE_KEY must still render the page.
    console.error("Coverage check skipped: no service-role client available", error);
    return null;
  }

  const { data, error } = await serviceRole.rpc("appliance_has_qualified_technician", {
    p_appliance_type: applianceType,
  });

  if (error) {
    console.error("Could not check appliance coverage", error);
    return null;
  }

  return data === true;
}
