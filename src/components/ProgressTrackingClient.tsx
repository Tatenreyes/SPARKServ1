"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Clock, Image as ImageIcon, FileText } from "lucide-react";
import type { BookingRow, VisitRow, ServiceRequestRow } from "@/types/database";

export default function ProgressTrackingClient({
  bookings,
  visits,
  requests,
  technicianNames,
  currentUserName,
}: {
  bookings: BookingRow[];
  visits: VisitRow[];
  requests: ServiceRequestRow[];
  technicianNames: Record<string, string>;
  currentUserName: string;
}) {
  const router = useRouter();
  const [activeBookingId, setActiveBookingId] = useState(bookings[0]?.id ?? null);
  const [signingId, setSigningId] = useState<string | null>(null);
  const requestMap = new Map(requests.map((r) => [r.id, r]));

  if (!bookings.length) {
    return <p className="mt-6 text-sm text-ink/50">No active jobs to track right now.</p>;
  }

  const activeBooking = bookings.find((b) => b.id === activeBookingId) ?? bookings[0];
  const bookingVisits = visits
    .filter((v) => v.booking_id === activeBooking.id)
    .sort((a, b) => a.visit_number - b.visit_number);
  const request = requestMap.get(activeBooking.service_request_id);
  const completedCount = bookingVisits.filter((v) => v.status === "completed").length;
  const upcomingVisit = bookingVisits.find((v) => v.status !== "completed");

  async function handleSign(visitId: string) {
    setSigningId(visitId);
    try {
      await fetch(`/api/visits/${visitId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ signed_by: currentUserName }),
      });
      router.refresh();
    } finally {
      setSigningId(null);
    }
  }

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_280px]">
      <div>
        {/* Job tabs */}
        <div className="flex flex-wrap gap-2">
          {bookings.map((b) => {
            const req = requestMap.get(b.service_request_id);
            const bVisits = visits.filter((v) => v.booking_id === b.id);
            const bCompleted = bVisits.filter((v) => v.status === "completed").length;
            return (
              <button
                key={b.id}
                onClick={() => setActiveBookingId(b.id)}
                className={`whitespace-nowrap rounded-full px-4 py-2 text-sm font-semibold transition ${
                  b.id === activeBooking.id
                    ? "bg-brand-500 text-white"
                    : "bg-white text-ink/60 hover:bg-brand-50"
                }`}
              >
                {req?.appliance_type.replace("_", " ") ?? "Job"} · {bCompleted}/{bVisits.length} Visits
              </button>
            );
          })}
        </div>

        {/* Job header */}
        <div className="mt-4 rounded-card border border-ink/8 bg-white p-5 shadow-card">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium capitalize text-ink/40">
                Job #{activeBooking.id.slice(0, 8)}
              </p>
              <h2 className="mt-1 font-display text-lg font-semibold capitalize text-ink">
                {request?.appliance_type.replace("_", " ") ?? "Repair"}
              </h2>
              <p className="text-sm text-ink/60">{request?.issue_description}</p>
              <p className="mt-1 text-xs text-ink/40">{request?.location}</p>
            </div>
            <div className="text-right">
              <p className="text-xs font-medium text-ink/40">Progress</p>
              <p className="font-display text-2xl font-semibold text-brand-500">
                {completedCount}/{bookingVisits.length}
              </p>
              <p className="text-xs text-ink/40">Visits completed</p>
            </div>
          </div>

          {upcomingVisit && (
            <div className="mt-4 rounded-lg bg-spark-50 p-4">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-spark-700">
                <Clock className="h-3.5 w-3.5" /> Upcoming visit
              </p>
              <p className="mt-1 font-medium text-ink">{upcomingVisit.title}</p>
              {upcomingVisit.scheduled_at && (
                <p className="text-sm text-ink/60">
                  {new Date(upcomingVisit.scheduled_at).toLocaleString()}
                </p>
              )}
              <p className="text-sm text-ink/60">
                Technician: {technicianNames[activeBooking.technician_id] ?? "—"}
              </p>
            </div>
          )}
        </div>

        {/* Visit timeline */}
        <div className="mt-6">
          <h3 className="mb-3 font-display text-base font-semibold text-ink">Visit timeline</h3>
          {!bookingVisits.length ? (
            <p className="text-sm text-ink/50">
              No visits scheduled yet — your technician will add one as soon as they begin.
            </p>
          ) : (
            <div className="space-y-3">
              {bookingVisits.map((v) => (
                <div
                  key={v.id}
                  className={`rounded-card border p-4 ${
                    v.status === "completed"
                      ? "border-signal-500/20 bg-signal-50/40"
                      : "border-ink/8 bg-white"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                          v.status === "completed"
                            ? "bg-signal-500 text-white"
                            : v.status === "in_progress"
                              ? "bg-spark-400 text-white"
                              : "bg-ink/10 text-ink/60"
                        }`}
                      >
                        Visit {v.visit_number} · {v.status.replace("_", " ")}
                      </span>
                    </div>
                    {v.scheduled_at && (
                      <p className="text-xs text-ink/40">
                        {new Date(v.scheduled_at).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                  <p className="mt-2 font-medium text-ink">{v.title}</p>
                  {v.description && <p className="text-sm text-ink/60">{v.description}</p>}

                  {v.notes && (
                    <div className="mt-2 rounded-lg bg-canvas px-3 py-2 text-sm text-ink/65">
                      <p className="mb-0.5 flex items-center gap-1 text-xs font-semibold text-ink/40">
                        <FileText className="h-3 w-3" /> Notes
                      </p>
                      {v.notes}
                    </div>
                  )}

                  {v.photo_urls.length > 0 && (
                    <div className="mt-2">
                      <p className="mb-1 flex items-center gap-1 text-xs font-semibold text-ink/40">
                        <ImageIcon className="h-3 w-3" /> Photos ({v.photo_urls.length})
                      </p>
                      <div className="flex gap-2">
                        {v.photo_urls.map((url, i) => (
                          <a
                            key={i}
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="block h-14 w-14 overflow-hidden rounded-lg border border-ink/10 bg-ink/5"
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={url} alt="" className="h-full w-full object-cover" />
                          </a>
                        ))}
                      </div>
                    </div>
                  )}

                  <div className="mt-2 flex items-center justify-between">
                    {v.signed_by ? (
                      <p className="flex items-center gap-1 text-xs text-signal-600">
                        <CheckCircle2 className="h-3.5 w-3.5" /> Signed by {v.signed_by}
                      </p>
                    ) : v.status === "completed" ? (
                      <button
                        onClick={() => handleSign(v.id)}
                        disabled={signingId === v.id}
                        className="text-xs font-semibold text-brand-500 hover:text-brand-600 disabled:opacity-50"
                      >
                        {signingId === v.id ? "Signing..." : "Confirm this visit"}
                      </button>
                    ) : (
                      <span />
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Important Info panel */}
      <div className="h-fit rounded-card border border-ink/8 bg-white p-5 shadow-card">
        <h3 className="font-display text-sm font-semibold text-ink">Important info</h3>
        <div className="mt-3">
          <p className="text-xs font-semibold text-ink/40">What you can do</p>
          <ul className="mt-1.5 space-y-1 text-sm text-ink/65">
            <li>View completed visits</li>
            <li>Check upcoming schedule</li>
            <li>See technician assigned</li>
            <li>Confirm a completed visit</li>
          </ul>
        </div>
        <div className="mt-4">
          <p className="text-xs font-semibold text-ink/40">How it works</p>
          <p className="mt-1.5 text-sm text-ink/65">
            Each visit is tracked with a schedule, technician, notes, photos, and your
            confirmation once the work is done.
          </p>
        </div>
      </div>
    </div>
  );
}
