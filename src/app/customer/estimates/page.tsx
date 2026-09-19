import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import EstimatesClient from "@/components/EstimatesClient";

export default async function MyEstimatesPage() {
  const user = await getCurrentUser();
  const supabase = createClient();

  const { data: requests } = await supabase
    .from("service_requests")
    .select("id, appliance_type, problem_description")
    .eq("customer_id", user!.id);

  const requestIds = (requests ?? []).map((r) => r.id);
  const requestMap = new Map((requests ?? []).map((r) => [r.id, r]));

  const { data: estimates } = requestIds.length
    ? await supabase
        .from("estimates")
        .select("*")
        .in("service_request_id", requestIds)
        .order("created_at", { ascending: false })
    : { data: [] };

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-ink">My estimates</h1>
      <p className="mt-1 text-sm text-ink/65">
        Every cost estimate a technician has sent you, across all your requests.
      </p>
      <EstimatesClient
        initialEstimates={estimates ?? []}
        requestInfo={Object.fromEntries(requestMap)}
      />
    </div>
  );
}
