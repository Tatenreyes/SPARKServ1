"use client";

/**
 * The customer's view of ONE estimate version, and the decisions they can make
 * about it.
 *
 * One component, used on both `/customer/estimates` and the request page, so the
 * two screens cannot drift. It is deliberately the only place the three actions
 * (approve / request a revision / decline) exist:
 *
 *   * every action is confirmed before it is sent, and the buttons lock while a
 *     request is in flight, so a double click cannot send two decisions;
 *   * the decision is about THIS version — the version number and total sit next
 *     to the buttons, and the server re-checks that the version is still the one
 *     awaiting a decision;
 *   * approving does NOT book anything. Scheduling is a separate step that only
 *     appears once the version is approved AND the request has a technician who
 *     accepted it, and a scheduling conflict leaves the approval intact so the
 *     customer can pick another time. When no technician has accepted yet, the step
 *     is replaced by the shared assignment wording rather than a form that cannot
 *     succeed — the same copy the request page shows.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  FileText,
  History,
  Info,
  MessageSquareWarning,
  Receipt,
  XCircle,
} from "lucide-react";
import StatusBadge from "@/components/StatusBadge";
import {
  canBookFromRequest,
  formatMoney,
  isBookableEstimate,
  isClosedRequestStatus,
} from "@/lib/estimate-costs";
import { customerAssignmentCopy } from "@/lib/queue";
import type { EstimateRow } from "@/types/database";

type PendingAction = "approve" | "decline" | "revision" | null;

export interface EstimateReviewCardProps {
  estimate: EstimateRow;
  /** Earlier versions of the same request, newest first. */
  history?: EstimateRow[];
  request?: {
    appliance_type: string;
    problem_description: string;
    /**
     * The request's assignment state. Optional so an existing caller keeps working:
     * `undefined` means "not supplied" and leaves the booking form in place, while a
     * known status that is not `accepted` means the form cannot succeed and is
     * replaced by an explanation. The database is still the authority — this only
     * stops the UI from offering a button that can only fail.
     */
    assignment_status?: string;
    /**
     * The REQUEST's lifecycle state. An approved estimate is not on its own a licence
     * to book: the repair may already have an appointment, be under way, be finished
     * or be cancelled, and a booking form on any of those can only fail. Optional so
     * an existing caller keeps working — `undefined` leaves the form in place and the
     * server stays the authority, exactly like `assignment_status`.
     */
    status?: string;
  } | null;
  /** Called after a decision or a booking so the page can refresh its data. */
  onChanged?: () => void;
}

export default function EstimateReviewCard({
  estimate,
  history = [],
  request = null,
  onChanged,
}: EstimateReviewCardProps) {
  const router = useRouter();
  const [pending, setPending] = useState<PendingAction>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [scheduledAt, setScheduledAt] = useState("");
  const [showHistory, setShowHistory] = useState(false);

  const bookable = isBookableEstimate(estimate);
  const submittedAt = estimate.submitted_at ?? estimate.created_at;
  // Booking needs an ACCEPTED assignment as well as an approved estimate. A caller
  // that does not pass the assignment state is left alone (the server decides), but a
  // request we KNOW has no accepted technician must not offer a form that can only
  // come back as a refusal.
  const assignmentStatus = request?.assignment_status;
  const assignmentCopy = customerAssignmentCopy(assignmentStatus ?? "matching");

  // An approval is not the only precondition: the REPAIR has a lifecycle too. Once
  // the appointment exists, the work is under way, or the request is finished or
  // cancelled, there is nothing left to book — the database refuses a second live
  // booking and a closed request is final. Without this the customer was shown
  // "Choose an appointment time / Confirm booking" on repairs that were already
  // completed: a form that can only fail.
  const requestStatus = request?.status;
  const repairClosed = isClosedRequestStatus(requestStatus);
  const repairBooked = requestStatus === "booked" || requestStatus === "in_progress";
  const canSchedule =
    bookable &&
    (assignmentStatus === undefined || assignmentStatus === "accepted") &&
    canBookFromRequest(requestStatus);

  /**
   * Why the booking step is absent, when the estimate itself is approved.
   *
   * The wording differs per state on purpose: "we are still finding you a
   * technician" is simply wrong — and alarming — on a repair that was completed
   * last week, and it invites the customer to wait for something that will never
   * happen.
   */
  const repairStateCopy = repairClosed
    ? requestStatus === "cancelled"
      ? {
          title: "This request was cancelled",
          body: "No appointment can be booked from a cancelled request. This estimate stays as the record of what was quoted.",
          href: "/customer/repairs",
          label: "Start a new request",
        }
      : {
          title: "This repair is complete",
          body: "You approved this estimate and the work is finished, so there is nothing left to approve or schedule. The approved total above is the record of what you agreed to pay.",
          href: "/customer/repair-history",
          label: "See repair history",
        }
    : {
        title: "This repair is already booked",
        body: "Your appointment exists, so there is nothing to approve or schedule here. Your approval still stands.",
        href: "/customer/bookings",
        label: "See your bookings",
      };

  async function decide(
    action: "approve" | "decline" | "request_revision",
    decisionReason?: string
  ) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/estimates/${estimate.id}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: action, reason: decisionReason || undefined }),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok) {
        // A 409 means this version was already decided (another tab, or a retry):
        // refresh so the customer sees the real state instead of a stale one.
        if (res.status === 409) {
          setNotice(json.error ?? "This estimate was already decided.");
          setPending(null);
          onChanged?.();
          router.refresh();
          return;
        }
        throw new Error(json.error ?? "We could not record your decision.");
      }

      setNotice(
        action === "approve"
          ? "Estimate approved. Choose an appointment time below to confirm the booking."
          : action === "decline"
            ? "Estimate declined. The technician has been told."
            : "Revision requested. The technician will send an updated estimate."
      );
      setPending(null);
      setReason("");
      onChanged?.();
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function book() {
    if (!scheduledAt) {
      setError("Pick a date and time first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/bookings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service_request_id: estimate.service_request_id,
          technician_id: estimate.technician_id,
          estimate_id: estimate.id,
          scheduled_at: new Date(scheduledAt).toISOString(),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        // A retry — a double click, or a response that arrived late — already created
        // the appointment. The route answers `already_booked` with the booking id, so
        // show the customer the booking they have instead of an error.
        if (res.status === 409 && json.code === "already_booked" && json.booking_id) {
          router.push(`/customer/bookings/${json.booking_id}`);
          return;
        }
        throw new Error(json.error ?? "We could not confirm that appointment.");
      }
      router.push(`/customer/bookings/${json.data.id}`);
    } catch (err) {
      // A clash does not touch the approval: pick another slot and try again.
      setError(err instanceof Error ? err.message : "Booking failed.");
    } finally {
      setBusy(false);
    }
  }


  return (
    <section className="rounded-card border border-ink/8 bg-surface p-5 shadow-card">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium capitalize text-muted">
            {request?.appliance_type?.replace(/_/g, " ") ?? "Repair"} · version {estimate.version}
          </p>
          <p className="mt-1 text-xs text-muted">
            Submitted{" "}
            {new Date(submittedAt).toLocaleString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}
          </p>
        </div>
        <StatusBadge status={estimate.status} />
      </header>

      <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-brand-soft/50 px-3 py-2 text-[11px] leading-relaxed text-brand-ink">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        This is a preliminary quotation based on what the technician knows so far. An
        inspection may reveal more work — any additional chargeable work needs a revised
        estimate that you approve before it is carried out.
      </p>

      {estimate.scope && (
        <div className="mt-4">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-ink">
            <FileText className="h-3.5 w-3.5 text-brand-ink" aria-hidden="true" /> Proposed work
          </p>
          <p className="mt-1 whitespace-pre-line text-sm text-ink/75">{estimate.scope}</p>
        </div>
      )}

      {request?.problem_description && (
        <p className="mt-3 text-xs text-muted">
          Reported problem: <span className="text-ink/70">{request.problem_description}</span>
        </p>
      )}

      <div className="mt-4 rounded-xl border border-line bg-soft/40 p-3.5">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-ink">
          <Receipt className="h-3.5 w-3.5 text-brand-ink" aria-hidden="true" /> Cost breakdown
        </p>
        <dl className="mt-2 space-y-1.5 text-sm">
          <CostLine label="Labour" value={estimate.labor_cost} />
          <CostLine label="Parts" value={estimate.parts_cost} />
          <CostLine
            label={
              estimate.other_description
                ? `Additional: ${estimate.other_description}`
                : "Additional charges"
            }
            value={estimate.other_cost}
          />
        </dl>
        <div className="mt-2.5 flex items-center justify-between border-t border-line pt-2.5">
          <dt className="text-xs font-semibold uppercase tracking-wide text-muted">Total</dt>
          <dd className="font-display text-xl font-semibold text-ink">
            {formatMoney(estimate.estimated_cost)}
          </dd>
        </div>
      </div>

      {estimate.notes && (
        <div className="mt-3">
          <p className="text-xs font-semibold text-ink">Notes and assumptions</p>
          <p className="mt-1 whitespace-pre-line rounded-lg bg-canvas px-3 py-2 text-sm text-ink/65">
            {estimate.notes}
          </p>
        </div>
      )}

      {estimate.status === "revision_requested" && (
        <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-warn-soft/60 px-3 py-2 text-xs leading-relaxed text-warn-ink">
          <MessageSquareWarning className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          You asked for a change
          {estimate.revision_reason ? `: ${estimate.revision_reason}` : "."} The technician will
          send a revised version for you to approve.
        </p>
      )}

      {estimate.status === "rejected" && (
        <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-white px-3 py-2 text-xs leading-relaxed text-alert-ink">
          <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          You declined this estimate
          {estimate.decision_note ? `: ${estimate.decision_note}` : "."} No booking has been made.
        </p>
      )}

      {estimate.status === "superseded" && (
        <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-soft px-3 py-2 text-xs leading-relaxed text-muted">
          <History className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          A newer version replaced this one
          {estimate.approved_at
            ? " — it had been approved before the revision, and that approval does not cover the new scope or price."
            : "."}
        </p>
      )}

      {notice && (
        <p
          className="mt-3 flex items-start gap-1.5 rounded-xl bg-signal-soft/60 px-3 py-2 text-xs leading-relaxed text-signal-ink"
          role="status"
        >
          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {notice}
        </p>
      )}


      {/* ---- The decision, and only on the version awaiting one ---- */}
      {estimate.status === "pending" && (
        <div className="mt-4 border-t border-line pt-4">
          {pending === null && (
            <>
              <p className="text-xs leading-relaxed text-muted">
                Approving agrees to{" "}
                <span className="font-semibold text-ink">
                  {formatMoney(estimate.estimated_cost)}
                </span>{" "}
                for version {estimate.version}. You choose the appointment time in the next
                step — approving does not book anything yet.
              </p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  onClick={() => {
                    setPending("approve");
                    setError(null);
                    setNotice(null);
                  }}
                  className="flex-1 rounded-full bg-signal-500 px-4 py-2.5 text-sm font-semibold text-white transition duration-200 hover:bg-signal-600"
                >
                  Approve estimate
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPending("revision");
                    setError(null);
                    setNotice(null);
                  }}
                  className="flex-1 rounded-full border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-ink/75 transition duration-200 hover:bg-soft"
                >
                  Request revision
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setPending("decline");
                    setError(null);
                    setNotice(null);
                  }}
                  className="flex-1 rounded-full border border-alert-500/30 px-4 py-2.5 text-sm font-semibold text-alert-ink transition duration-200 hover:bg-alert-soft"
                >
                  Decline estimate
                </button>
              </div>
            </>
          )}

          {pending === "approve" && (
            <ConfirmPanel
              title={`Approve ${formatMoney(estimate.estimated_cost)}?`}
              body={`This approves version ${estimate.version} exactly as shown. The technician can then schedule the visit with you.`}
              confirmLabel="Yes, approve"
              confirmTone="signal"
              busy={busy}
              onConfirm={() => decide("approve")}
              onCancel={() => setPending(null)}
            />
          )}

          {pending === "decline" && (
            <ConfirmPanel
              title="Decline this estimate?"
              body="No booking is made and the technician is told. You can still agree a different arrangement with them, or ask for a revision."
              confirmLabel="Yes, decline"
              confirmTone="alert"
              busy={busy}
              onConfirm={() => decide("decline", reason)}
              onCancel={() => setPending(null)}
            >
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                placeholder="Reason (optional)"
                className="mt-2 w-full rounded-lg border border-ink/15 px-3 py-2 text-sm"
              />
            </ConfirmPanel>
          )}

          {pending === "revision" && (
            <ConfirmPanel
              title="Ask for a revised estimate?"
              body="Tell the technician what should change — a different scope, cheaper parts, a clearer breakdown. They will send a new version for you to approve."
              confirmLabel="Send request"
              confirmTone="brand"
              busy={busy}
              onConfirm={() => decide("request_revision", reason)}
              onCancel={() => setPending(null)}
            >
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                placeholder="What should change? (optional, but it helps the technician)"
                className="mt-2 w-full rounded-lg border border-ink/15 px-3 py-2 text-sm"
              />
            </ConfirmPanel>
          )}
        </div>
      )}


      {/* ---- Approved, and the repair is already booked or over ---- */}
      {/* An approval is not a licence to book. Once an appointment exists, the work
          is under way, or the request is finished or cancelled, the booking step is
          gone — and it must say WHICH of those it is, because the "waiting for a
          technician" wording below would be wrong for every one of them. */}
      {bookable && !canSchedule && (repairClosed || repairBooked) && (
        <div className="mt-4 border-t border-line pt-4">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-ink">
            {repairClosed ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-signal-ink" aria-hidden="true" />
            ) : (
              <CalendarClock className="h-3.5 w-3.5 text-brand-ink" aria-hidden="true" />
            )}
            {repairStateCopy.title}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted">{repairStateCopy.body}</p>
          <Link
            href={repairStateCopy.href}
            className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-ink hover:underline"
          >
            {repairStateCopy.label}
          </Link>
        </div>
      )}

      {/* ---- Approved, but nobody has accepted the request yet ---- */}
      {/* The estimate is approved and the customer may want to get on with it, but
          there is no technician to schedule: show the assignment state (the shared
          `customerAssignmentCopy` wording, so this card cannot drift from the request
          page) instead of a Confirm button that could only come back as a refusal. */}
      {bookable && !canSchedule && !repairClosed && !repairBooked && (
        <div className="mt-4 border-t border-line pt-4">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-ink">
            <Info className="h-3.5 w-3.5 text-brand-ink" aria-hidden="true" />
            {assignmentCopy.title}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted">{assignmentCopy.body}</p>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            You will be able to choose an appointment time once a technician who services{" "}
            <span className="font-medium text-ink/80">
              {request?.appliance_type?.replace(/_/g, " ") ?? "this appliance"}
            </span>{" "}
            has accepted this request. Your request stays in line until then.
          </p>
        </div>
      )}

      {/* ---- Approved: schedule the visit (a separate, validated step) ---- */}
      {canSchedule && (
        <div className="mt-4 border-t border-line pt-4">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-ink">
            <CalendarClock className="h-3.5 w-3.5 text-brand-ink" aria-hidden="true" />
            Choose an appointment time
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted">
            The slot is checked against the technician&apos;s schedule and capacity when you
            confirm. If it clashes you will be asked for another time — your approval stands.
          </p>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <input
              type="datetime-local"
              value={scheduledAt}
              onChange={(e) => setScheduledAt(e.target.value)}
              className="rounded-lg border border-ink/15 px-3 py-2 text-sm text-white"
            />
            <button
              type="button"
              onClick={book}
              disabled={busy || !scheduledAt}
              className="rounded-full bg-brand-500 px-4 py-2 text-sm font-semibold text-white transition duration-200 hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Confirming…" : "Confirm booking"}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p
          className="mt-3 flex items-start gap-1.5 rounded-xl bg-alert-soft/60 px-3 py-2 text-xs leading-relaxed text-alert-ink"
          role="alert"
        >
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}

      {/* ---- Older versions: the history an approval never overwrote ---- */}
      {history.length > 0 && (
        <div className="mt-4 border-t border-line pt-3">
          <button
            type="button"
            onClick={() => setShowHistory((open) => !open)}
            aria-expanded={showHistory}
            className="inline-flex items-center gap-1.5 text-xs font-semibold text-brand-ink hover:underline"
          >
            <History className="h-3.5 w-3.5" aria-hidden="true" />
            {showHistory ? "Hide" : "Show"} {history.length} earlier version
            {history.length === 1 ? "" : "s"}
          </button>
          {showHistory && (
            <ul className="mt-2 space-y-2">
              {history.map((old) => (
                <li
                  key={old.id}
                  className="rounded-xl border border-line bg-soft/40 px-3 py-2.5 text-xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-ink">
                      Version {old.version} · {formatMoney(old.estimated_cost)}
                    </span>
                    <StatusBadge status={old.status} size="sm" />
                  </div>
                  {old.scope && <p className="mt-1 text-muted">{old.scope}</p>}
                  <p className="mt-1 text-[11px] text-muted">
                    {old.approved_at
                      ? `Approved ${new Date(old.approved_at).toLocaleDateString()}`
                      : old.decided_at
                        ? `Decided ${new Date(old.decided_at).toLocaleDateString()}`
                        : `Sent ${new Date(
                            old.submitted_at ?? old.created_at
                          ).toLocaleDateString()}`}
                    {old.revision_reason ? ` · you asked: ${old.revision_reason}` : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}

function ConfirmPanel({
  title,
  body,
  confirmLabel,
  confirmTone,
  busy,
  onConfirm,
  onCancel,
  children,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  confirmTone: "signal" | "alert" | "brand";
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children?: React.ReactNode;
}) {
  const tone =
    confirmTone === "alert"
      ? "bg-alert-500 hover:bg-alert-600"
      : confirmTone === "signal"
        ? "bg-signal-500 hover:bg-signal-600"
        : "bg-brand-500 hover:bg-brand-600";

  return (
    <div className="rounded-xl border border-line bg-soft/50 p-3.5">
      <p className="text-sm font-semibold text-ink">{title}</p>
      <p className="mt-1 text-xs leading-relaxed text-muted">{body}</p>
      {children}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onConfirm}
          disabled={busy}
          className={`rounded-full px-4 py-2 text-sm font-semibold text-white transition duration-200 disabled:cursor-not-allowed disabled:opacity-50 ${tone}`}
        >
          {busy ? "Sending…" : confirmLabel}
        </button>
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium text-ink/70 transition duration-200 hover:bg-canvas disabled:opacity-50"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

function CostLine({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="min-w-0 break-words text-xs text-muted">{label}</dt>
      <dd className="shrink-0 text-sm font-medium text-ink/80">{formatMoney(value)}</dd>
    </div>
  );
}
