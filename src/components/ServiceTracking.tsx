import Link from "next/link";
import { Check, ClipboardList, Plus } from "lucide-react";
import StatusBadge from "@/components/StatusBadge";
import type { BookingRow, EstimateRow, ServiceRequestRow } from "@/types/database";

type TrackingStep = {
  key: string;
  label: string;
  done: boolean;
  /** ISO timestamp — only set for transitions the schema actually records. */
  at?: string;
};

const DOT_DONE = "border-brand-500 bg-brand-500 text-white";
const DOT_PENDING = "border-line bg-surface text-muted/80";

function dotClass(step: TrackingStep, isCurrent: boolean) {
  if (step.done) return isCurrent ? `${DOT_DONE} ring-4 ring-line` : DOT_DONE;
  if (isCurrent) return "border-brand-400 bg-surface text-brand-ink ring-4 ring-brand-50";
  return DOT_PENDING;
}

function formatStamp(iso?: string) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Progress strip for one service request, derived from rows that already exist.
 *
 * `service_requests` (created_at / status / assigned_technician_id), `estimates`
 * (created_at) and `bookings` (scheduled_at / updated_at) record *what* happened
 * but not *when* each transition happened. Steps we can date therefore show a
 * real timestamp and the others show none — this strip is how a customer judges
 * how long they've been waiting, so a plausible-looking invented time would be
 * worse than a blank. A `service_request_status_history` table, written
 * alongside each status change, is what would let every step carry a true
 * timestamp; see `design-system/sparkserv/pages/dashboard.md`.
 *
 * The previous version was fully hardcoded — a bar frozen at step 3 with a
 * fixed "Sep 14, 10:24 AM" caption, identical for every customer regardless of
 * the state of their actual request.
 */
export function ServiceTracking({
  request,
  bookings = [],
  estimates = [],
}: {
  request: ServiceRequestRow | null;
  /** Bookings for this request, newest first. */
  bookings?: BookingRow[];
  /** Estimates for this request, newest first. */
  estimates?: EstimateRow[];
}) {
  if (!request) {
    return (
      <div className="flex flex-col items-center justify-center px-5 py-10 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-soft text-muted/80">
          <ClipboardList className="h-5 w-5" />
        </span>
        <p className="mt-3 text-sm font-medium text-ink">Nothing in progress</p>
        <p className="mt-1 text-xs text-muted">
          Submit a service inquiry and its progress will show up here, step by step.
        </p>
        <Link
          href="/customer/request-repair"
          className="mt-4 inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg bg-brand-600 px-4 text-xs font-semibold text-white transition duration-200 hover:bg-brand-700"
        >
          <Plus className="h-3.5 w-3.5" />
          Start a service inquiry
        </Link>
      </div>
    );
  }

  const booking = bookings.find((row) => row.status !== "cancelled") ?? null;
  const latestEstimate = estimates[0];
  const acceptedEstimate = estimates.find((row) => row.status === "accepted");
  const bookingActive =
    booking?.status === "in_progress" || booking?.status === "awaiting_inspection";
  const cancelled = request.status === "cancelled";
  const completed = request.status === "completed" || booking?.status === "completed";

  const steps: TrackingStep[] = [
    { key: "submitted", label: "Request submitted", done: true, at: request.created_at },
    {
      key: "assigned",
      label: "Technician assigned",
      done: Boolean(request.assigned_technician_id),
    },
    {
      key: "estimate",
      label: "Estimate prepared",
      done: estimates.length > 0,
      at: latestEstimate?.created_at,
    },
    {
      key: "approved",
      label: "Estimate approved",
      done: Boolean(acceptedEstimate),
      at: acceptedEstimate?.created_at,
    },
    {
      key: "scheduled",
      label: "Visit scheduled",
      done: Boolean(booking),
      at: booking?.scheduled_at,
    },
    {
      key: "in_progress",
      label: "Repair in progress",
      done: Boolean(bookingActive || request.status === "in_progress"),
    },
    {
      key: "completed",
      label: "Completed",
      done: Boolean(completed),
      at: completed ? booking?.updated_at : undefined,
    },
  ];

  const currentIndex = steps.reduce((last, step, index) => (step.done ? index : last), 0);
  const nextStep = steps.find((step) => !step.done);

  return (
    <div className="px-5 py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
            Reference #{request.id.slice(0, 8)}
          </p>
          <p className="mt-1 font-display text-sm font-semibold capitalize text-ink">
            {request.appliance_type.replace(/_/g, " ")}
            {request.issue_category ? (
              <span className="font-normal text-muted">
                {" · "}
                {request.issue_category.replace(/_/g, " ")}
              </span>
            ) : null}
          </p>
        </div>
        <StatusBadge status={request.status} withDot />
      </div>

      {/* Horizontal rail needs the width to keep seven labels legible, so it
          only appears from `md` up; the vertical rail below takes over under it. */}
      <ol className="mt-6 hidden md:flex md:items-start">
        {steps.map((step, index) => (
          <li key={step.key} className="flex flex-1 flex-col items-center">
            <div className="flex w-full items-center">
              <span
                className={`h-0.5 flex-1 ${
                  index === 0
                    ? "bg-transparent"
                    : steps[index - 1].done
                      ? "bg-brand-400"
                      : "bg-line"
                }`}
              />
              <span
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-bold ${dotClass(
                  step,
                  index === currentIndex
                )}`}
              >
                {step.done ? <Check className="h-3.5 w-3.5" /> : index + 1}
              </span>
              <span
                className={`h-0.5 flex-1 ${
                  index === steps.length - 1
                    ? "bg-transparent"
                    : step.done
                      ? "bg-brand-400"
                      : "bg-line"
                }`}
              />
            </div>
            <p
              className={`mt-2.5 px-1 text-center text-[11px] font-medium leading-tight ${
                step.done ? "text-ink" : "text-muted/80"
              }`}
            >
              {step.label}
            </p>
            <p className="mt-1 h-3 text-center text-[10px] text-muted/80">
              {formatStamp(step.at)}
            </p>
          </li>
        ))}
      </ol>

      <ol className="mt-5 md:hidden">
        {steps.map((step, index) => (
          <li key={step.key} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-[10px] font-bold ${dotClass(
                  step,
                  index === currentIndex
                )}`}
              >
                {step.done ? <Check className="h-3 w-3" /> : index + 1}
              </span>
              {index < steps.length - 1 && (
                <span
                  className={`mt-1 w-px flex-1 ${step.done ? "bg-brand-400" : "bg-line"}`}
                />
              )}
            </div>
            <div className="pb-4">
              <p
                className={`text-xs font-medium ${step.done ? "text-ink" : "text-muted/80"}`}
              >
                {step.label}
              </p>
              {step.at && (
                <p className="mt-0.5 text-[11px] text-muted/80">{formatStamp(step.at)}</p>
              )}
            </div>
          </li>
        ))}
      </ol>

      <p className="mt-4 border-t border-line pt-4 text-xs leading-relaxed text-muted">
        {cancelled
          ? "This request was cancelled. You can start a new inquiry any time."
          : completed
            ? "All done — thanks for choosing SPARKServ."
            : nextStep
              ? `Next up: ${nextStep.label.toLowerCase()}.`
              : ""}
      </p>
    </div>
  );
}
