"use client";

import { CalendarClock } from "lucide-react";
import { formatRequestedWindow } from "@/lib/service-time";
import AssignmentStatusCard from "@/components/AssignmentStatusCard";
import EstimateReviewCard from "@/components/EstimateReviewCard";
import ServiceLocationCard from "@/components/ServiceLocationCard";
import StatusBadge from "@/components/StatusBadge";
import { isOpenEstimateStatus } from "@/lib/estimate-costs";
import type { EstimateRow, ServiceRequestRow } from "@/types/database";

interface AssignedTechnician {
  id: string;
  name: string;
}

interface RequestDetailClientProps {
  request: ServiceRequestRow;
  initialEstimates: EstimateRow[];
  assignedTechnician: AssignedTechnician | null;
  /** IANA zone the queue and the booking clocks run on (e.g. Asia/Manila). */
  serviceTimeZone: string;
  /**
   * Whether ANY technician covers this appliance, when the server could confirm it.
   * `false` is what turns the "waiting" card from "you are in the queue" into
   * "nobody services this yet"; `null` (unknown) keeps the neutral wording.
   */
  qualifiedTechnicianAvailable?: boolean | null;
}

export default function RequestDetailClient({
  request,
  initialEstimates,
  assignedTechnician,
  serviceTimeZone,
  qualifiedTechnicianAvailable = null,
}: RequestDetailClientProps) {
  // Only versions the customer may see (RLS already hides drafts), newest first.
  const versions = initialEstimates
    .filter((estimate) => estimate.status !== "draft")
    .sort((a, b) => b.version - a.version);

  // The version that matters right now: the one awaiting a decision, else the
  // approved one, else the most recent (e.g. a declined or superseded quote).
  const currentEstimate =
    versions.find((estimate) => isOpenEstimateStatus(estimate.status)) ??
    versions.find((estimate) => estimate.status === "accepted") ??
    versions[0] ??
    null;
  const earlierVersions = versions.filter((estimate) => estimate.id !== currentEstimate?.id);

  return (
    <div className="space-y-8">
      <div className="rounded-card border border-ink/8 p-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold capitalize text-ink">
            {request.appliance_type.replace(/_/, " ")} repair request
          </h1>
          <StatusBadge status={request.status} />
        </div>
        {request.issue_category && (
          <p className="mt-2 text-sm font-medium text-brand-ink">{request.issue_category.replace(/_/, " ")}</p>
        )}
        <p className="mt-2 text-sm text-ink/65">{request.problem_description}</p>
        <RequestedWindow
          start={request.requested_window_start}
          end={request.requested_window_end}
          timeZone={serviceTimeZone}
        />
      </div>

      {/* What the customer confirmed on the map, exactly as it was saved, so a
          reopened request shows the location it will be serviced at. */}
      <ServiceLocationCard
        address={request.location}
        latitude={request.latitude}
        longitude={request.longitude}
        title={request.service_type === "pickup_return" ? "Pickup location" : "Service location"}
        emptyMessage="You did not record a service location for this request. Your technician will confirm the address with you."
      />

      <section>
        <h2 className="mb-3 text-lg font-semibold text-ink">Technician</h2>
        {request.status === "cancelled" ? (
          // A cancelled request has no assignment to report: showing the live
          // "checking availability" card here would contradict the cancelled badge.
          <p className="rounded-card border border-line bg-soft/60 px-4 py-3 text-sm text-ink/70">
            You cancelled this request, so no technician is being matched. Submit a
            new request whenever you need service again.
          </p>
        ) : (
          <AssignmentStatusCard
            status={request.assignment_status}
            applianceType={request.appliance_type}
            technician={assignedTechnician}
            offersExpiresAt={request.offers_expires_at}
            qualifiedTechnicianAvailable={qualifiedTechnicianAvailable}
          />
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-ink">Estimate</h2>
        {!currentEstimate ? (
          <p className="text-sm text-ink/50">
            {request.assignment_status === "accepted"
              ? "Your technician hasn't sent an estimate yet."
              : "An estimate will appear here once a technician has accepted this request."}
          </p>
        ) : (
          // Reviewing, approving and scheduling all live in the shared card, so
          // this page and /customer/estimates can never disagree about what is
          // being approved or what state it is in.
          <EstimateReviewCard
            estimate={currentEstimate}
            history={earlierVersions}
            request={{
              appliance_type: request.appliance_type,
              problem_description: request.problem_description,
              assignment_status: request.assignment_status,
              status: request.status,
            }}
          />
        )}
      </section>
    </div>
  );

/**
 * The window this customer asked for, echoed back on their own request so they
 * can confirm SPARKServ recorded it. Deliberately says "no time preference"
 * rather than rendering nothing: the queue treats "no preference" and "a window
 * the queue checked" very differently, and the customer should see which one.
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
    <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-ink/70">
      <CalendarClock className="h-3.5 w-3.5 shrink-0" />
      {label ? <span>You asked for {label}</span> : <span>Any time works — you agree the slot with your technician</span>}
    </p>
  );
}

}
