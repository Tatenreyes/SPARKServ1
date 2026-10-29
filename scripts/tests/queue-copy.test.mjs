/**
 * Contract test: the customer-facing wording for an assignment state.
 *
 *   npm run test:queue-copy
 *
 * WHY THIS EXISTS. `waiting` is reached TWO ways — every qualified technician is
 * booked or at capacity for the slot, OR no approved technician covers the appliance
 * type at all. A technician who is not approved never enters the rotation
 * (`technician_eligibility_failure()` answers `not_available` for them, and
 * `not_in_queue` when they have no ACTIVE row in `technician_queue_state`), so a
 * request for an appliance nobody approved covers sits at `waiting` for ever.
 *
 * The customer page cannot tell those two apart, so its copy must not assert either
 * one. It used to say "Every qualified technician is booked or at capacity for that
 * slot" — a false reassurance. The live project had exactly that: Vacuum Cleaner,
 * Microwave Oven and Television requests at `waiting` with ZERO approved technicians
 * covering them.
 *
 * It runs the REAL module (`src/lib/queue.ts`). That module imports only types, so
 * Node's type stripping loads it with no build step and no second copy of the wording
 * to drift.
 */
import test from "node:test";
import assert from "node:assert/strict";

import { customerAssignmentCopy } from "../../src/lib/queue.ts";

const STATES = ["matching", "offered", "waiting", "accepted", "something-unheard-of"];

test("every assignment state has a title and a body", () => {
  for (const status of STATES) {
    const copy = customerAssignmentCopy(status);
    assert.ok(copy.title?.trim(), `${status} needs a title`);
    assert.ok(copy.body?.trim(), `${status} needs a body`);
  }
});

test("the waiting copy does not claim a cause the page cannot know", () => {
  const text = customerAssignmentCopy("waiting").body.toLowerCase();

  assert.doesNotMatch(
    text,
    /every qualified technician/,
    "no page can know that EVERY qualified technician is busy"
  );
  assert.doesNotMatch(
    text,
    /at capacity for that slot/,
    "it may not be capacity at all — the appliance may not be covered yet"
  );
});

test("the waiting copy still promises the request keeps its place", () => {
  const text = customerAssignmentCopy("waiting").body.toLowerCase();

  assert.match(text, /stays in line/);
  assert.match(text, /match you/);
});

test("the waiting copy offers somewhere to go", () => {
  // `waiting` is the one state that can last indefinitely, so it is the one that needs
  // an escape hatch rather than a promise.
  assert.match(customerAssignmentCopy("waiting").body.toLowerCase(), /support/);
});

test("the waiting copy names the real reason when nobody covers the appliance", () => {
  const covered = customerAssignmentCopy("waiting", { qualifiedTechnicianAvailable: true });
  const uncovered = customerAssignmentCopy("waiting", { qualifiedTechnicianAvailable: false });
  const unknown = customerAssignmentCopy("waiting", { qualifiedTechnicianAvailable: null });

  // At least one technician qualifies → it IS a queue, and the copy must not claim
  // otherwise.
  assert.match(covered.title.toLowerCase(), /waiting/);
  assert.doesNotMatch(covered.title.toLowerCase(), /no technician/);

  // Confirmed nobody qualifies → say so plainly, keep the reassurance that the request
  // is saved, and stop pretending there is a queue worth waiting in.
  assert.match(uncovered.title.toLowerCase(), /no technician covers/);
  assert.match(uncovered.body.toLowerCase(), /saved/);
  assert.match(uncovered.body.toLowerCase(), /support/);
  assert.doesNotMatch(uncovered.body.toLowerCase(), /stays in line/);

  // Unknown → the neutral wording. Never a guess.
  assert.equal(unknown.title, covered.title);
  assert.equal(unknown.body, covered.body);
});

test("no other state's copy changes when coverage is known", () => {
  for (const status of ["matching", "offered", "accepted", "something-unheard-of"]) {
    assert.deepEqual(
      customerAssignmentCopy(status, { qualifiedTechnicianAvailable: false }),
      customerAssignmentCopy(status),
      `${status} must not react to coverage`
    );
  }
});
