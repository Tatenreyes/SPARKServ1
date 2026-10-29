/**
 * Contract test: Messages is its own destination, not a door into Bookings.
 *
 *   npm run test:messages
 *
 * WHY THIS EXISTS. The Messages list used to link every conversation to the BOOKING
 * page, because the thread only existed at the bottom of it. Clicking a message in
 * Messages therefore landed on a page about paying, inspecting and rating a repair —
 * two sidebar destinations collapsed into one, and no way to read a message without
 * the job wrapped around it. The conversation now has a page of its own under
 * Messages, and this test keeps the wiring that way.
 *
 * It reads the files as text — there is no page runner in this repository (see
 * TESTING.md §4), and a copy of the routing in the test would be a second thing to
 * drift.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

const ROOT = new URL("../../", import.meta.url);
const source = (path) => readFileSync(new URL(path, ROOT), "utf8");
const has = (path) => existsSync(new URL(path, ROOT));

const CUSTOMER_LIST = "src/app/customer/messages/page.tsx";
const TECHNICIAN_LIST = "src/app/technician/messages/page.tsx";
const CUSTOMER_THREAD = "src/app/customer/messages/[bookingId]/page.tsx";
const TECHNICIAN_THREAD = "src/app/technician/messages/[bookingId]/page.tsx";

test("both Messages lists open the conversation, not the booking", () => {
  const customer = source(CUSTOMER_LIST);
  const technician = source(TECHNICIAN_LIST);

  assert.ok(
    customer.includes("href={`/customer/messages/${b.id}`}"),
    "the customer Messages list must open the conversation"
  );
  assert.ok(
    technician.includes("href={`/technician/messages/${b.id}`}"),
    "the technician Messages list must open the conversation"
  );

  // The old wiring: every row sent the reader into the booking/job workflow.
  assert.ok(
    !customer.includes("href={`/customer/bookings/"),
    "Messages must not link into Bookings"
  );
  assert.ok(
    !technician.includes("href={`/technician/bookings/"),
    "Messages must not link into Jobs"
  );
});

test("both conversation pages exist and render the shared thread", () => {
  for (const path of [CUSTOMER_THREAD, TECHNICIAN_THREAD]) {
    assert.ok(has(path), `${path} must exist`);

    const page = source(path);
    assert.match(page, /<MessageThread/, `${path} must render the conversation`);
    assert.match(
      page,
      /from "@\/components\/MessageThread"/,
      `${path} must use the shared thread, not a second copy of it`
    );
  }
});

test("a conversation page refuses anyone who is not a participant", () => {
  const customer = source(CUSTOMER_THREAD);
  const technician = source(TECHNICIAN_THREAD);

  // RLS already scopes the booking row; the explicit check is what stops a guessed URL
  // from rendering the page at all.
  assert.match(
    customer,
    /booking\.customer_id !== user!\.id/,
    "the customer page must check that the caller is the customer"
  );
  assert.match(customer, /notFound\(\)/, "and must 404 when it is not");
  assert.match(
    technician,
    /booking\.technician_id !== user!\.id/,
    "the technician page must check that the caller is the technician"
  );
  assert.match(technician, /notFound\(\)/, "and must 404 when it is not");
});

test("the booking and job pages do NOT carry the thread — they link to it", () => {
  // Messaging lives under Messages. Embedding the thread on the booking page put a
  // conversation inside a booking workflow, under a payment card and a rating card,
  // and duplicated a destination the sidebar already has.
  const customerBooking = source("src/app/customer/bookings/[id]/page.tsx");
  const technicianBooking = source("src/app/technician/bookings/[id]/page.tsx");

  assert.doesNotMatch(
    customerBooking,
    /<MessageThread/,
    "the customer's booking page must not render the thread"
  );
  assert.doesNotMatch(
    technicianBooking,
    /<MessageThread/,
    "the technician's job page must not render the thread"
  );

  // …and it must not fetch a conversation it no longer shows.
  assert.ok(
    !customerBooking.includes('from("messages")'),
    "the booking page must not query messages"
  );
  assert.ok(
    !technicianBooking.includes('from("messages")'),
    "the job page must not query messages"
  );

  // The way to the conversation, named after the counterparty on THIS booking.
  assert.ok(
    customerBooking.includes("href={`/customer/messages/${booking.id}`}"),
    "the booking page must link to the conversation"
  );
  assert.ok(
    technicianBooking.includes("href={`/technician/messages/${booking.id}`}"),
    "the job page must link to the conversation"
  );
  assert.match(
    customerBooking,
    /Message \{technicianUser\?\.name/,
    "the button must name the technician assigned to that booking"
  );
  assert.match(
    technicianBooking,
    /Message \{customerUser\?\.name/,
    "the button must name the customer"
  );
});

test("the thread is rendered only by the Messages conversation pages", () => {
  for (const path of [CUSTOMER_THREAD, TECHNICIAN_THREAD]) {
    assert.match(source(path), /<MessageThread/, `${path} must render the conversation`);
  }
});

test("the inbox is ordered by the last message, not by the appointment", () => {
  for (const path of [CUSTOMER_LIST, TECHNICIAN_LIST]) {
    const page = source(path);

    assert.match(page, /const conversations = /, `${path} must build an ordered list`);
    assert.match(page, /bAt\.localeCompare\(aAt\)/, `${path} must sort by the newest message`);
    assert.match(page, /conversations\.map\(/, `${path} must render the ordered list`);
  }
});
