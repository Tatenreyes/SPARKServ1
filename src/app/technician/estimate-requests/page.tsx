import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import StatusBadge from "@/components/StatusBadge";
import EstimateForm from "@/components/EstimateForm";
import OfferResponseControl from "@/components/OfferResponseControl";
import { Clock, Send, CheckCircle2, Wallet } from "lucide-react";

export default async function PendingAssignmentsPage() {
  const user = await getCurrentUser();
  const supabase = createClient();

  // Requests SPARKServ's rotation queue has offered specifically to this
  // technician, awaiting their accept/reject. Technicians no longer browse
  // all open requests.
  const { data: offeredRequests } = await supabase
    .from("service_requests")
    .select("*")
    .eq("assigned_technician_id", user!.id)
    .eq("assignment_status", "offered")
    .order("created_at", { ascending: false });

  // Requests this technician has already accepted but hasn't sent an
  // estimate for yet.
  const { data: acceptedRequests } = await supabase
    .from("service_requests")
    .select("*")
    .eq("assigned_technician_id", user!.id)
    .eq("assignment_status", "accepted")
    .order("created_at", { ascending: false });

  const { data: myEstimates } = await supabase
    .from("estimates")
    .select("*")
    .eq("technician_id", user!.id);

  const estimatedRequestIds = new Set((myEstimates ?? []).map((e) => e.service_request_id));
  const awaitingEstimate = (acceptedRequests ?? []).filter(
    (r) => !estimatedRequestIds.has(r.id)
  );

  const estimatesSent = myEstimates?.length ?? 0;
  const estimatesAccepted = (myEstimates ?? []).filter((e) => e.status === "accepted").length;
  const totalEstimated = (myEstimates ?? []).reduce((sum, e) => sum + e.estimated_cost, 0);

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-ink">Pending assignments</h1>
      <p className="mt-1 text-sm text-ink/65">
        SPARKServ&apos;s rotation queue offers you jobs in turn — accept or reject what&apos;s offered.
      </p>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={<Clock className="h-4 w-4" />} label="Pending Offers" value={String(offeredRequests?.length ?? 0)} />
        <StatCard icon={<Send className="h-4 w-4" />} label="Estimates Sent" value={String(estimatesSent)} />
        <StatCard icon={<CheckCircle2 className="h-4 w-4" />} label="Estimates Accepted" value={String(estimatesAccepted)} />
        <StatCard icon={<Wallet className="h-4 w-4" />} label="Total Estimated" value={`₱${totalEstimated.toFixed(0)}`} />
      </div>

      <section className="mt-8">
        <h2 className="mb-3 font-display text-lg font-semibold text-ink">Offered to you</h2>
        {!offeredRequests?.length ? (
          <p className="text-sm text-ink/50">No pending offers right now.</p>
        ) : (
          <div className="space-y-3">
            {offeredRequests.map((r) => (
              <div key={r.id} className="rounded-card border border-ink/8 bg-white p-4 shadow-card">
                <div className="flex items-center justify-between">
                  <p className="font-medium capitalize text-ink">
                    {r.appliance_type.replace("_", " ")}
                  </p>
                  <StatusBadge status={r.status} />
                </div>
                <p className="mt-1 text-sm text-ink/65">{r.problem_description}</p>
                <p className="mt-1 text-xs text-ink/35">{r.location}</p>
                <OfferResponseControl requestId={r.id} />
              </div>
            ))}
          </div>
        )}
      </section>

      {awaitingEstimate.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 font-display text-lg font-semibold text-ink">
            Accepted — send an estimate
          </h2>
          <div className="space-y-3">
            {awaitingEstimate.map((r) => (
              <div key={r.id} className="rounded-card border border-ink/8 bg-white p-4 shadow-card">
                <div className="flex items-center justify-between">
                  <p className="font-medium capitalize text-ink">
                    {r.appliance_type.replace("_", " ")}
                  </p>
                  <StatusBadge status={r.status} />
                </div>
                <p className="mt-1 text-sm text-ink/65">{r.problem_description}</p>
                <p className="mt-1 text-xs text-ink/35">{r.location}</p>
                <EstimateForm serviceRequestId={r.id} />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-card border border-ink/8 bg-white p-3 shadow-card">
      <div className="flex items-center gap-1.5 text-ink/40">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p className="mt-1.5 font-display text-lg font-semibold text-ink">{value}</p>
    </div>
  );
}
