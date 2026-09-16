"use client";

import type { TechnicianWithScore } from "@/types";

interface TechnicianCardProps {
  technician: TechnicianWithScore;
  rank: number;
  onSelect?: (technicianId: string) => void;
  selected?: boolean;
}

export default function TechnicianCard({
  technician,
  rank,
  onSelect,
  selected,
}: TechnicianCardProps) {
  return (
    <div
      className={`rounded-card border p-4 transition ${
        selected ? "border-brand-500 ring-1 ring-brand-500" : "border-ink/8"
      }`}
    >
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink text-xs font-bold text-white">
              {rank}
            </span>
            <h3 className="font-semibold text-ink">{technician.name}</h3>
            {technician.is_new && (
              <span className="rounded-full bg-signal-50 px-2 py-0.5 text-xs font-medium text-signal-600">
                New tech
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-ink/50">
            {technician.specializations.join(", ") || "General appliance repair"}
          </p>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold text-brand-600">{technician.score.toFixed(1)}</p>
          <p className="text-xs text-ink/35">match score</p>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-ink/65 sm:grid-cols-4">
        <div>
          <dt className="text-ink/35">Rating</dt>
          <dd>{technician.rating.toFixed(1)} / 5.0</dd>
        </div>
        <div>
          <dt className="text-ink/35">Experience</dt>
          <dd>{technician.experience_years} yrs</dd>
        </div>
        <div>
          <dt className="text-ink/35">Distance</dt>
          <dd>{technician.distance_km != null ? `${technician.distance_km} km` : "—"}</dd>
        </div>
        <div>
          <dt className="text-ink/35">Active jobs</dt>
          <dd>{technician.active_job_load}</dd>
        </div>
      </dl>

      {onSelect && (
        <button
          onClick={() => onSelect(technician.id)}
          className={`mt-3 w-full rounded-lg px-3 py-1.5 text-sm font-medium ${
            selected
              ? "bg-brand-600 text-white"
              : "border border-ink/15 text-ink/80 hover:bg-canvas"
          }`}
        >
          {selected ? "Selected" : "Select this technician"}
        </button>
      )}
    </div>
  );
}
