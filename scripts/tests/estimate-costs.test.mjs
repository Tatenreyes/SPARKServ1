/**
 * Unit tests for the estimate money rules and status vocabulary.
 *
 *   npm run test:estimates
 *
 * These run the REAL module (`src/lib/estimate-costs.ts`) — Node 24 strips the
 * TypeScript types, so there is no build step and no second copy of the rules to
 * drift. This module is imported by BOTH the technician's form (live total) and
 * the API route (validation before the database function sees the input), which
 * is why its behaviour is worth pinning down: if it drifts, the number on the
 * button stops being the number that gets stored.
 *
 * The database enforces the same sum a third time (`estimates_amounts_check`);
 * that side is covered by `npm run test:queue-sql` (group 19).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  MAX_MONEY_AMOUNT,
  canBookFromRequest,
  computeEstimateTotal,
  estimateStatusLabel,
  formatMoney,
  isBookableEstimate,
  isClosedRequestStatus,
  isCompletedRequestStatus,
  isOpenEstimateStatus,
  parseMoneyInput,
  roundMoney,
  validateEstimate,
} from "../../src/lib/estimate-costs.ts";

const ROOT = new URL("../../", import.meta.url);
const source = (path) => readFileSync(new URL(path, ROOT), "utf8");

// ------------------------------------------------------------------ rounding

test("money rounds to the currency's minor unit", () => {
  assert.equal(roundMoney(1.005), 1.01);
  assert.equal(roundMoney(1.004), 1);
  assert.equal(roundMoney(0.1 + 0.2), 0.3);
  assert.equal(roundMoney(Number.NaN), 0);
});

// ------------------------------------------------------------------- parsing

test("empty fields mean zero, not an error", () => {
  assert.equal(parseMoneyInput(""), 0);
  assert.equal(parseMoneyInput("   "), 0);
  assert.equal(parseMoneyInput(0), 0);
});

test("valid amounts parse and are rounded", () => {
  assert.equal(parseMoneyInput("450"), 450);
  assert.equal(parseMoneyInput("450.5"), 450.5);
  assert.equal(parseMoneyInput("1200"), 1200);
  assert.equal(parseMoneyInput(1200.456), 1200.46);
});

test("invalid amounts are rejected rather than silently coerced", () => {
  assert.equal(parseMoneyInput("abc"), null);
  assert.equal(parseMoneyInput(Number.NaN), null);
  assert.equal(parseMoneyInput(Number.POSITIVE_INFINITY), null);
  assert.equal(parseMoneyInput(-1), null);
  assert.equal(parseMoneyInput("-0.01"), null);
  assert.equal(parseMoneyInput(MAX_MONEY_AMOUNT + 0.01), null);
  assert.equal(parseMoneyInput(null), null);
  assert.equal(parseMoneyInput({}), null);
});

// --------------------------------------------------------------------- total

test("the total is the sum of the itemized lines", () => {
  assert.equal(computeEstimateTotal({ labor: 450, parts: 250, other: 100 }), 800);
  assert.equal(computeEstimateTotal({ labor: 500 }), 500);
  assert.equal(computeEstimateTotal({}), 0);
});

test("a repair that needs no parts is a normal estimate", () => {
  const result = validateEstimate({
    scope: "Clean and re-gas the unit",
    labor: 800,
    parts: 0,
    other: 0,
  });
  assert.equal(result.ok, true);
  assert.equal(result.total, 800);
  assert.deepEqual(result.amounts, { labor: 800, parts: 0, other: 0 });
});

test("rounding is consistent across the lines and the total", () => {
  // The values are chosen so that the binary float sits just BELOW the midpoint:
  // 111.115 * 100 is 11111.499999999998, which naive rounding would take down to
  // 111.11. Rounding through the decimal string keeps it half-up.
  const result = validateEstimate({
    scope: "Replace the door seal",
    labor: 333.335,
    parts: 111.115,
    other: 55.55,
    otherDescription: "Transport",
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.amounts, { labor: 333.34, parts: 111.12, other: 55.55 });
  assert.equal(result.total, 500.01);
  assert.equal(
    result.total,
    roundMoney(result.amounts.labor + result.amounts.parts + result.amounts.other)
  );
});


// ---------------------------------------------------------------- validation

test("a scope is required — a price with no described work cannot be approved", () => {
  const result = validateEstimate({ scope: "   ", labor: 500, parts: 0, other: 0 });
  assert.equal(result.ok, false);
  assert.equal(result.code, "scope_required");
});

test("invalid money is reported per field", () => {
  assert.equal(
    validateEstimate({ scope: "s", labor: "x", parts: 0, other: 0 }).code,
    "labor_invalid"
  );
  assert.equal(
    validateEstimate({ scope: "s", labor: 0, parts: -5, other: 0 }).code,
    "parts_invalid"
  );
  assert.equal(
    validateEstimate({ scope: "s", labor: 0, parts: 0, other: "nope" }).code,
    "other_invalid"
  );
});

test("an additional charge must be described", () => {
  const missing = validateEstimate({ scope: "s", labor: 100, parts: 0, other: 50 });
  assert.equal(missing.ok, false);
  assert.equal(missing.code, "other_description_required");

  const described = validateEstimate({
    scope: "s",
    labor: 100,
    parts: 0,
    other: 50,
    otherDescription: "Transport",
  });
  assert.equal(described.ok, true);
  assert.equal(described.total, 150);
});

test("a zero total is refused, so no empty quote can be sent for approval", () => {
  const result = validateEstimate({ scope: "s", labor: 0, parts: 0, other: 0 });
  assert.equal(result.ok, false);
  assert.equal(result.code, "total_not_positive");
});

// -------------------------------------------------------- status vocabulary

test("every estimate status has a readable label", () => {
  assert.equal(estimateStatusLabel("draft"), "Draft — not sent");
  assert.equal(estimateStatusLabel("pending"), "Awaiting customer decision");
  assert.equal(estimateStatusLabel("revision_requested"), "Revision requested");
  assert.equal(estimateStatusLabel("accepted"), "Approved");
  assert.equal(estimateStatusLabel("rejected"), "Declined");
  assert.equal(estimateStatusLabel("superseded"), "Superseded by a newer version");
});

test("only drafts, undecided and revision-requested versions are 'open'", () => {
  assert.equal(isOpenEstimateStatus("draft"), true);
  assert.equal(isOpenEstimateStatus("pending"), true);
  assert.equal(isOpenEstimateStatus("revision_requested"), true);
  assert.equal(isOpenEstimateStatus("accepted"), false);
  assert.equal(isOpenEstimateStatus("rejected"), false);
  assert.equal(isOpenEstimateStatus("superseded"), false);
});

test("only the CURRENT approval is bookable", () => {
  assert.equal(isBookableEstimate({ status: "accepted", superseded_by: null }), true);
  assert.equal(isBookableEstimate({ status: "accepted", superseded_by: "newer-id" }), false);
  assert.equal(isBookableEstimate({ status: "pending", superseded_by: null }), false);
  assert.equal(isBookableEstimate({ status: "rejected", superseded_by: null }), false);
});

test("money is formatted the same way everywhere", () => {
  assert.equal(formatMoney(800), "₱800.00");
  assert.equal(formatMoney(1234.5), "₱1,234.50");
  assert.equal(formatMoney(0), "₱0.00");
  assert.equal(formatMoney(null), "₱0.00");
});

// ------------------------------------------- a booking needs a request that can take one

test("an appointment may only be booked from a request that is still quoted", () => {
  assert.equal(canBookFromRequest("quoted"), true);
  // A caller that does not supply the status is left alone — the server decides.
  assert.equal(canBookFromRequest(undefined), true);
  assert.equal(canBookFromRequest(null), true);

  // Everything else already has an appointment or has closed the request.
  assert.equal(canBookFromRequest("booked"), false);
  assert.equal(canBookFromRequest("in_progress"), false);
  assert.equal(canBookFromRequest("completed"), false);
  assert.equal(canBookFromRequest("cancelled"), false);
  assert.equal(canBookFromRequest("open"), false);
});

test("only completed and cancelled requests count as closed", () => {
  assert.equal(isClosedRequestStatus("completed"), true);
  assert.equal(isClosedRequestStatus("cancelled"), true);
  assert.equal(isClosedRequestStatus("quoted"), false);
  assert.equal(isClosedRequestStatus("booked"), false);
  assert.equal(isClosedRequestStatus("in_progress"), false);
  assert.equal(isClosedRequestStatus("open"), false);
  assert.equal(isClosedRequestStatus(undefined), false);
});

test("an approved estimate on a finished repair is never offered a booking step", () => {
  // The regression, in one line: the card used to decide from the ESTIMATE's status
  // alone, so an approved estimate on a COMPLETED repair still rendered
  // "Choose an appointment time / Confirm booking".
  const approved = { status: "accepted", superseded_by: null };
  assert.equal(isBookableEstimate(approved), true, "the approval itself is still valid");
  assert.equal(canBookFromRequest("completed"), false, "but the repair is over");
  assert.equal(canBookFromRequest("booked"), false, "and a live appointment already exists");
  assert.equal(canBookFromRequest("in_progress"), false, "and the work is under way");
});

// ------------------------------------------------- the wiring, not just the rule

test("the card gates its booking step on the REQUEST, not only the estimate", () => {
  const card = source("src/components/EstimateReviewCard.tsx");

  assert.match(card, /canBookFromRequest\(requestStatus\)/, "the booking step must consult the request");
  assert.match(card, /isClosedRequestStatus\(requestStatus\)/, "and must know when the repair is over");
});

test("the estimates page carries the request's status into the card", () => {
  const client = source("src/components/EstimatesClient.tsx");
  const page = source("src/app/customer/estimates/page.tsx");

  assert.match(client, /status: string;/, "RequestInfo must declare the request status");

  // The card reads `request.status`, and on this page `request` IS the RequestInfo
  // built from the query — so the field has to be SELECTED as well as declared.
  const selected = /select\("([^"]+)"\)/.exec(page)?.[1] ?? "";
  assert.ok(
    selected.split(",").map((field) => field.trim()).includes("status"),
    `the estimates page must SELECT the request status, got: "${selected}"`
  );
});

test("the request page passes the request's status to the card", () => {
  assert.match(
    source("src/components/RequestDetailClient.tsx"),
    /status: request\.status,/,
    "RequestDetailClient must pass the request status to EstimateReviewCard"
  );
});

// ------------------------------- a finished repair's estimate changes pages

test("only a COMPLETED request counts as finished", () => {
  assert.equal(isCompletedRequestStatus("completed"), true);
  // A cancelled request keeps its estimate: nothing was repaired, so Service history
  // has no row to carry the quote.
  assert.equal(isCompletedRequestStatus("cancelled"), false);
  assert.equal(isCompletedRequestStatus("quoted"), false);
  assert.equal(isCompletedRequestStatus("booked"), false);
  assert.equal(isCompletedRequestStatus("in_progress"), false);
  assert.equal(isCompletedRequestStatus("open"), false);
  assert.equal(isCompletedRequestStatus(undefined), false);
});

test("a finished repair's estimate leaves the estimates page for service history", () => {
  const client = source("src/components/EstimatesClient.tsx");
  const history = source("src/app/customer/repair-history/page.tsx");

  assert.match(
    client,
    /!isCompletedRequestStatus\(requestInfo\[requestId\]\?\.status\)/,
    "the estimates page must drop estimates whose repair is complete"
  );
  assert.match(
    history,
    /ApprovedEstimate/,
    "service history must show the approved estimate instead of losing it"
  );
  // `service_history` archives the booking, not the quote, so the page has to walk
  // booking → request → the version the appointment was created from.
  assert.match(history, /estimate_id/, "service history must resolve the estimate via the booking");
});
