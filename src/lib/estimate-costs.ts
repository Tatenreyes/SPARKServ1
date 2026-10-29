/**
 * Estimate money rules — the ONE place the total is defined.
 *
 * Imported by the technician's form (live total preview) and by the API route
 * (validation before the database function sees it), so the number on the button
 * and the number stored can never be computed two different ways. The database
 * enforces the same rule again with `estimates_amounts_check`.
 *
 * Pure and dependency-free: no React, no Supabase, no server-only imports.
 */

/** Two decimal places — the currency's minor unit, matching numeric(10,2). */
export const MONEY_DECIMALS = 2;

/** Largest single line the database will accept (numeric(10,2)). */
export const MAX_MONEY_AMOUNT = 99_999_999.99;

export interface EstimateAmounts {
  labor: number;
  parts: number;
  other: number;
}

/** Rounds to the currency's minor unit (half-up), avoiding float drift. */
export function roundMoney(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** MONEY_DECIMALS;
  // Scaling through the DECIMAL string ("111.115e2" → 11111.5) rounds the number
  // the user typed, instead of the binary float that is a hair below the midpoint
  // (111.115 * 100 is 11111.499999999998, which would round DOWN to 111.11).
  // Exponential notations such as "1e+21e2" do not parse, so those fall back.
  const scaled = Number(`${value}e${MONEY_DECIMALS}`);
  return Number.isFinite(scaled)
    ? Math.round(scaled) / factor
    : Math.round(value * factor) / factor;
}

/**
 * Parses a form field into a money value, or `null` when it is not a usable
 * amount. Accepts "" as 0 (an unused line), rejects negatives, NaN, Infinity and
 * anything larger than the column allows.
 */
export function parseMoneyInput(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed === "") return 0;
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return null;
    return isUsableAmount(parsed) ? roundMoney(parsed) : null;
  }
  if (typeof value === "number") {
    return isUsableAmount(value) ? roundMoney(value) : null;
  }
  return null;
}

function isUsableAmount(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= MAX_MONEY_AMOUNT;
}

/**
 * The total, derived from the itemized lines — never taken from the client.
 * `parts` may be 0 (plenty of repairs need no parts at all).
 */
export function computeEstimateTotal(amounts: Partial<EstimateAmounts>): number {
  return roundMoney(
    roundMoney(amounts.labor ?? 0) +
      roundMoney(amounts.parts ?? 0) +
      roundMoney(amounts.other ?? 0)
  );
}


export type EstimateValidationCode =
  | "labor_invalid"
  | "parts_invalid"
  | "other_invalid"
  | "other_description_required"
  | "total_not_positive"
  | "scope_required";

export interface EstimateValidationResult {
  ok: boolean;
  /** Machine-readable reason, so the caller can point at the right field. */
  code?: EstimateValidationCode;
  message?: string;
  amounts?: EstimateAmounts;
  total?: number;
}

/**
 * Validates one estimate submission.
 *
 * `scope` is required because a price without a described job is not something a
 * customer can meaningfully approve. A parts cost of 0 is fine; an additional
 * service charge is fine but must say what it is for.
 */
export function validateEstimate(input: {
  scope: string | null | undefined;
  labor: unknown;
  parts: unknown;
  other: unknown;
  otherDescription?: string | null;
}): EstimateValidationResult {
  const scope = (input.scope ?? "").trim();
  if (!scope) {
    return {
      ok: false,
      code: "scope_required",
      message: "Describe the work you propose to do — the customer is approving that scope.",
    };
  }

  const labor = parseMoneyInput(input.labor);
  if (labor === null) {
    return { ok: false, code: "labor_invalid", message: "Enter a valid labour cost (0 or more)." };
  }
  const parts = parseMoneyInput(input.parts);
  if (parts === null) {
    return { ok: false, code: "parts_invalid", message: "Enter a valid parts cost (0 or more)." };
  }
  const other = parseMoneyInput(input.other);
  if (other === null) {
    return {
      ok: false,
      code: "other_invalid",
      message: "Enter a valid additional charge (0 or more).",
    };
  }

  const otherDescription = (input.otherDescription ?? "").trim();
  if (other > 0 && !otherDescription) {
    return {
      ok: false,
      code: "other_description_required",
      message: "Describe the additional charge so the customer knows what they are paying for.",
    };
  }

  const total = computeEstimateTotal({ labor, parts, other });
  if (total <= 0) {
    return {
      ok: false,
      code: "total_not_positive",
      message: "The total must be greater than zero.",
    };
  }

  return { ok: true, amounts: { labor, parts, other }, total };
}

/** ₱1,234.50 — one formatter, so every screen shows money the same way. */
export function formatMoney(value: number | null | undefined): string {
  const amount = typeof value === "number" && Number.isFinite(value) ? value : 0;
  return `₱${amount.toLocaleString("en-PH", {
    minimumFractionDigits: MONEY_DECIMALS,
    maximumFractionDigits: MONEY_DECIMALS,
  })}`;
}

/**
 * What a version's status means. `pending` is worded from the reader's side of
 * the decision, so the customer sees "Awaiting customer decision" on the same row
 * the technician sees it on.
 */
export function estimateStatusLabel(status: string): string {
  switch (status) {
    case "draft":
      return "Draft — not sent";
    case "pending":
      return "Awaiting customer decision";
    case "revision_requested":
      return "Revision requested";
    case "accepted":
      return "Approved";
    case "rejected":
      return "Declined";
    case "superseded":
      return "Superseded by a newer version";
    default:
      return status.replace(/_/g, " ");
  }
}

/** True while the customer still owes a decision (or the technician a revision). */
export function isOpenEstimateStatus(status: string): boolean {
  return status === "draft" || status === "pending" || status === "revision_requested";
}

/**
 * True when this version is the one a booking may be created from: the live
 * approval, not a superseded one.
 */
export function isBookableEstimate(estimate: {
  status: string;
  superseded_by?: string | null;
}): boolean {
  return estimate.status === "accepted" && !estimate.superseded_by;
}

/**
 * Whether a REQUEST can still receive an appointment.
 *
 * An approved estimate is not enough on its own: the repair it belongs to has a
 * lifecycle, and `quoted` is the only state a new booking may be created from —
 * the estimate is approved and the technician has accepted, but no live appointment
 * exists yet. Every other state either already has one or has closed the request:
 *
 *   * `booked` / `in_progress` — the appointment exists, the repair is under way;
 *   * `completed`              — the repair is finished;
 *   * `cancelled`              — the request is final;
 *   * `open`                   — no approved estimate to book against.
 *
 * Asking the REQUEST also answers the booking question, which is why this does not
 * need the booking row: a cancelled appointment reopens its request to `quoted`
 * (supabase/migration_cancel_release.sql), so the same repair can be booked again
 * at another time — and only then.
 *
 * `undefined`/`null` mean the caller did not supply the status: it is left alone and
 * the server stays the authority, exactly like `assignment_status`.
 */
export function canBookFromRequest(status: string | null | undefined): boolean {
  return status === undefined || status === null || status === "quoted";
}

/**
 * True when the request behind an estimate is over — completed or cancelled.
 *
 * Such an estimate is the approved RECORD of what was agreed, not something awaiting
 * a decision or an appointment, so a customer screen must offer neither.
 */
export function isClosedRequestStatus(status: string | null | undefined): boolean {
  return status === "completed" || status === "cancelled";
}

/**
 * True when the repair behind a request is FINISHED.
 *
 * A finished repair's estimate has left the customer's Estimates page for Service
 * history: it is the record of a completed job, and leaving it among the estimates
 * that still want a decision is what made finished work look like an open one.
 *
 * A CANCELLED request is deliberately not included. Nothing was repaired, so Service
 * history has no row to carry the quote — the estimate is the only record of what was
 * proposed, so it stays where the customer can still read it.
 */
export function isCompletedRequestStatus(status: string | null | undefined): boolean {
  return status === "completed";
}
