/**
 * Contract test between `create_booking_atomic()` and the route that maps it.
 *
 *   npm run test:booking-api
 *
 * WHY THIS EXISTS. Step 17 added a new outcome (`technician_not_eligible`) to a
 * function whose caller is a `switch` in `src/app/api/bookings/route.ts`. When the
 * database and the deployed code disagree about that vocabulary the failure mode is
 * silent: an outcome the route has never heard of falls to its `default:` branch and
 * the customer gets a 500 instead of an explanation — or, in the other direction, a
 * refusal could be mistaken for a success.
 *
 * The suites that prove the *behaviour* live in `npm run test:queue-sql` (group 26).
 * This file proves the *wiring*: every outcome the function can return has a case in
 * the route, the only 201 is the `booked` case, and a refusal can never reach it.
 *
 * It reads both files as text, so it is deliberately a structural test: there is no
 * route runner in this repository (see TESTING.md §4), and a copy of the mapping in
 * the test would be a second thing to drift.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ROOT = new URL("../../", import.meta.url);
const source = (path) => readFileSync(new URL(path, ROOT), "utf8");

const ROUTE = "src/app/api/bookings/route.ts";
const BATCH_2_SQL = "supabase/migration_atomic_booking.sql";
const STEP_17_SQL = "supabase/migration_booking_eligibility.sql";
const QUEUE_SQL = "supabase/migration_queue_redesign.sql";

/** The body of one `create or replace function` declaration, up to its `$$;`. */
function functionBody(text, signature) {
  const start = text.indexOf(signature);
  if (start === -1) return null;
  const end = text.indexOf("$$;", start);
  return end === -1 ? text.slice(start) : text.slice(start, end);
}

function matches(text, pattern) {
  return [...text.matchAll(pattern)].map((match) => match[1]);
}

/** Every literal `'outcome', 'x'` in a function body. */
const outcomeLiterals = (body) => matches(body, /'outcome',\s*'([a-z_]+)'/g);

/** Every `case "x":` label in the route's outcome switch. */
const routeCases = (route) => new Set(matches(route, /case\s+"([a-z_]+)"\s*:/g));

const batch2Body = functionBody(
  source(BATCH_2_SQL),
  "create or replace function public.create_booking_atomic("
);
const step17Body = functionBody(
  source(STEP_17_SQL),
  "create or replace function public.create_booking_atomic("
);
const route = source(ROUTE);
const cases = routeCases(route);

test("both definitions of create_booking_atomic are found (the parse cannot silently pass)", () => {
  assert.ok(batch2Body, `${BATCH_2_SQL} must define create_booking_atomic`);
  assert.ok(step17Body, `${STEP_17_SQL} must re-declare create_booking_atomic`);
  assert.ok(cases.size >= 10, `expected the route's outcome switch, found ${cases.size} cases`);
});

test("the Batch 2 function cannot return technician_not_eligible, step 17 can", () => {
  // This is the deployment-order fact: applying step 17 under the Batch 2 route sends
  // the new outcome into a mapping that has no case for it.
  assert.ok(!batch2Body.includes("technician_not_eligible"));
  assert.ok(step17Body.includes("'outcome', 'technician_not_eligible'"));
});

test("every outcome create_booking_atomic can return has a case in the route", () => {
  // The capacity outcomes are returned verbatim from technician_capacity_failure(),
  // so they are read from that function rather than hard-coded here.
  const capacityBody = functionBody(
    source(QUEUE_SQL),
    "create or replace function public.technician_capacity_failure("
  );
  assert.ok(capacityBody, "technician_capacity_failure must be defined");
  const capacityOutcomes = matches(capacityBody, /return\s+'(capacity_[a-z_]+)'/g);
  assert.equal(capacityOutcomes.length, 3, "the capacity outcomes the function can pass through");

  const outcomes = [
    ...new Set([
      ...outcomeLiterals(batch2Body),
      ...outcomeLiterals(step17Body),
      ...capacityOutcomes,
    ]),
  ];

  assert.ok(outcomes.includes("booked"), "the success outcome must be in the set");
  assert.ok(outcomes.includes("technician_not_eligible"), "step 17's outcome must be in the set");

  for (const outcome of outcomes) {
    assert.ok(
      cases.has(outcome),
      `create_booking_atomic can return "${outcome}" and the route has no case for it — ` +
        "it would fall to the default branch (500) instead of an answer"
    );
  }
});

test("the route's only 201 is the booked outcome", () => {
  const occurrences = route.split("status: 201").length - 1;
  assert.equal(occurrences, 1, "exactly one success response exists in the route");

  const success = route.indexOf("status: 201");
  const bookedCase = route.indexOf('case "booked":');
  const nextCase = route.indexOf('case "already_booked":');
  assert.ok(bookedCase !== -1 && nextCase > bookedCase, "the booked case must exist and be bounded");
  assert.ok(
    success > bookedCase && success < nextCase,
    "the 201 must sit inside the booked case and nowhere else"
  );
});

test("the default branch answers 500 and can never answer 201", () => {
  const fallback = route.slice(route.indexOf("default:"));
  assert.match(fallback, /status: 500/);
  assert.ok(!fallback.includes("status: 201"));
  assert.ok(
    !/data:\s*outcome\.booking/.test(fallback),
    "the catch-all must not echo a booking payload"
  );
});

test("a refused booking is a 409 that names the appliance, and never a success", () => {
  const start = route.indexOf('case "technician_not_eligible"');
  const end = route.indexOf('case "invalid_schedule"');
  assert.ok(start !== -1 && end > start, "the technician_not_eligible case must exist");

  const block = route.slice(start, end);
  assert.match(block, /status: 409/, "the refusal is a conflict, not a success");
  assert.ok(!block.includes("status: 201"));
  assert.match(block, /No technician currently supports/, "the no-coverage message names the appliance");
  assert.match(block, /qualified_technician_available === false/, "coverage decides which message is shown");
  assert.match(block, /code: "technician_not_eligible"/);
});
