/**
 * Contract tests: the customer must be told the truth about their assignment.
 *
 *   npm run test:tracking
 *
 * WHY THIS EXISTS. Two defects, both about a page claiming something the
 * database disagrees with:
 *
 *   1. The dashboard's "Active repairs" tile pointed at
 *      `/customer/service-request`, which is a legacy alias that redirects to the
 *      NEW request wizard — so the tile opened a blank service-inquiry form
 *      instead of the customer's requests.
 *   2. An unassigned request for an appliance with NO qualified technician was
 *      presented as normal progress: the tracking strip said "Next up: technician
 *      assigned" and the request page said "waiting … it stays in line". Nothing
 *      is coming, and the only honest answer is "nobody covers this appliance
 *      yet — contact support". Coverage is computed once, at creation
 *      (`POST /api/service-requests`); nothing re-read it afterwards, so the
 *      customer who came back later — the one who most needed it — never saw it.
 *
 * The wording itself is already pinned by `test:queue-copy`; this file pins WHERE
 * that wording is used and that coverage is actually re-read on the server.
 * `src/lib/assignment-coverage.ts` imports `next/headers` through the Supabase
 * server client, so it cannot be loaded under Node's type stripping — the page
 * wiring is asserted from source, the same way `test:admin-payments` asserts its
 * route-segment facts.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ROOT = new URL("../../", import.meta.url);
const source = (path) => readFileSync(new URL(path, ROOT), "utf8");

const DASHBOARD = "src/app/customer/dashboard/page.tsx";
const TRACKING = "src/components/ServiceTracking.tsx";
const REQUEST_PAGE = "src/app/customer/service-request/[id]/page.tsx";
const REQUEST_LIST = "src/app/customer/repairs/requests/page.tsx";
const REQUEST_CLIENT = "src/components/RequestDetailClient.tsx";
const COVERAGE = "src/lib/assignment-coverage.ts";

// ------------------------------------- 1. the tile goes to the requests list

test("Active repairs links to the request list, not the new-request wizard", () => {
  const page = source(DASHBOARD);

  // Assert on the TILE's own href rather than "somewhere within N characters of the
  // label": a fixed window breaks every time a comment above it grows, which is a
  // false alarm about a link that is perfectly correct.
  const tile = page.indexOf('label: "Active repairs"');
  assert.ok(tile > 0, `${DASHBOARD} must still have the tile`);

  const hrefAt = page.indexOf("href:", tile);
  assert.ok(hrefAt > tile, "the tile must carry an href");
  const hrefLine = page.slice(hrefAt, page.indexOf("\n", hrefAt));

  assert.match(
    hrefLine,
    /\/customer\/repairs\/requests/,
    `${DASHBOARD} must send the tile to the customer's own requests`
  );
  assert.doesNotMatch(
    hrefLine,
    /service-request/,
    "`/customer/service-request` only redirects to the new-request wizard"
  );
});

test("that alias really is a redirect, which is why it was the wrong target", () => {
  assert.match(
    source("src/app/customer/service-request/page.tsx"),
    /redirect\("\/customer\/request-repair"\)/
  );
});

// ------------------------------------- 2. the strip can say "nobody covers it"

test("the tracking strip accepts a coverage answer", () => {
  const strip = source(TRACKING);
  assert.match(strip, /qualifiedTechnicianAvailable\?: boolean \| null/);
  assert.match(
    strip,
    /!request\.assigned_technician_id &&\s*\n\s*qualifiedTechnicianAvailable === false/,
    "the dead end is exactly: unassigned AND confirmed-uncovered"
  );
});

test("the dead end reuses the shared wording and offers a way out", () => {
  const strip = source(TRACKING);
  assert.match(
    strip,
    /customerAssignmentCopy\("waiting", \{ qualifiedTechnicianAvailable: false \}\)/,
    "one definition of the wording — not a second sentence written here"
  );
  assert.match(strip, /href="\/customer\/support"/, "the dead end must offer support");
  assert.match(strip, /\{deadEndCopy \? \(/, "it must replace the progress line, not sit beside it");
});

test("the normal line survives for a covered or unknown appliance", () => {
  const strip = source(TRACKING);
  assert.match(strip, /Next up: \$\{nextStep\.label\.toLowerCase\(\)\}\./);
});

// ------------------------------------- 3. coverage is re-read on the server

test("the coverage helper asks the same predicate the queue and booking use", () => {
  const helper = source(COVERAGE);
  assert.match(helper, /rpc\("appliance_has_qualified_technician"/);
  assert.match(
    helper,
    /return null/,
    "an answer that cannot be established is `null`, never a guess"
  );
  // A deployment without the service key must still render the page.
  assert.match(helper, /try \{\s*\n\s*serviceRole = createServiceRoleClient\(\);/);
});

test("the dashboard reads coverage only for an unassigned request and passes it down", () => {
  const page = source(DASHBOARD);
  assert.match(page, /import \{ applianceCoverage \} from "@\/lib\/assignment-coverage"/);
  // Asked only for a request that has NO rail of its own to carry the answer: an
  // unassigned request with nothing to track. A moving repair, and a finished one,
  // must not pay for the round trip.
  assert.match(
    page,
    /trackedRequest && !trackedHasProgress && !trackedRequest\.assigned_technician_id\s*\n\s*\? await applianceCoverage/
  );
  assert.match(page, /qualifiedTechnicianAvailable=\{trackedCoverage\}/);
});

test("the request page passes coverage through to the assignment card", () => {
  assert.match(
    source(REQUEST_PAGE),
    /request\.assigned_technician_id\s*\n?\s*\? null\s*\n?\s*: await applianceCoverage\(request\.appliance_type\)/
  );
  assert.match(source(REQUEST_PAGE), /qualifiedTechnicianAvailable=\{qualifiedTechnicianAvailable\}/);
  assert.match(source(REQUEST_CLIENT), /qualifiedTechnicianAvailable\?: boolean \| null/);
  assert.match(source(REQUEST_CLIENT), /qualifiedTechnicianAvailable=\{qualifiedTechnicianAvailable\}/);
});

// ------------------------- 4. the tile's number matches the list it opens

test("the Active repairs tile opens the very view it counts", () => {
  assert.match(source(DASHBOARD), /href: "\/customer\/repairs\/requests\?status=active"/);
  assert.match(
    source(DASHBOARD),
    /activeRequests = \(requests \?\? \[\]\)\.filter\(\(r\) => !isClosedRequestStatus\(r\.status\)\)/,
    "the count must use the shared rule, not a local string pair that can drift from the query"
  );
});

test("the list filters closed requests in SQL, in the page AND its count", () => {
  const list = source(REQUEST_LIST);
  assert.match(list, /import \{ CLOSED_REQUEST_STATUSES \} from "@\/lib\/estimate-costs"/);
  assert.match(list, /const onlyActive = searchParams\?\.status === "active"/);
  assert.equal(
    [...list.matchAll(/\.not\("status", "in", closedFilter\)/g)].length,
    2,
    "the page query and the count query must both carry the filter, or the pager lies"
  );
});

test("paging keeps the customer in the view they are in", () => {
  const list = source(REQUEST_LIST);
  assert.match(list, /const pageHref = \(target: number\) =>/);
  assert.match(list, /href=\{pageHref\(page - 1\)\}/);
  assert.match(list, /href=\{pageHref\(page \+ 1\)\}/);
});

// ------------------------- 5. the tracking rail only exists when there is progress

test("a finished request is never shown as being tracked", () => {
  const page = source(DASHBOARD);

  assert.match(page, /const trackedRequest = activeRequests\[0\] \?\? null;/);
  assert.doesNotMatch(
    page,
    /activeRequests\[0\] \?\? requests\?\.\[0\]/,
    "the fallback to the most recent request drew a seven-step rail for a closed job"
  );
});

test("the rail is drawn only once the repair has started moving", () => {
  const page = source(DASHBOARD);

  assert.match(
    page,
    /const trackedHasProgress = Boolean\(\s*\n\s*trackedRequest &&\s*\n\s*\(trackedRequest\.assignment_status === "accepted" \|\|\s*\n\s*trackedBookings\.length > 0 \|\|\s*\n\s*trackedEstimates\.some\(\(estimate\) => estimate\.status !== "draft"\)\)/
  );
  assert.match(
    page,
    /\{trackedHasProgress && trackedRequest && \(\s*\n\s*<DashboardPanel/,
    "the panel must be behind that condition, not rendered unconditionally"
  );
});

test("the dead end is still said out loud, as a notice instead of a rail", () => {
  const page = source(DASHBOARD);
  assert.match(
    page,
    /customerAssignmentCopy\("waiting", \{ qualifiedTechnicianAvailable: false \}\)/
  );
  assert.match(page, /\{coverageNotice && trackedRequest && \(/);
  assert.match(page, /href="\/customer\/support"/);
});

test("the dashboard does not promise progress 'below' when the rail is hidden", () => {
  assert.match(
    source(DASHBOARD),
    /trackedHasProgress \? " You can check your repair progress below\." : ""/
  );
});
