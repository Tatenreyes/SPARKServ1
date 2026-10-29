/**
 * Unit tests for the multilingual issue matcher.
 *
 *   npm run test:issues
 *
 * These run the REAL modules (`src/lib/issue-matching.ts`,
 * `src/lib/appliance-issues.ts`) — Node 24 strips the TypeScript types, so there
 * is no build step and no duplicated copy of the mappings to drift.
 *
 * What is NOT covered here: the React form itself (see TESTING.md §3 for the
 * manual pass) and anything that needs the live database.
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  DISTINCTIVE_SINGLE_WORDS,
  ISSUE_PHRASE_MAPPINGS,
  MIN_PHRASE_TOKENS,
  PHRASE_INDEX,
  matchIssue,
  normalizeDescription,
} from "../../src/lib/issue-matching.ts";
import { APPLIANCE_ISSUES, allIssueIds, getApplianceIssues } from "../../src/lib/appliance-issues.ts";

const match = (applianceType, description) => matchIssue({ applianceType, description });

/** The matched issue id, or the result kind ("ambiguous" / "none"). */
function issueOf(applianceType, description) {
  const result = match(applianceType, description);
  return result.kind === "match" ? result.issueId : result.kind;
}

// ---------------------------------------------------------------- normalisation

test("normalisation: case, punctuation and repeated spaces are harmless", () => {
  assert.equal(normalizeDescription("  NOT   Cooling!! "), "not cooling");
  assert.equal(normalizeDescription("Not-Cooling."), "not cooling");
});

test("normalisation: apostrophes and accents are removed", () => {
  assert.equal(normalizeDescription("won't turn on"), "wont turn on");
  assert.equal(normalizeDescription("híndî lumalamig"), "hindi lumalamig");
});

test("normalisation: reviewed appliance abbreviations are expanded", () => {
  assert.equal(normalizeDescription("ref"), "refrigerator");
  assert.equal(normalizeDescription("aircon"), "air conditioner");
  assert.equal(normalizeDescription("my tv"), "my television");
});

test("normalisation: reviewed misspellings are corrected", () => {
  assert.equal(normalizeDescription("not coling"), "not cooling");
  assert.equal(normalizeDescription("not drainning"), "not draining");
});

test("normalisation: is pure — the customer's text is never rewritten", () => {
  const original = "Hindi   LUMALAMIG ang ref!!";
  const snapshot = String(original);
  normalizeDescription(original);
  match("Refrigerator", original);
  assert.equal(original, snapshot);
});

// ------------------------------------------- supported languages (the point of it)

test("English: 'not cooling' matches Refrigerator not cooling", () => {
  assert.equal(issueOf("Refrigerator", "My refrigerator is running but not cooling."), "not-cooling");
});

test("Tagalog: 'hindi lumalamig' matches Refrigerator not cooling", () => {
  assert.equal(issueOf("Refrigerator", "Hindi lumalamig ang ref kahit umaandar."), "not-cooling");
});

test("Bisaya: 'dili bugnaw' matches Refrigerator not cooling", () => {
  assert.equal(issueOf("Refrigerator", "Dili bugnaw ang ref bisan nagdagan."), "not-cooling");
});

test("Mixed: 'dili cooling' matches Refrigerator not cooling", () => {
  assert.equal(issueOf("Refrigerator", "Dili cooling ang ref bisan gaandar."), "not-cooling");
});

test("case and whitespace variations still match", () => {
  assert.equal(issueOf("Refrigerator", "   NOT    COOLING   "), "not-cooling");
});

test("Tagalog: washing machine not draining", () => {
  assert.equal(
    issueOf("Washing Machine", "Hindi naglalabas ng tubig ang washing machine."),
    "not-draining"
  );
});

test("Bisaya: washing machine not draining", () => {
  assert.equal(issueOf("Washing Machine", "Dili mogawas ang tubig sa washing machine."), "not-draining");
});

test("Mixed: 'hindi na drain' matches washing machine not draining", () => {
  assert.equal(issueOf("Washing Machine", "Hindi na drain ang washer ko."), "not-draining");
});

test("Air conditioner: weak airflow in Bisaya", () => {
  assert.equal(issueOf("Air Conditioner", "Hinay kaayo ang hangin sa aircon."), "weak-airflow");
});


// ------------------------------------------------------------ appliance scoping

test("an issue from another appliance is never returned", () => {
  // "not draining" is a washing-machine/dryer issue; a refrigerator has no such
  // issue, so nothing may be matched at all.
  assert.equal(issueOf("Refrigerator", "The refrigerator is not draining."), "none");
  assert.equal(issueOf("Washing Machine", "Hindi lumalamig ang washing machine."), "none");
  assert.equal(issueOf("Television", "dili motuyok ang drum"), "none");
});

test("the same phrase maps to the appliance's OWN issue", () => {
  // Identical Bisaya phrase, two appliances, two different canonical issues —
  // which is exactly why matching is scoped to the selected appliance.
  assert.equal(issueOf("Washing Machine", "dili mogawas ang tubig"), "not-draining");
  assert.equal(issueOf("Water Dispenser", "dili mogawas ang tubig"), "not-dispensing");
});

test("every match belongs to the selected appliance's issue list", () => {
  const descriptions = [
    "not cooling",
    "hindi lumalamig ang ref",
    "dili bugnaw ang ref",
    "not draining",
    "hindi naglalabas ng tubig",
    "dili mogawas ang tubig",
    "no sound",
    "walang tunog",
    "nagyeyelo ang aircon",
    "hinay ang hangin",
    "not heating",
    "dili moinit",
    "weak suction",
    "hindi umiikot",
  ];

  for (const applianceType of Object.keys(APPLIANCE_ISSUES)) {
    const ownIds = new Set(getApplianceIssues(applianceType).map((issue) => issue.id));
    for (const description of descriptions) {
      const result = match(applianceType, description);
      if (result.kind === "match") {
        assert.ok(
          ownIds.has(result.issueId),
          `${applianceType}: matched ${result.issueId} which is not one of its issues`
        );
      }
      if (result.kind === "ambiguous") {
        for (const candidate of result.candidates) {
          assert.ok(
            ownIds.has(candidate.issueId),
            `${applianceType}: ambiguous candidate ${candidate.issueId} is not one of its issues`
          );
        }
      }
    }
  }
});

test("an unknown appliance matches nothing", () => {
  assert.equal(issueOf("Microwave Toaster", "not cooling"), "none");
});

// ------------------------------------------- no guessing, no fabricated guidance

test("generic words never produce a match", () => {
  for (const description of [
    "may problema ang ref",
    "sira ang ref",
    "it's broken",
    "not working properly",
    "hindi gumagana",
    "please help",
    "saba", // also Bisaya for "banana" — deliberately not a phrase on its own
  ]) {
    assert.equal(
      issueOf("Refrigerator", description),
      "none",
      `unexpected match for "${description}"`
    );
  }
});

test("an unlisted Bisaya expression is not guessed", () => {
  assert.equal(issueOf("Refrigerator", "dili na mobugnaw jud kaayo ang among ref"), "none");
  assert.equal(issueOf("Washing Machine", "ang washer kay morag guba ang motor"), "none");
});

test("a negated phrase is not a match for the fault it negates", () => {
  assert.equal(issueOf("Washing Machine", "hindi tumutulo ang tubig"), "none");
  assert.equal(issueOf("Washing Machine", "not leaking"), "none");
  assert.equal(issueOf("Washing Machine", "hindi na tumutulo"), "none");
  // …while the positive statement still matches.
  assert.equal(issueOf("Washing Machine", "tumutulo ang tubig"), "leaking");
});

test("equally specific matches are reported as ambiguous, not chosen", () => {
  const result = match("Washing Machine", "not draining and not spinning");
  assert.equal(result.kind, "ambiguous");
  const ids = result.candidates.map((candidate) => candidate.issueId).sort();
  assert.deepEqual(ids, ["not-draining", "not-spinning"]);
});

test("a more specific phrase wins over a less specific one", () => {
  // "not cooling" (2 words) beats the distinctive single word "maingay"/"noisy".
  assert.equal(issueOf("Refrigerator", "maingay at hindi lumalamig ang ref"), "not-cooling");
});

test("the result describes only the match — never a rewritten description", () => {
  const result = match("Refrigerator", "Dili bugnaw ang ref bisan nagdagan.");
  assert.equal(result.kind, "match");
  assert.deepEqual(Object.keys(result).sort(), [
    "issueId",
    "kind",
    "language",
    "matchedPhrase",
    "score",
  ]);
});

test("empty and whitespace-only descriptions match nothing", () => {
  assert.equal(issueOf("Refrigerator", ""), "none");
  assert.equal(issueOf("Refrigerator", "    "), "none");

// --------------------------------------------------------- mapping maintainability

test("every mapped issue id exists in the catalogue", () => {
  const known = new Set(allIssueIds());
  for (const mapping of ISSUE_PHRASE_MAPPINGS) {
    assert.ok(known.has(mapping.issueId), `unknown issueId in mappings: ${mapping.issueId}`);
  }
});

test("every mapping carries at least one approved phrase", () => {
  for (const mapping of ISSUE_PHRASE_MAPPINGS) {
    const total =
      mapping.english.length + mapping.tagalog.length + mapping.bisaya.length + mapping.mixed.length;
    assert.ok(total > 0, `${mapping.issueId} has no phrases`);
  }
});

test("single-word phrases are only allowed when explicitly distinctive", () => {
  for (const mapping of ISSUE_PHRASE_MAPPINGS) {
    for (const phrase of [
      ...mapping.english,
      ...mapping.tagalog,
      ...mapping.bisaya,
      ...mapping.mixed,
    ]) {
      const normalized = normalizeDescription(phrase);
      const words = normalized.split(" ").filter(Boolean);
      if (words.length < MIN_PHRASE_TOKENS) {
        assert.ok(
          DISTINCTIVE_SINGLE_WORDS.includes(normalized),
          `"${phrase}" is a single generic word — add it to DISTINCTIVE_SINGLE_WORDS or make it a phrase`
        );
      }
    }
  }
});

test("the phrase index is built and usable", () => {
  assert.ok(PHRASE_INDEX.length > 50, `only ${PHRASE_INDEX.length} indexed phrases`);
  for (const entry of PHRASE_INDEX) {
    assert.ok(entry.tokens.length > 0);
    assert.ok(entry.regex instanceof RegExp);
  }
});

test("every appliance in the catalogue is reachable by matching", () => {
  for (const [applianceType, issues] of Object.entries(APPLIANCE_ISSUES)) {
    assert.ok(issues.length > 0, `${applianceType} has no issues`);
    for (const issue of issues) {
      assert.ok(issue.id && issue.label, `${applianceType} has an issue without id/label`);
    }
  }
});

});

test("'Other' is never inferred, for any appliance", () => {
  for (const applianceType of Object.keys(APPLIANCE_ISSUES)) {
    for (const description of ["other", "ibang problema", "something else", "not cooling"]) {
      const result = match(applianceType, description);
      if (result.kind === "match") assert.notEqual(result.issueId, "other");
    }
  }
});
