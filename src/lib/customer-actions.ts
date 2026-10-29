/**
 * The customer's "what do I need to do?" list, as data.
 *
 * The dashboard builds this array from rows it has already fetched and renders
 * the first item as the "next step" card (with a count and a link to the rest).
 * The type lives here — not in a component — so the page can describe an action
 * without importing UI it does not render, and so a future renderer can consume
 * the same shape without a second definition of it.
 */

export type MobileActionKind =
  | "estimate"
  | "schedule"
  | "payment"
  | "inspection"
  | "assignment"
  | "info";

export type MobileAction = {
  /** Stable React key — a row id plus its kind, never the title. */
  id: string;
  kind: MobileActionKind;
  /** Imperative headline. "Estimate ready", not "Your repair status changed". */
  title: string;
  /** What it is about — the appliance ("Samsung Refrigerator"). */
  subject?: string;
  /** Peso amount, only where money is the decision. */
  amount?: number;
  /** One line of why it matters, in the customer's words. */
  detail?: string;
  /** Label of the button. */
  cta: string;
  href: string;
};

/** `₱1,850` — grouped, no trailing `.00` on a whole peso amount. */
export function formatPeso(amount: number): string {
  const rounded = Math.round(amount * 100) / 100;
  return `₱${rounded.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}
