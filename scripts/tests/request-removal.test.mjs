/**
 * Contract tests: removing a repair request.
 *
 *   npm run test:removal
 *
 * WHY THIS EXISTS. There was no way for a customer to get rid of a request that
 * never went anywhere (the appliance nobody covers, or one created by mistake),
 * and there could not be a client-side one: `service_requests` has no DELETE
 * policy, so the browser cannot remove the row at all. The delete therefore runs
 * on the service-role client in a route that re-does the authorization — and
 * that route must own the refusal list, because the delete CASCADES
 * (`estimates`, `bookings` and `technician_offer_history` all reference the
 * request `on delete cascade`, and a booking drags its messages, visits, rating
 * and payment with it). Deleting a request that carries a payment would destroy
 * a money record; deleting one a technician has accepted would erase somebody's
 * job. Those must be refused BEFORE the delete statement runs, which is what
 * this file pins.
 *
 * The route is a route handler (it imports `next/server`), so it is read as
 * text, like `test:booking-api` and `test:admin-payments` do.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const ROOT = new URL("../../", import.meta.url);
const source = (path) => readFileSync(new URL(path, ROOT), "utf8");

const ROUTE = "src/app/api/service-requests/[id]/route.ts";
const CONTROL = "src/components/RemoveRequestControl.tsx";
const NAV = "src/lib/navConfig.ts";
const DETAIL = "src/components/RequestDetailClient.tsx";
const TABLE = "src/components/RecentRepairTable.tsx";

test("removal runs on the service role, because no client delete path exists", () => {
  const route = source(ROUTE);
  const handler = route.slice(route.indexOf("export async function DELETE"));

  assert.ok(handler.length > 0, `${ROUTE} must export DELETE`);
  assert.match(handler, /createServiceRoleClient\(\)/);
  assert.match(
    handler,
    /serviceRole\s*\n\s*\.from\("service_requests"\)\s*\n\s*\.delete\(\)/,
    "the delete must go through the service-role client"
  );
  assert.doesNotMatch(
    handler,
    /const supabase = createClient\(\)[\s\S]*?\.delete\(\)/,
    "the session client cannot delete: there is no DELETE policy on service_requests"
  );
});

test("every refusal has its own code, so the UI can explain itself", () => {
  const route = source(ROUTE);
  for (const code of [
    "request_completed",
    "request_in_progress",
    "request_has_booking",
    "request_has_estimate",
  ]) {
    assert.match(route, new RegExp(`code: "${code}"`), `${code} must exist`);
  }
});

test("the checks run before the delete, so the cascade never gets the chance", () => {
  const handler = source(ROUTE).slice(source(ROUTE).indexOf("export async function DELETE"));
  const bookingCheck = handler.indexOf('from("bookings")');
  const estimateCheck = handler.indexOf('from("estimates")');
  const deleteCall = handler.indexOf(".delete()");

  assert.ok(bookingCheck > 0 && estimateCheck > 0 && deleteCall > 0);
  assert.ok(
    bookingCheck < deleteCall && estimateCheck < deleteCall,
    "an appointment or a prepared estimate must be checked BEFORE the row is deleted"
  );
});

test("somebody else's request answers like one that does not exist", () => {
  const route = source(ROUTE);
  assert.match(route, /!request \|\| request\.customer_id !== user\.id/);
  assert.match(route, /"Request not found" \}, \{ status: 404 \}/);
});

test("the control calls the endpoint and shows the server's reason", () => {
  const control = source(CONTROL);
  assert.match(control, /\/api\/service-requests\/\$\{requestId\}/);
  assert.match(control, /method: "DELETE"/);
  assert.match(control, /json\.error/);
});

test("both surfaces offer removal and hide it where the server would refuse", () => {
  for (const [what, file] of [
    ["the request page", DETAIL],
    ["the request list", TABLE],
  ]) {
    const src = source(file);
    assert.match(src, /RemoveRequestControl/, `${what} must render the control`);
    assert.match(src, /request\.status !== "completed"/, `${what} must hide it for a finished repair`);
    assert.match(
      src,
      /request\.assignment_status !== "accepted"/,
      `${what} must hide it once a technician has accepted`
    );
  }

  assert.match(
    source(DETAIL),
    /initialEstimates\.length === 0/,
    "the request page also hides it when a quote exists"
  );
});

test("the customer sidebar can reach the request list", () => {
  assert.match(
    source(NAV),
    /label: "Repair Requests", href: "\/customer\/repairs\/requests"/,
    "the sidebar had no entry for the request list at all"
  );
});
