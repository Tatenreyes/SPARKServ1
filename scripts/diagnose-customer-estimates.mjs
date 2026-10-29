#!/usr/bin/env node
/**
 * SPARKServ — READ-ONLY: what `/customer/estimates` would render, per request.
 *
 * WHY THIS EXISTS. `EstimatesClient` picks a "current" version per request, and
 * `EstimateReviewCard` decides what to offer from THE ESTIMATE'S OWN STATUS ALONE
 * (`isBookableEstimate` = accepted && !superseded_by). Neither of them is told
 * whether the repair behind that estimate was already booked, is under way, or is
 * finished — so an approved estimate on a COMPLETED repair still satisfies
 * `bookable`, and if the assignment is still `accepted` it also satisfies
 * `canSchedule`, which renders the "Choose an appointment time / Confirm booking"
 * form for a repair that was already completed.
 *
 * This script reproduces that decision for every request so the mismatch is visible
 * as data rather than argued about. SELECTs only.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  const file = path.join(repoRoot, ".env.local");
  const env = { ...process.env };
  if (!fs.existsSync(file)) return env;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const value = match[2].trim().replace(/^["']|["']$/g, "");
    if (!env[match[1]]) env[match[1]] = value;
  }
  return env;
}

/** Mirrors `isOpenEstimateStatus` in src/lib/estimate-costs.ts. */
const isOpenEstimateStatus = (status) =>
  status === "draft" || status === "pending" || status === "revision_requested";

/** Mirrors `isBookableEstimate` in src/lib/estimate-costs.ts. */
const isBookableEstimate = (estimate) =>
  estimate.status === "accepted" && !estimate.superseded_by;

/** Mirrors `canBookFromRequest` in src/lib/estimate-costs.ts. */
const canBookFromRequest = (status) =>
  status === undefined || status === null || status === "quoted";

/** Mirrors `isClosedRequestStatus` in src/lib/estimate-costs.ts. */
const isClosedRequestStatus = (status) => status === "completed" || status === "cancelled";

/** Mirrors `isCompletedRequestStatus` in src/lib/estimate-costs.ts. */
const isCompletedRequestStatus = (status) => status === "completed";

const env = loadEnv();
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

console.log("SPARKServ — read-only: what /customer/estimates renders per request");
console.log("Project:", env.NEXT_PUBLIC_SUPABASE_URL);
console.log("");

const requests = (await admin
  .from("service_requests")
  .select("id, customer_id, appliance_type, status, assignment_status, created_at")
  .order("created_at", { ascending: false })).data ?? [];

const estimates = (await admin
  .from("estimates")
  .select("id, service_request_id, version, status, estimated_cost, superseded_by, created_at")
  .order("created_at", { ascending: false })).data ?? [];

const bookings = (await admin
  .from("bookings")
  .select("id, service_request_id, status, final_cost, scheduled_at")).data ?? [];

const userIds = [...new Set(requests.map((r) => r.customer_id))];
const users = userIds.length
  ? (await admin.from("users").select("id, name").in("id", userIds)).data ?? []
  : [];
const nameById = new Map(users.map((u) => [u.id, u.name]));

let suspicious = 0;

for (const request of requests) {
  const mine = estimates.filter((e) => e.service_request_id === request.id);
  if (!mine.length) continue;

  const myBookings = bookings.filter((b) => b.service_request_id === request.id);
  const closed = request.status === "completed" || request.status === "cancelled";

  // What EstimatesClient picks as `current`.
  const current =
    mine.find((e) => isOpenEstimateStatus(e.status)) ??
    mine.find((e) => e.status === "accepted") ??
    mine[0];

  const bookable = isBookableEstimate(current);
  // The FIXED rule: the request's lifecycle is part of the decision, so an approved
  // estimate on a repair that is already booked, under way, finished or cancelled no
  // longer renders the booking form.
  const canSchedule =
    bookable && request.assignment_status === "accepted" && canBookFromRequest(request.status);

  console.log(`request ${request.id}`);
  console.log(
    `   customer=${nameById.get(request.customer_id) ?? request.customer_id} ` +
      `appliance=${request.appliance_type} request.status=${request.status} ` +
      `assignment_status=${request.assignment_status}`
  );
  console.log(
    `   bookings: ${
      myBookings.length
        ? myBookings.map((b) => `${b.status}(${b.scheduled_at ?? "-"})`).join(", ")
        : "none"
    }`
  );
  console.log(
    `   estimates: ${mine
      .map((e) => `v${e.version}:${e.status}${e.superseded_by ? "/superseded" : ""}`)
      .join(", ")}`
  );
  console.log(
    `   EstimatesClient picks v${current.version} (${current.status}) -> ` +
      `bookable=${bookable} canSchedule=${canSchedule} ` +
      `shown on "${
        isCompletedRequestStatus(request.status) ? "Service history" : "Estimates"
      }"`
  );

  if (canSchedule && closed) {
    suspicious += 1;
    console.log(
      `   !! MISMATCH: the request is ${request.status}, yet the card renders the ` +
        `"Choose an appointment time / Confirm booking" form`
    );
  }
  if (canSchedule && myBookings.some((b) => b.status !== "cancelled")) {
    suspicious += 1;
    console.log(
      `   !! MISMATCH: a live booking already exists, yet the card renders the booking form`
    );
  }
  console.log("");
}

console.log(`requests with a rendered-booking-form mismatch: ${suspicious}`);
console.log("");

// ---- what Service history will show for each finished repair --------------------
// The other half of the move: the estimate leaves /customer/estimates and has to be
// resolvable from service_history, which archives the BOOKING and not the quote.
console.log("-- Service history: the approved estimate behind each finished repair");
const historyRows =
  (await admin
    .from("service_history")
    .select("id, booking_id, customer_id, appliance_type, final_cost, completed_at")).data ?? [];

const historyBookingIds = [...new Set(historyRows.map((row) => row.booking_id))];
const historyBookings = historyBookingIds.length
  ? (await admin
      .from("bookings")
      .select("id, service_request_id, estimate_id")
      .in("id", historyBookingIds)).data ?? []
  : [];
const historyBookingById = new Map(historyBookings.map((booking) => [booking.id, booking]));

const historyRequestIds = [...new Set(historyBookings.map((booking) => booking.service_request_id))];
const historyEstimates = historyRequestIds.length
  ? (await admin
      .from("estimates")
      .select("*")
      .in("service_request_id", historyRequestIds)).data ?? []
  : [];

let resolved = 0;
for (const row of historyRows) {
  const booking = historyBookingById.get(row.booking_id);
  const mine = booking
    ? historyEstimates.filter((estimate) => estimate.service_request_id === booking.service_request_id)
    : [];
  const estimate =
    (booking && mine.find((entry) => entry.id === booking.estimate_id)) ??
    mine.find((entry) => entry.status === "accepted" && !entry.superseded_by) ??
    null;

  if (estimate) resolved += 1;
  console.log(
    `   - ${row.appliance_type} completed ${String(row.completed_at).slice(0, 10)} ` +
      `final_cost=${row.final_cost} -> ` +
      (estimate
        ? `approved estimate v${estimate.version} amount=${estimate.estimated_cost}`
        : "no approved estimate (the card shows the final cost alone)")
  );
}
console.log(`   ${resolved}/${historyRows.length} finished repairs carry an approved estimate`);

