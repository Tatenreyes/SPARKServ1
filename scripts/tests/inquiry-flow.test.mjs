/**
 * Contract tests: what the service inquiry does when troubleshooting solves the fault.
 *
 *   npm run test:inquiry-flow
 *
 * WHY THIS EXISTS. The wizard collects a troubleshooting outcome —
 * `resolved` / `unresolved` / `skipped` — and used to submit a repair request no
 * matter which one it was. A customer who said "that fixed it" still had a request
 * created, an appliance row inserted and a technician put in the fairness rotation
 * for a visit nobody needed.
 *
 * The rule now is: `resolved` ends the inquiry. Sections 3 (Photos), 4 (Service
 * details) and 5 (Summary) are NOT RENDERED in that state — not merely collapsed,
 * because a collapsed section can still hold a `required` control — and the submit
 * handler refuses as a second line of defence. `unresolved` and `skipped` continue to
 * the full form: trying the checks and still having a fault is the ordinary outcome.
 *
 * The wizard is a client component with no runner in this repository (TESTING.md §4),
 * so this file reads it as text, like the other contract suites.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ROOT = new URL("../../", import.meta.url);
const WIZARD = "src/components/RequestRepairWizard.tsx";
const wizard = readFileSync(new URL(WIZARD, ROOT), "utf8");

// -------------------------------------------------- 1. the rule

test("only a resolved outcome skips the booking half of the form", () => {
  assert.match(wizard, /const needsVisit = troubleshootingOutcome !== "resolved";/);
  assert.match(wizard, /const troubleshootingResolved = troubleshootingOutcome === "resolved";/);
});

test("the three booking sections are gated on it", () => {
  assert.equal(
    [...wizard.matchAll(/\{needsVisit && \(/g)].length,
    3,
    "Photos, Service details and Summary must each be behind needsVisit"
  );

  for (const id of ["section-photos", "section-service", "section-summary"]) {
    const at = wizard.indexOf(`id="${id}"`);
    assert.ok(at > 0, `${id} must still exist`);
    const before = wizard.slice(Math.max(0, at - 120), at);
    assert.match(
      before,
      /\{needsVisit && \(/,
      `${id} must be inside the needsVisit block, not merely collapsed`
    );
  }
});

test("the two sections that survive a resolved fault are not gated", () => {
  for (const id of ["section-appliance", "section-problem"]) {
    const at = wizard.indexOf(`id="${id}"`);
    const before = wizard.slice(Math.max(0, at - 120), at);
    assert.doesNotMatch(before, /\{needsVisit && \(/, `${id} must always render`);
  }
});

// -------------------------------------------------- 2. the resolved end state

// The resolved screen sits AFTER the "request submitted" block, and the first
// `if (!needsVisit) {` in the file is the submit guard inside handleSubmit — so an
// unqualified indexOf would slice the wrong region entirely.
const resolvedScreenStart = wizard.indexOf(
  "if (!needsVisit) {",
  wizard.indexOf("if (submitted && serviceRequestId)")
);
const resolvedScreenEnd = wizard.indexOf("<form", resolvedScreenStart);
const resolvedScreen = wizard.slice(resolvedScreenStart, resolvedScreenEnd);

test("a resolved fault ends the flow instead of creating a request", () => {
  assert.ok(
    resolvedScreenStart > 0 && resolvedScreenEnd > resolvedScreenStart,
    "the resolved screen must sit before the form"
  );
  assert.doesNotMatch(resolvedScreen, /fetch\(/, "the resolved screen must not call the API");
  assert.doesNotMatch(
    resolvedScreen,
    /\.insert\(/,
    "…and must not create an appliance row"
  );
  assert.match(
    resolvedScreen,
    /no repair request was sent/,
    "it must say plainly that nothing was submitted"
  );
  assert.match(
    resolvedScreen,
    /setTroubleshootingOutcome\("unresolved"\)/,
    "and offer a one-tap way back — an intermittent fault is common"
  );
});

test("the resolved copy never claims the appliance was repaired", () => {
  assert.doesNotMatch(
    resolvedScreen,
    /repaired successfully|has been repaired|is fixed for good/i
  );
});

// -------------------------------------------------- 3. defence in depth

test("the submit handler refuses before it can create anything", () => {
  const handler = wizard.indexOf("async function handleSubmit");
  const guard = wizard.indexOf("if (!needsVisit) {", handler);
  // Searched from the handler, not from the top of the file: the wizard also LOADS the
  // customer's appliances with `.from("appliances")` long before this, and matching that
  // first occurrence made the ordering assertion meaningless.
  const applianceInsert = wizard.indexOf('.from("appliances")', handler);
  const requestPost = wizard.indexOf('fetch("/api/service-requests"', handler);

  assert.ok(handler > 0 && guard > 0, "handleSubmit must carry the guard");
  assert.ok(applianceInsert > 0 && requestPost > 0, "the writes must still be there");
  assert.ok(
    guard < applianceInsert && guard < requestPost,
    "the guard must precede the appliance insert AND the request POST"
  );
});

test("the legacy boolean stays derived, not hardcoded", () => {
  // tsc flags a literal `troubleshootingOutcome === "resolved"` after the early return,
  // because the union no longer contains it. Keeping the value captured earlier is what
  // stops the next person "fixing" that error by writing `false` into the payload.
  assert.match(wizard, /chatbot_resolved: troubleshootingResolved,/);
  assert.doesNotMatch(wizard, /chatbot_resolved: troubleshootingOutcome === "resolved"/);
});

// -------------------------------------------------- 4. the hidden state cannot linger

test("changing the appliance, issue or description clears the outcome", () => {
  // Otherwise a "resolved" answer could keep sections 3-5 hidden for a fault the checks
  // were never written for.
  assert.ok(
    [...wizard.matchAll(/setTroubleshootingOutcome\(null\)/g)].length >= 3,
    "the outcome must be reset when what it referred to changes"
  );
});
