/**
 * Unit tests for the troubleshooting guides.
 *
 *   npm run test:issues
 *
 * Two things are being protected here:
 *   1. a guide is only ever returned for an issue that BELONGS to the appliance,
 *      and never for an appliance alone (that was the old rail's bug);
 *   2. every published step stays safe — no opening units, no wiring, no
 *      refrigerant, no bypassing safety interlocks.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  NO_GUIDE_MESSAGE,
  TROUBLESHOOTING_DISCLAIMER,
  getTroubleshootingGuide,
} from "../../src/lib/troubleshooting.ts";
import { APPLIANCE_ISSUES, getApplianceIssues } from "../../src/lib/appliance-issues.ts";

/** The title of the final step every guide must end with. */
const STOP_AND_BOOK_TITLE = "If it is not fixed, stop there";

const allGuides = () => {
  const entries = [];
  for (const [applianceType, issues] of Object.entries(APPLIANCE_ISSUES)) {
    for (const issue of issues) {
      const guide = getTroubleshootingGuide(applianceType, issue.id);
      if (guide) entries.push({ applianceType, issueId: issue.id, guide });
    }
  }
  return entries;
};

test("selecting an appliance alone never produces guidance", () => {
  for (const applianceType of Object.keys(APPLIANCE_ISSUES)) {
    assert.equal(getTroubleshootingGuide(applianceType, null), null, applianceType);
    assert.equal(getTroubleshootingGuide(applianceType, ""), null, applianceType);
  }
});

test("an identified issue returns its guide", () => {
  const guide = getTroubleshootingGuide("Refrigerator", "not-cooling");
  assert.ok(guide && guide.length > 0);
  assert.ok(guide.some((step) => /setting|seal|vent/i.test(step.title + step.detail)));
});

test("an issue that belongs to another appliance returns nothing", () => {
  // "not-draining" is not in the refrigerator catalogue, so its washing-machine
  // instructions can never appear under a refrigerator.
  assert.equal(getTroubleshootingGuide("Refrigerator", "not-draining"), null);
  assert.equal(getTroubleshootingGuide("Washing Machine", "not-cooling"), null);
  assert.equal(getTroubleshootingGuide("Television", "not-heating"), null);
});

test("an unknown issue id returns nothing", () => {
  assert.equal(getTroubleshootingGuide("Refrigerator", "not-a-real-issue"), null);
});

test("appliance-specific guidance overrides the shared guide", () => {
  const fridge = getTroubleshootingGuide("Refrigerator", "not-cooling");
  const aircon = getTroubleshootingGuide("Air Conditioner", "not-cooling");
  assert.ok(fridge && aircon);
  assert.notDeepEqual(
    fridge.map((step) => step.title),
    aircon.map((step) => step.title)
  );
  assert.ok(
    aircon.some((step) => /filter/i.test(step.title)),
    "the air-conditioner guide should mention its filter"
  );
});

test("an issue with no guide is reported as having none (never invented)", () => {
  // `other` is the deliberate no-guide case: SPARKServ does not know the fault.
  assert.equal(getTroubleshootingGuide("Refrigerator", "other"), null);
  assert.equal(getTroubleshootingGuide("Washing Machine", "other"), null);
  assert.match(NO_GUIDE_MESSAGE, /No troubleshooting guide is available/i);
  assert.match(NO_GUIDE_MESSAGE, /continue with your repair request/i);
});

test("every guide is a numbered list of complete steps", () => {
  const entries = allGuides();
  assert.ok(entries.length > 20, `only ${entries.length} guides exist`);
  for (const { applianceType, issueId, guide } of entries) {
    for (const step of guide) {
      assert.ok(step.title?.trim(), `${applianceType}/${issueId} has a step without a title`);
      assert.ok(step.detail?.trim(), `${applianceType}/${issueId} has a step without a detail`);
    }
    assert.equal(
      guide[guide.length - 1].title,
      STOP_AND_BOOK_TITLE,
      `${applianceType}/${issueId} must end with the stop-and-book step`
    );
  }
});

test("no guide asks the customer to do anything unsafe", () => {
  const forbidden = [
    /open the (unit|panel|back|cover|cabinet|case|compressor)/i,
    /remove the (cover|panel|back|casing)/i,
    /exposed (wire|wiring|cable)/i,
    /refrigerant/i,
    /recharge the (gas|refrigerant)/i,
    /bypass/i,
    /rewire/i,
    /solder/i,
    /multimeter/i,
    /disconnect the (wire|wiring|compressor)/i,
    /touch the (wire|wiring|element)/i,
  ];

  // A WARNING is exactly what we want ("Do not open the unit"), so a match that
  // is negated in the text immediately before it is not a violation.
  const prohibition = /(do not|don't|never|no|avoid)\s+[a-z']*\s*$/i;

  for (const { applianceType, issueId, guide } of allGuides()) {
    for (const step of guide) {
      const text = `${step.title} ${step.detail}`;
      for (const pattern of forbidden) {
        const match = pattern.exec(text);
        if (!match) continue;
        const before = text.slice(Math.max(0, match.index - 32), match.index);
        assert.ok(
          prohibition.test(before),
          `${applianceType}/${issueId}: "${step.title}" tells the customer to do something unsafe (${pattern})`
        );
      }
    }
  }
});

test("the disclaimer frames the steps as optional checks, not a diagnosis", () => {
  assert.match(TROUBLESHOOTING_DISCLAIMER, /optional preliminary checks/i);
  assert.match(TROUBLESHOOTING_DISCLAIMER, /not a professional diagnosis/i);
  assert.match(TROUBLESHOOTING_DISCLAIMER, /skip/i);
});

test("every catalogue issue either has a guide or is explicitly the 'other' case", () => {
  for (const [applianceType, issues] of Object.entries(APPLIANCE_ISSUES)) {
    for (const issue of issues) {
      const guide = getTroubleshootingGuide(applianceType, issue.id);
      if (!guide) {
        assert.equal(
          issue.id,
          "other",
          `${applianceType}/${issue.id} has no guide and is not the deliberate no-guide case`
        );
      }
    }
  }
  // …and the no-guide case is genuinely covered for every appliance that has it.
  for (const [applianceType, issues] of Object.entries(APPLIANCE_ISSUES)) {
    if (getApplianceIssues(applianceType).some((issue) => issue.id === "other")) {
      assert.equal(getTroubleshootingGuide(applianceType, "other"), null, applianceType);
    }
  }
});
