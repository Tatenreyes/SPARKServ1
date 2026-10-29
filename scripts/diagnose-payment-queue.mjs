#!/usr/bin/env node
/**
 * SPARKServ — READ-ONLY: the full payments picture behind `/admin/payments`.
 *
 * WHY THIS EXISTS. "The customer paid and the admin cannot see it" has two very
 * different causes, and they are told apart by comparing what a LIVE query returns
 * with what the page renders:
 *
 *   * the row is missing from the database (a submission problem), or
 *   * the row is in the database but the page is a stale snapshot (a rendering
 *     problem), which also shows up as rows sitting at an OLD status.
 *
 * It prints, in one pass:
 *   * every row in `public.payments`, with the GCash reference MASKED;
 *   * the booking each payment points at (status, cost, appliance, technician);
 *   * every booking that is `awaiting_payment` and whether it has a pending payment;
 *   * duplicate GCash references;
 *   * the row count the admin page's own query would return right now.
 *
 * SELECTs only. Nothing is inserted, updated, deleted, confirmed or rejected.
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

/** First 4 … last 4. Enough to correlate with a screenshot, not enough to reuse. */
function mask(reference) {
  const value = String(reference ?? "");
  if (value.length <= 8) return "*".repeat(value.length);
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(2);
}

const admin = createClient(url, key, { auth: { persistSession: false } });
console.log("SPARKServ — read-only payment-queue picture");
console.log("Project:", url);
console.log("");

// ---- the admin page's own query, live -------------------------------------------
const paymentsQuery = await admin
  .from("payments")
  .select("*")
  .order("created_at", { ascending: false });
console.log("-- the /admin/payments query, run live right now");
console.log("   error :", paymentsQuery.error ? JSON.stringify(paymentsQuery.error) : "none");
const payments = paymentsQuery.data ?? [];
console.log("   rows  :", payments.length);
console.log(
  "   statuses:",
  JSON.stringify(
    payments.reduce((acc, p) => ({ ...acc, [p.status]: (acc[p.status] ?? 0) + 1 }), {})
  )
);
console.log("");

// ---- supporting rows ------------------------------------------------------------
const userIds = [...new Set(payments.map((p) => p.customer_id))];
const bookingIds = [...new Set(payments.map((p) => p.booking_id))];

const users = userIds.length
  ? (await admin.from("users").select("id, name, role").in("id", userIds)).data ?? []
  : [];
const nameById = new Map(users.map((u) => [u.id, `${u.name} (${u.role})`]));

const bookings = bookingIds.length
  ? (
      await admin
        .from("bookings")
        .select("id, customer_id, technician_id, service_request_id, status, scheduled_at, final_cost")
        .in("id", bookingIds)
    ).data ?? []
  : [];
const bookingById = new Map(bookings.map((b) => [b.id, b]));

const requestIds = [...new Set(bookings.map((b) => b.service_request_id))];
const requests = requestIds.length
  ? (await admin.from("service_requests").select("id, appliance_type").in("id", requestIds)).data ?? []
  : [];
const applianceByRequest = new Map(requests.map((r) => [r.id, r.appliance_type]));

const technicianIds = [...new Set(bookings.map((b) => b.technician_id))];
const technicians = technicianIds.length
  ? (await admin.from("users").select("id, name").in("id", technicianIds)).data ?? []
  : [];
const technicianById = new Map(technicians.map((t) => [t.id, t.name]));

// ---- every payment, with the booking it belongs to ------------------------------
console.log("-- every payment row (reference masked), newest first");
for (const p of payments) {
  const b = bookingById.get(p.booking_id);
  const appliance = b ? applianceByRequest.get(b.service_request_id) ?? "?" : "(booking missing)";
  console.log(
    `   - ${p.status.padEnd(20)} amount=${String(p.amount).padStart(8)} ref=${mask(p.gcash_reference)} created=${p.created_at}`
  );
  console.log(
    `       confirmed_at=${p.confirmed_at ?? "-"} rejected_at=${p.rejected_at ?? "-"}`
  );
  console.log(
    `       customer=${nameById.get(p.customer_id) ?? p.customer_id} booking=${p.booking_id}`
  );
  if (b) {
    console.log(
      `       booking status=${b.status} appliance=${appliance} final_cost=${b.final_cost} ` +
        `scheduled=${b.scheduled_at} technician=${technicianById.get(b.technician_id) ?? "?"}`
    );
  }
}
console.log("");

// ---- the rows a live admin page WOULD show --------------------------------------
console.log("-- payments the admin page's query returns RIGHT NOW, newest first");
for (const p of payments) {
  console.log(
    `   ${p.status.padEnd(20)} amount=${String(p.amount).padStart(8)} ref=${mask(p.gcash_reference)}`
  );
}
console.log("");

// ---- bookings still waiting for money -------------------------------------------
console.log("-- bookings at `awaiting_payment` (the repairs that owe money)");
const awaiting = await admin
  .from("bookings")
  .select("id, customer_id, technician_id, service_request_id, status, scheduled_at, final_cost")
  .eq("status", "awaiting_payment");
console.log("   error :", awaiting.error ? JSON.stringify(awaiting.error) : "none");

const awaitingRows = awaiting.data ?? [];
const awaitingRequestIds = [...new Set(awaitingRows.map((b) => b.service_request_id))];
const awaitingRequests = awaitingRequestIds.length
  ? (
      await admin
        .from("service_requests")
        .select("id, appliance_type")
        .in("id", awaitingRequestIds)
    ).data ?? []
  : [];
const awaitingAppliance = new Map(awaitingRequests.map((r) => [r.id, r.appliance_type]));

const awaitingCustomerIds = [...new Set(awaitingRows.map((b) => b.customer_id))];
const awaitingCustomers = awaitingCustomerIds.length
  ? (await admin.from("users").select("id, name").in("id", awaitingCustomerIds)).data ?? []
  : [];
const awaitingName = new Map(awaitingCustomers.map((u) => [u.id, u.name]));

for (const b of awaitingRows) {
  const onThisBooking = payments.filter((p) => p.booking_id === b.id);
  const pending = onThisBooking.filter((p) => p.status === "pending_verification");
  console.log(
    `   - booking=${b.id} customer=${awaitingName.get(b.customer_id) ?? b.customer_id} ` +
      `appliance=${awaitingAppliance.get(b.service_request_id) ?? "?"} ` +
      `final_cost=${b.final_cost} scheduled=${b.scheduled_at}`
  );
  console.log(
    `       payments on this booking: ${onThisBooking.length} (pending_verification: ${pending.length})` +
      (pending.length ? ` ref=${mask(pending[0].gcash_reference)}` : "")
  );
  if (onThisBooking.length && pending.length === 0) {
    console.log(
      `       !! a booking that owes money has NO pending row — statuses: ` +
        JSON.stringify(onThisBooking.map((p) => p.status))
    );
  }
  if (pending.length === 0 && onThisBooking.length === 0) {
    console.log("       !! a booking that owes money has NO payment row at all");
  }
}
console.log("");

// ---- duplicate references -------------------------------------------------------
const byReference = new Map();
for (const p of payments) {
  const list = byReference.get(p.gcash_reference) ?? [];
  list.push(p);
  byReference.set(p.gcash_reference, list);
}
const duplicates = [...byReference.values()].filter((list) => list.length > 1);
console.log("-- duplicate GCash references");
console.log(
  "   (the submission-time duplicate check is RLS-scoped, so it cannot see another"
);
console.log("    customer's row — a reference another customer already used is accepted)");
if (!duplicates.length) console.log("   (none)");
for (const list of duplicates) {
  console.log(`   ref=${mask(list[0].gcash_reference)} appears ${list.length} times:`);
  for (const p of list) {
    console.log(
      `     - ${p.status.padEnd(20)} amount=${String(p.amount).padStart(8)} booking=${p.booking_id}`
    );
  }
}
