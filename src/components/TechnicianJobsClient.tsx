"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Navigation, Plus, Image as ImageIcon, MessageSquare } from "lucide-react";
import type { BookingRow, ServiceRequestRow, VisitRow } from "@/types/database";
import StatusBadge from "@/components/StatusBadge";
import BookingStatusControl from "@/components/BookingStatusControl";

export default function TechnicianJobsClient({
  bookings,
  requests,
  visits,
}: {
  bookings: BookingRow[];
  requests: ServiceRequestRow[];
  visits: VisitRow[];
}) {
  const requestMap = new Map(requests.map((r) => [r.id, r]));
  const active = bookings.filter(
    (b) => b.status === "pending" || b.status === "in_progress" || b.status === "awaiting_inspection"
  );
  const completed = bookings.filter((b) => b.status === "completed" || b.status === "cancelled");

  return (
    <div className="mt-6 space-y-8">
      <section>
        <h2 className="mb-3 font-display text-base font-semibold text-ink">Active jobs</h2>
        {!active.length ? (
          <p className="text-sm text-ink/50">No active jobs right now.</p>
        ) : (
          <div className="space-y-4">
            {active.map((b) => (
              <JobCard
                key={b.id}
                booking={b}
                request={requestMap.get(b.service_request_id)}
                visits={visits.filter((v) => v.booking_id === b.id)}
              />
            ))}
          </div>
        )}
      </section>

      {completed.length > 0 && (
        <section>
          <h2 className="mb-3 font-display text-base font-semibold text-ink">Completed jobs</h2>
          <div className="space-y-2">
            {completed.map((b) => {
              const r = requestMap.get(b.service_request_id);
              return (
                <div key={b.id} className="rounded-card border border-ink/8 bg-white p-4 shadow-card">
                  <div className="flex items-center justify-between">
                    <p className="font-medium capitalize text-ink">
                      {r?.appliance_type.replace("_", " ") ?? "Job"}
                    </p>
                    <StatusBadge status={b.status} />
                  </div>
                  <p className="mt-1 text-xs text-ink/40">
                    {new Date(b.scheduled_at).toLocaleDateString()}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </div>
  );
}

function JobCard({
  booking,
  request,
  visits,
}: {
  booking: BookingRow;
  request: ServiceRequestRow | undefined;
  visits: VisitRow[];
}) {
  const router = useRouter();
  const [showAddVisit, setShowAddVisit] = useState(false);
  const [title, setTitle] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const mapsUrl = request?.location
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(request.location)}`
    : null;

  async function handleAddVisit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const res = await fetch("/api/visits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          booking_id: booking.id,
          title,
          scheduled_at: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        }),
      });
      if (res.ok) {
        setTitle("");
        setScheduledAt("");
        setShowAddVisit(false);
        router.refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="rounded-card border border-ink/8 bg-white p-4 shadow-card">
      <div className="flex items-start justify-between">
        <div>
          <p className="font-medium capitalize text-ink">
            {request?.appliance_type.replace("_", " ") ?? "Job"}
          </p>
          <p className="text-sm text-ink/60">{request?.issue_description}</p>
          <p className="mt-0.5 text-xs text-ink/40">{request?.location}</p>
          <p className="mt-1 text-xs text-ink/50">
            Scheduled: {new Date(booking.scheduled_at).toLocaleString()}
          </p>
        </div>
        <StatusBadge status={booking.status} />
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {mapsUrl && (
          <a
            href={mapsUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-full bg-ink px-3 py-1.5 text-xs font-semibold text-white hover:bg-ink/80"
          >
            <Navigation className="h-3.5 w-3.5" /> Get directions via Google Maps
          </a>
        )}
        <Link
          href={`/technician/bookings/${booking.id}`}
          className="inline-flex items-center gap-1.5 rounded-full border border-ink/15 px-3 py-1.5 text-xs font-semibold text-ink/70 hover:bg-canvas"
        >
          <MessageSquare className="h-3.5 w-3.5" /> Message customer
        </Link>
      </div>

      <BookingStatusControl bookingId={booking.id} currentStatus={booking.status} />

      {/* Visits */}
      <div className="mt-4 border-t border-ink/8 pt-3">
        <div className="mb-2 flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink/40">
            Visits ({visits.filter((v) => v.status === "completed").length}/{visits.length})
          </p>
          <button
            onClick={() => setShowAddVisit((s) => !s)}
            className="flex items-center gap-1 text-xs font-semibold text-brand-500 hover:text-brand-600"
          >
            <Plus className="h-3.5 w-3.5" /> Add visit
          </button>
        </div>

        {showAddVisit && (
          <form onSubmit={handleAddVisit} className="mb-3 space-y-2 rounded-lg bg-canvas p-3">
            <input
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Inspection & Diagnosis"
              className="w-full rounded-lg border border-ink/15 px-3 py-1.5 text-sm"
            />
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="w-full rounded-lg border border-ink/15 px-3 py-1.5 text-sm"
            />
            <button
              type="submit"
              disabled={submitting}
              className="rounded-full bg-brand-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-600 disabled:opacity-50"
            >
              {submitting ? "Adding..." : "Add"}
            </button>
          </form>
        )}

        <div className="space-y-2">
          {visits.map((v) => (
            <VisitRowControl key={v.id} visit={v} />
          ))}
        </div>
      </div>
    </div>
  );
}

function VisitRowControl({ visit }: { visit: VisitRow }) {
  const router = useRouter();
  const [notes, setNotes] = useState(visit.notes ?? "");
  const [photoUrl, setPhotoUrl] = useState("");
  const [busy, setBusy] = useState(false);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    try {
      await fetch(`/api/visits/${visit.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-ink/8 p-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-ink">
          Visit {visit.visit_number}: {visit.title}
        </p>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-semibold capitalize ${
            visit.status === "completed"
              ? "bg-signal-500 text-white"
              : visit.status === "in_progress"
                ? "bg-spark-400 text-white"
                : "bg-ink/10 text-ink/60"
          }`}
        >
          {visit.status.replace("_", " ")}
        </span>
      </div>

      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        onBlur={() => notes !== (visit.notes ?? "") && patch({ notes })}
        placeholder="Notes for this visit..."
        rows={2}
        className="mt-2 w-full rounded-lg border border-ink/15 px-2 py-1.5 text-xs"
      />

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          value={photoUrl}
          onChange={(e) => setPhotoUrl(e.target.value)}
          placeholder="Paste a photo URL"
          className="min-w-0 flex-1 rounded-lg border border-ink/15 px-2 py-1.5 text-xs"
        />
        <button
          disabled={!photoUrl || busy}
          onClick={() => {
            patch({ photo_urls: [...visit.photo_urls, photoUrl] });
            setPhotoUrl("");
          }}
          className="flex items-center gap-1 rounded-full border border-ink/15 px-2.5 py-1.5 text-xs font-medium text-ink/70 disabled:opacity-40"
        >
          <ImageIcon className="h-3.5 w-3.5" /> Add
        </button>

        {visit.status !== "completed" && (
          <button
            disabled={busy}
            onClick={() =>
              patch({ status: visit.status === "upcoming" ? "in_progress" : "completed" })
            }
            className="rounded-full bg-ink px-3 py-1.5 text-xs font-semibold text-white hover:bg-ink/80 disabled:opacity-50"
          >
            {visit.status === "upcoming" ? "Start visit" : "Mark completed"}
          </button>
        )}
      </div>

      {visit.photo_urls.length > 0 && (
        <p className="mt-1.5 text-[11px] text-ink/40">{visit.photo_urls.length} photo(s) attached</p>
      )}
    </div>
  );
}
