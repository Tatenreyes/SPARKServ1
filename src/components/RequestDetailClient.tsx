"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import AssignmentStatusCard from "@/components/AssignmentStatusCard";
import StatusBadge from "@/components/StatusBadge";
import type { EstimateRow, ServiceRequestRow } from "@/types/database";

interface AssignedTechnician {
  id: string;
  name: string;
}

interface RequestDetailClientProps {
  request: ServiceRequestRow;
  initialEstimates: EstimateRow[];
  assignedTechnician: AssignedTechnician | null;
}

export default function RequestDetailClient({
  request,
  initialEstimates,
  assignedTechnician,
}: RequestDetailClientProps) {
  const router = useRouter();
  const estimates = initialEstimates;
  const [scheduledAt, setScheduledAt] = useState("");
  const [bookingEstimateId, setBookingEstimateId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleBook(estimate: EstimateRow) {
    if (!scheduledAt) {
      setError("Pick a date/time first.");
      return;
    }
    setError(null);
    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service_request_id: request.id,
          technician_id: estimate.technician_id,
          estimate_id: estimate.id,
          scheduled_at: new Date(scheduledAt).toISOString(),
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error);
      router.push(`/customer/bookings/${json.data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create booking");
    }
  }

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
          <p className="mt-2 text-sm font-medium text-brand-600">{request.issue_category.replace(/_/, " ")}</p>
        )}
        <p className="mt-2 text-sm text-ink/65">{request.problem_description}</p>
      </div>

      {error && <p className="text-sm text-alert-500">{error}</p>}

      <section>
        <h2 className="mb-3 text-lg font-semibold text-ink">Technician</h2>
        <AssignmentStatusCard
          status={request.assignment_status}
          applianceType={request.appliance_type}
          technician={assignedTechnician}
        />
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-ink">Estimates received</h2>
        {!estimates.length ? (
          <p className="text-sm text-ink/50">
            {request.assignment_status === "accepted"
              ? "Your technician hasn't sent an estimate yet."
              : "An estimate will appear here once a technician has accepted this request."}
          </p>
        ) : (
          <div className="space-y-3">
            {estimates.map((est) => (
              <div key={est.id} className="rounded-card border border-ink/8 p-4">
                <div className="flex items-center justify-between">
                  <p className="font-medium text-ink">₱{est.estimated_cost.toFixed(2)}</p>
                  <StatusBadge status={est.status} />
                </div>
                {est.notes && <p className="mt-1 text-sm text-ink/65">{est.notes}</p>}

                {est.status === "pending" && request.status !== "booked" && (
                  <div className="mt-3 flex items-center gap-2">
                    <input
                      type="datetime-local"
                      value={bookingEstimateId === est.id ? scheduledAt : ""}
                      onChange={(e) => {
                        setBookingEstimateId(est.id);
                        setScheduledAt(e.target.value);
                      }}
                      className="rounded-lg border border-ink/15 px-2 py-1.5 text-sm"
                    />
                    <button
                      onClick={() => handleBook(est)}
                      className="rounded-full bg-brand-500 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-600"
                    >
                      Accept & book
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
