import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { getTechnicianPendingOffers } from "@/lib/assignment";
import { getServiceTimezone, formatRequestedWindow } from "@/lib/service-time";
import StatusBadge from "@/components/StatusBadge";
import EstimateForm from "@/components/EstimateForm";
import OfferResponseControl from "@/components/OfferResponseControl";
import ServiceLocationCard from "@/components/ServiceLocationCard";
import { Clock, Send, CheckCircle2, Wallet, CalendarClock, ShieldCheck, MessageSquareWarning } from "lucide-react";
import { isOpenEstimateStatus } from "@/lib/estimate-costs";
import type { EstimateRow, TechnicianPendingOfferRow } from "@/types/database";

export default async function PendingAssignmentsPage() {
  const user = await getCurrentUser();
  const supabase = createClient();
  const serviceTimeZone = await getServiceTimezone(supabase);

  // Requests SPARKServ's rotation queue has offered specifically to this
  // technician, awaiting their accept/reject. Technicians no longer browse all
  // open requests.
  //
  // Read through `technician_pending_offers()` rather than selecting the rows:
  // the RPC returns only the fields needed to decide (appliance, problem,
  // photos, requested window, expiry) and NOT the customer's address or
  // coordinates. The precise service location is disclosed only after the
  // assignment is confirmed — see supabase/migration_service_location.sql.
  let offeredRequests: TechnicianPendingOfferRow[] = [];
  let offersUnavailable = false;
  try {
    offeredRequests = await getTechnicianPendingOffers(supabase, user!.id);
  } catch (error) {
    // Never render a technician a blank "no offers" screen — say so instead.
    offersUnavailable = true;
    console.error("Could not read pending offers", error);
  }

  // Requests this technician has already ACCEPTED. These are readable in full
  // (RLS allows the assigned technician), so the service location — address,
  // pin and a "Get directions" link — is shown here.
  const { data: acceptedRequests } = await supabase
    .from("service_requests")
    .select("*")
    .eq("assigned_technician_id", user!.id)
    .eq("assignment_status", "accepted")
    .order("created_at", { ascending: false });

  const { data: myEstimates } = await supabase
    .from("estimates")
    .select("*")
    .eq("technician_id", user!.id)
    .order("version", { ascending: false });

  const estimates = myEstimates ?? [];

  /** The live version of each request (draft / awaiting decision / revision asked). */
  const liveByRequest = new Map<string, EstimateRow>();
  /** Every earlier version, newest first — the history a revision must not destroy. */
  const historyByRequest = new Map<string, EstimateRow[]>();
  for (const estimate of estimates) {
    if (isOpenEstimateStatus(estimate.status)) {
      const current = liveByRequest.get(estimate.service_request_id);
      if (!current || estimate.version > current.version) {
        liveByRequest.set(estimate.service_request_id, estimate);
      }
    } else {
      const list = historyByRequest.get(estimate.service_request_id) ?? [];
      list.push(estimate);
      historyByRequest.set(estimate.service_request_id, list);
    }
  }

  /**
   * Which accepted requests still need a quote from this technician:
   *   * none yet,
   *   * a draft they have not sent,
   *   * a version the customer asked to change,
   *   * a version the customer DECLINED — a declined row is not "live", so the
   *     request lands here again and the technician can re-quote it. The declined
   *     version stays declined in the history; the new one is a new version.
   * A version that is simply awaiting the customer's decision is NOT in this list
   * (there is nothing for the technician to do until they answer).
   */
  const needsEstimate = (acceptedRequests ?? []).filter((request) => {
    const current = liveByRequest.get(request.id);
    if (!current) return true;
    return current.status === "draft" || current.status === "revision_requested";
  });

  const estimatesSent = estimates.filter((e) => e.status !== "draft").length;
  const estimatesAccepted = estimates.filter((e) => e.status === "accepted").length;
  const totalEstimated = estimates
    .filter((e) => e.status !== "draft" && e.status !== "superseded")
    .reduce((sum, e) => sum + e.estimated_cost, 0);

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
        {offersUnavailable ? (
          <p className="rounded-card border border-line bg-soft/60 px-4 py-3 text-sm text-ink/70">
            Your offers could not be loaded right now. Refresh in a moment — an
            offer you cannot see is still yours until it lapses.
          </p>
        ) : !offeredRequests.length ? (
          <p className="text-sm text-ink/50">No pending offers right now.</p>
        ) : (
          <div className="space-y-3">
            {offeredRequests.map((r) => {
              // Computed on the server so the card, the copy and the control all
              // agree on whether this offer can still be accepted.
              const offerExpired = Boolean(
                r.offers_expires_at && new Date(r.offers_expires_at).getTime() <= Date.now()
              );
              return (
                <div key={r.id} className="rounded-card border border-ink/8 bg-surface p-4 shadow-card">
                  <div className="flex items-center justify-between">
                    <p className="font-medium capitalize text-ink">
                      {r.appliance_type.replace("_", " ")}
                    </p>
                    <StatusBadge status={r.status} />
                  </div>
                  <p className="mt-1 text-sm text-ink/65">{r.problem_description}</p>
                  <RequestedWindow
                    start={r.requested_window_start}
                    end={r.requested_window_end}
                    timeZone={serviceTimeZone}
                  />
                  {/* The customer's exact address and map pin are withheld until
                      you accept: an offer you have not taken up must not reveal
                      where the customer lives. */}
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-ink/45">
                    <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    The service address and map pin are shared with you once you
                    accept this job.
                  </p>
                  <OfferResponseControl
                    requestId={r.id}
                    expired={offerExpired}
                    expiresAt={r.offers_expires_at}
                  />
                </div>
              );
            })}
          </div>
        )}
      </section>

      {needsEstimate.length > 0 && (
        <section className="mt-8">
          <h2 className="mb-3 font-display text-lg font-semibold text-ink">
            Accepted — send an estimate
          </h2>
          <div className="space-y-3">
            {needsEstimate.map((r) => {
              const current = liveByRequest.get(r.id) ?? null;
              return (
                <div key={r.id} className="rounded-card border border-ink/8 bg-surface p-4 shadow-card">
                  <div className="flex items-center justify-between">
                    <p className="font-medium capitalize text-ink">
                      {r.appliance_type.replace("_", " ")}
                    </p>
                    <StatusBadge status={r.status} />
                  </div>
                  <p className="mt-1 text-sm text-ink/65">{r.problem_description}</p>
                  <RequestedWindow
                    start={r.requested_window_start}
                    end={r.requested_window_end}
                    timeZone={serviceTimeZone}
                  />
                  {/* You accepted this job, so the service location is yours to
                      see: address, map pin and a one-tap directions link. */}
                  <div className="mt-3">
                    <ServiceLocationCard
                      address={r.location}
                      latitude={r.latitude}
                      longitude={r.longitude}
                      title="Service location"
                      showDirections
                      emptyMessage="This customer did not record a service location — contact them from the job page."
                    />
                  </div>

                  {current?.status === "revision_requested" && (
                    <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-warn-soft/60 px-3 py-2 text-xs leading-relaxed text-warn-ink">
                      <MessageSquareWarning
                        className="mt-0.5 h-3.5 w-3.5 shrink-0"
                        aria-hidden="true"
                      />
                      The customer asked for a change to version {current.version}
                      {current.revision_reason ? `: “${current.revision_reason}”` : "."} Send a
                      revised estimate for approval.
                    </p>
                  )}

                  <EstimateForm
                    serviceRequestId={r.id}
                    current={current}
                    history={historyByRequest.get(r.id) ?? []}
                    defaultOpen={current?.status === "revision_requested"}
                  />
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

/**
 * The window the customer asked for, shown on both the offer and the accepted
 * card. When they gave no time preference it says so explicitly — a technician
 * should not have to guess whether "no time shown" means "all day" or "nobody
 * asked", because the queue treated those two cases very differently.
 */
function RequestedWindow({
  start,
  end,
  timeZone,
}: {
  start: string | null;
  end: string | null;
  timeZone: string;
}) {
  const label = formatRequestedWindow(start, end, timeZone);
  return (
    <p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium text-ink/70">
      <CalendarClock className="h-3.5 w-3.5 shrink-0" />
      {label ? <span>Wants {label} (PH time)</span> : <span>No time preference stated — agree a slot</span>}
    </p>
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
    <div className="rounded-card border border-ink/8 bg-surface p-3 shadow-card">
      <div className="flex items-center gap-1.5 text-ink/40">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p className="mt-1.5 font-display text-lg font-semibold text-ink">{value}</p>
    </div>
  );
}
