"use client";

/**
 * The technician's estimate form: itemized costs, a live total, and a draft.
 *
 * The total is computed with `computeEstimateTotal` — the same function the API
 * route and the database constraint use — so the number on the button is the
 * number that gets stored. The server recomputes it from the itemized fields and
 * ignores any total a client might send.
 *
 * "Save draft" keeps the quote invisible to the customer; "Submit" sends it for
 * approval. When a version has already been sent (or approved), submitting again
 * creates a NEW version and leaves the old one intact — that is how additional
 * chargeable work is proposed.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Info, Receipt } from "lucide-react";
import { computeEstimateTotal, formatMoney, validateEstimate } from "@/lib/estimate-costs";
import type { EstimateRow } from "@/types/database";

const FIELD =
  "w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-base sm:text-sm";

export interface EstimateFormProps {
  serviceRequestId: string;
  /** The version the customer is currently looking at, if any. */
  current?: EstimateRow | null;
  /** Every earlier version of this request, newest first. */
  history?: EstimateRow[];
  /** Start opened (e.g. when the customer asked for a revision). */
  defaultOpen?: boolean;
}

export default function EstimateForm({
  serviceRequestId,
  current = null,
  history = [],
  defaultOpen = false,
}: EstimateFormProps) {
  const router = useRouter();
  const isDraft = current?.status === "draft";
  const isRevision = Boolean(current) && !isDraft;

  const [open, setOpen] = useState(defaultOpen || isDraft);
  const [scope, setScope] = useState(isDraft ? current?.scope ?? "" : "");
  const [labor, setLabor] = useState(isDraft ? String(current?.labor_cost ?? "") : "");
  const [parts, setParts] = useState(isDraft ? String(current?.parts_cost ?? "") : "");
  const [other, setOther] = useState(isDraft ? String(current?.other_cost ?? "") : "");
  const [otherDescription, setOtherDescription] = useState(
    isDraft ? current?.other_description ?? "" : ""
  );
  const [notes, setNotes] = useState(isDraft ? current?.notes ?? "" : "");
  const [busy, setBusy] = useState<"draft" | "submit" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Live total from the itemized lines (an empty field counts as 0, which is what
  // makes "no parts needed" a normal case rather than an error).
  const total = useMemo(
    () =>
      computeEstimateTotal({
        labor: Number(labor || 0),
        parts: Number(parts || 0),
        other: Number(other || 0),
      }),
    [labor, parts, other]
  );

  async function save(submit: boolean) {
    setBusy(submit ? "submit" : "draft");
    setError(null);
    setNotice(null);

    // Client-side check first for a fast, specific message; the route and the
    // database validate again.
    const validation = validateEstimate({ scope, labor, parts, other, otherDescription });
    if (!validation.ok) {
      setError(validation.message ?? "Please check the amounts.");
      setBusy(null);
      return;
    }

    try {
      const res = await fetch("/api/estimates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          service_request_id: serviceRequestId,
          scope,
          labor_cost: labor,
          parts_cost: parts,
          other_cost: other,
          other_description: otherDescription,
          notes,
          submit,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "We could not save the estimate.");

      const version = json.outcome?.version ?? 1;
      setNotice(
        submit
          ? `Version ${version} sent to the customer for approval (${formatMoney(total)}).`
          : "Draft saved. The customer cannot see it until you submit it."
      );
      if (submit) setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setBusy(null);
    }
  }

  const previousApproved = history.find((old) => old.approved_at) ?? null;


  if (!open) {
    return (
      <div className="mt-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-3.5 py-2 text-xs font-semibold text-ink/80 transition duration-200 hover:bg-soft"
        >
          <Receipt className="h-3.5 w-3.5" aria-hidden="true" />
          {isDraft
            ? "Continue your draft"
            : isRevision
              ? "Submit a revised estimate"
              : "Create an estimate"}
        </button>
        {notice && <p className="mt-2 text-xs text-signal-ink">{notice}</p>}
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-line bg-soft/40 p-3.5">
      {isRevision && current && (
        <p className="flex items-start gap-1.5 rounded-lg bg-brand-soft/60 px-3 py-2 text-xs leading-relaxed text-brand-ink">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {current.status === "revision_requested"
            ? "The customer asked for a change — submitting now creates a new version."
            : `Version ${current.version} is already with the customer. Submitting creates a NEW version; the old one is kept, and any approval it had does not cover the new price or scope.`}
          {current.revision_reason ? ` Their note: “${current.revision_reason}”.` : ""}
        </p>
      )}

      {previousApproved && (
        <p className="mt-2 rounded-lg bg-canvas px-3 py-2 text-xs leading-relaxed text-ink/70">
          Previously approved:{" "}
          <span className="font-semibold">{formatMoney(previousApproved.estimated_cost)}</span>{" "}
          (version {previousApproved.version}). Your new total will need its own approval.
        </p>
      )}

      <div className="mt-3">
        <label
          htmlFor={`scope-${serviceRequestId}`}
          className="mb-1.5 block text-xs font-medium text-ink/80"
        >
          Proposed work *
        </label>
        <textarea
          id={`scope-${serviceRequestId}`}
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          rows={3}
          className={FIELD}
          placeholder="What you will do: diagnose the control board, replace the thermostat, test and clean."
        />
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <AmountField
          id={`labor-${serviceRequestId}`}
          label="Labour (₱)"
          value={labor}
          onChange={setLabor}
        />
        <AmountField
          id={`parts-${serviceRequestId}`}
          label="Parts (₱)"
          value={parts}
          onChange={setParts}
          hint="0 is fine when no parts are needed"
        />
        <AmountField
          id={`other-${serviceRequestId}`}
          label="Additional charges (₱)"
          value={other}
          onChange={setOther}
        />
      </div>


      <div className="mt-3">
        <label
          htmlFor={`other-desc-${serviceRequestId}`}
          className="mb-1.5 block text-xs font-medium text-ink/80"
        >
          What is the additional charge for?
        </label>
        <input
          id={`other-desc-${serviceRequestId}`}
          value={otherDescription}
          onChange={(e) => setOtherDescription(e.target.value)}
          className={FIELD}
          placeholder="e.g. transport to and from the shop"
        />
      </div>

      <div className="mt-3">
        <label
          htmlFor={`notes-${serviceRequestId}`}
          className="mb-1.5 block text-xs font-medium text-ink/80"
        >
          Notes, assumptions and limitations
        </label>
        <textarea
          id={`notes-${serviceRequestId}`}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          className={FIELD}
          placeholder="e.g. price assumes the compressor is serviceable; parts subject to availability."
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-surface px-3.5 py-2.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">
          Total proposed cost
        </span>
        <span className="font-display text-lg font-semibold text-ink">{formatMoney(total)}</span>
      </div>

      {error && (
        <p className="mt-2 flex items-start gap-1.5 text-xs text-alert-ink" role="alert">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          {error}
        </p>
      )}
      {notice && <p className="mt-2 text-xs text-signal-ink">{notice}</p>}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => save(true)}
          disabled={busy !== null}
          className="rounded-full bg-brand-500 px-4 py-2 text-xs font-semibold text-white transition duration-200 hover:bg-brand-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy === "submit"
            ? "Sending…"
            : isRevision
              ? "Submit revised estimate"
              : "Submit estimate for approval"}
        </button>
        <button
          type="button"
          onClick={() => save(false)}
          disabled={busy !== null}
          className="rounded-full border border-line bg-surface px-4 py-2 text-xs font-semibold text-ink/75 transition duration-200 hover:bg-canvas disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy === "draft" ? "Saving…" : "Save draft"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={busy !== null}
          className="rounded-full px-3 py-2 text-xs font-medium text-muted transition duration-200 hover:text-ink disabled:opacity-50"
        >
          Close
        </button>
      </div>
    </div>
  );
}

function AmountField({
  id,
  label,
  value,
  onChange,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-xs font-medium text-ink/80">
        {label}
      </label>
      <input
        id={id}
        type="number"
        min="0"
        step="0.01"
        inputMode="decimal"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={FIELD}
        placeholder="0.00"
      />
      {hint && <p className="mt-1 text-[11px] text-muted">{hint}</p>}
    </div>
  );
}
