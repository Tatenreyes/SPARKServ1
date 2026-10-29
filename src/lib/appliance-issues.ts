/**
 * The canonical appliance-issue catalogue.
 *
 * ONE source of truth for:
 *   * the "What problem are you experiencing?" selector in the request wizard,
 *   * the multilingual matcher (`src/lib/issue-matching.ts`), which may only ever
 *     return an issue that exists here, and
 *   * the troubleshooting guides (`src/lib/troubleshooting.ts`), keyed by these ids.
 *
 * Every entry is an issue SPARKServ already supported — this file introduces no
 * new faults, it only gives each existing one a stable identifier. The `label` is
 * the exact string the form used before, so `service_requests.issue_category`
 * (and every screen that reads it) keeps working unchanged.
 *
 * ## Adding an appliance or an issue
 *   1. add `{ id, label }` to the appliance's list below (or add the appliance),
 *   2. add its approved synonyms in `issue-matching.ts`,
 *   3. add its guide in `troubleshooting.ts` (or leave it out deliberately — the
 *      form then says no guide is available instead of inventing one).
 *
 * `id` must be stable: it is persisted in `service_requests.issue_id`, so renaming
 * one orphans historical rows.
 */

export interface ApplianceIssue {
  /** Stable identifier, e.g. "not-cooling". Persisted — never rename casually. */
  id: string;
  /** Customer-facing label, e.g. "Not cooling". */
  label: string;
}

export const APPLIANCE_ISSUES: Record<string, ApplianceIssue[]> = {
  Refrigerator: [
    { id: "not-cooling", label: "Not cooling" },
    { id: "not-turning-on", label: "Not turning on" },
    { id: "leaking-water", label: "Leaking water" },
    { id: "making-unusual-noise", label: "Making unusual noise" },
    { id: "not-making-ice", label: "Not making ice" },
    { id: "freezer-not-freezing", label: "Freezer not freezing" },
    { id: "over-freezing", label: "Over-freezing" },
    { id: "not-defrosting", label: "Not defrosting" },
    { id: "error-code", label: "Error code" },
    { id: "other", label: "Other" },
  ],
  "Air Conditioner": [
    { id: "not-cooling", label: "Not cooling" },
    { id: "not-turning-on", label: "Not turning on" },
    { id: "leaking-water", label: "Leaking water" },
    { id: "weak-airflow", label: "Weak airflow" },
    { id: "making-noise", label: "Making noise" },
    { id: "remote-not-working", label: "Remote not working" },
    { id: "ice-frost-formation", label: "Ice/frost formation" },
    { id: "error-code", label: "Error code" },
    { id: "other", label: "Other" },
  ],
  "Washing Machine": [
    { id: "not-spinning", label: "Not spinning" },
    { id: "not-draining", label: "Not draining" },
    { id: "not-filling", label: "Not filling" },
    { id: "leaking", label: "Leaking" },
    { id: "making-noise", label: "Making noise" },
    { id: "not-turning-on", label: "Not turning on" },
    { id: "error-code", label: "Error code" },
    { id: "other", label: "Other" },
  ],
  Television: [
    { id: "no-display", label: "No display" },
    { id: "no-sound", label: "No sound" },
    { id: "screen-flickering", label: "Screen flickering" },
    { id: "lines-on-screen", label: "Lines on screen" },
    { id: "remote-not-working", label: "Remote not working" },
    { id: "error-code", label: "Error code" },
    { id: "other", label: "Other" },
  ],
  "Electric Fan": [
    { id: "not-turning-on", label: "Not turning on" },
    { id: "not-spinning", label: "Not spinning" },
    { id: "making-noise", label: "Making noise" },
    { id: "weak-airflow", label: "Weak airflow" },
    { id: "other", label: "Other" },
  ],
  "Microwave Oven": [
    { id: "not-turning-on", label: "Not turning on" },
    { id: "not-heating", label: "Not heating" },
    { id: "making-noise", label: "Making noise" },
    { id: "error-code", label: "Error code" },
    { id: "other", label: "Other" },
  ],
  "Rice Cooker": [
    { id: "not-turning-on", label: "Not turning on" },
    { id: "not-cooking", label: "Not cooking" },
    { id: "leaking", label: "Leaking" },
    { id: "error-code", label: "Error code" },
    { id: "other", label: "Other" },
  ],
  "Electric Stove": [
    { id: "not-turning-on", label: "Not turning on" },
    { id: "not-heating", label: "Not heating" },
    { id: "error-code", label: "Error code" },
    { id: "other", label: "Other" },
  ],
  "Induction Cooker": [
    { id: "not-turning-on", label: "Not turning on" },
    { id: "not-heating", label: "Not heating" },
    { id: "error-code", label: "Error code" },
    { id: "other", label: "Other" },
  ],
  "Water Dispenser": [
    { id: "not-dispensing", label: "Not dispensing" },
    { id: "not-cooling-heating", label: "Not cooling/heating" },
    { id: "leaking", label: "Leaking" },
    { id: "error-code", label: "Error code" },
    { id: "other", label: "Other" },
  ],
  "Electric Kettle": [
    { id: "not-turning-on", label: "Not turning on" },
    { id: "not-heating", label: "Not heating" },
    { id: "leaking", label: "Leaking" },
    { id: "error-code", label: "Error code" },
    { id: "other", label: "Other" },
  ],
  "Vacuum Cleaner": [
    { id: "not-turning-on", label: "Not turning on" },
    { id: "weak-suction", label: "Weak suction" },
    { id: "making-noise", label: "Making noise" },
    { id: "error-code", label: "Error code" },
    { id: "other", label: "Other" },
  ],
  "Clothes Dryer": [
    { id: "not-spinning", label: "Not spinning" },
    { id: "not-heating", label: "Not heating" },
    { id: "not-draining", label: "Not draining" },
    { id: "error-code", label: "Error code" },
    { id: "other", label: "Other" },
  ],
  Freezer: [
    { id: "not-freezing", label: "Not freezing" },
    { id: "not-turning-on", label: "Not turning on" },
    { id: "leaking-water", label: "Leaking water" },
    { id: "making-noise", label: "Making noise" },
    { id: "error-code", label: "Error code" },
    { id: "other", label: "Other" },
  ],
  "Water Heater": [
    { id: "not-heating", label: "Not heating" },
    { id: "not-turning-on", label: "Not turning on" },
    { id: "leaking", label: "Leaking" },
    { id: "error-code", label: "Error code" },
    { id: "other", label: "Other" },
  ],
};

/** "Air Conditioner" → "air-conditioner". Used for guide keys and slugs. */
export function applianceSlug(applianceType: string): string {
  return applianceType
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * The issues the customer may pick for this appliance. Returns an empty array for
 * an unknown appliance — the caller shows an empty state rather than falling back
 * to another appliance's list, which is how a stale issue used to stay selectable.
 */
export function getApplianceIssues(applianceType: string): ApplianceIssue[] {
  return APPLIANCE_ISSUES[applianceType] ?? [];
}

/**
 * Looks an issue up **within the appliance's own catalogue**. This is the guard
 * that keeps appliance-specific matching honest: an issue belonging to another
 * appliance simply does not exist here, so it can neither be selected nor matched.
 */
export function getIssueById(
  applianceType: string,
  issueId: string | null | undefined
): ApplianceIssue | null {
  if (!issueId) return null;
  return getApplianceIssues(applianceType).find((issue) => issue.id === issueId) ?? null;
}

export function isIssueOfAppliance(applianceType: string, issueId: string): boolean {
  return getIssueById(applianceType, issueId) !== null;
}

export function getIssueLabel(
  applianceType: string,
  issueId: string | null | undefined
): string | null {
  return getIssueById(applianceType, issueId)?.label ?? null;
}

/** Every issue id in the catalogue. Used by the mapping tests. */
export function allIssueIds(): string[] {
  const ids = new Set<string>();
  for (const issues of Object.values(APPLIANCE_ISSUES)) {
    for (const issue of issues) ids.add(issue.id);
  }
  return [...ids];
}
