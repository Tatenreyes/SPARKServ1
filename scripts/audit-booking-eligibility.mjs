#!/usr/bin/env node
/**
 * SPARKServ booking-eligibility audit  —  `npm run audit:bookings`
 * =========================================================
 * Answers one question against the REAL Supabase project in `.env.local`:
 * "which requests and bookings involve a technician who is not qualified for the
 *  appliance type they are attached to?"
 *
 * Why this exists: `migration_booking_eligibility.sql` (step 17) stops a booking being
 * written for an ineligible technician. It cannot tell you which requests were already
 * written that way before it is applied, and those rows must NOT be cleaned up by a
 * migration: whether a repair that is already booked is kept, re-assigned or cancelled
 * is a business decision about a real customer's appointment. This script names them so
 * the decision is made deliberately.
 *
 * READ-ONLY, BY CONSTRUCTION. Every statement is a `select` through the service-role
 * client; nothing is inserted, updated or deleted, and no state-changing function is
 * called. The qualification rule is re-implemented here ONLY because the function that
 * owns it (`technician_qualification_failure()`) does not exist until step 17 is applied;
 * it mirrors that function's checks exactly — account active, technician approved, not
 * suspended, and an ACTIVE membership of the request's appliance queue.
 *
 * Exit code 0 when nothing is found, 1 when there is something to look at, so it can be
 * used as a preflight for applying step 17.
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

const env = loadEnv();
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n" +
      "Copy .env.example to .env.local and fill them in."
  );
  process.exit(2);
}

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

/**
 * Mirrors public.normalize_appliance_type() (migration_queue_redesign.sql): lower,
 * trim, the documented aliases, then spaces/dashes to underscores.
 */
const ALIASES = {
  refrigerator: "refrigerator",
  fridge: "refrigerator",
  freezer_refrigerator: "refrigerator",
  aircon: "aircon",
  air_conditioner: "aircon",
  air_conditioning: "aircon",
  "air conditioner": "aircon",
  ac: "aircon",
  washing_machine: "washing_machine",
  "washing machine": "washing_machine",
  washer: "washing_machine",
  clothes_dryer: "clothes_dryer",
  "clothes dryer": "clothes_dryer",
  dryer: "clothes_dryer",
  tv: "tv",
  television: "tv",
  television_set: "tv",
  electric_fan: "electric_fan",
  "electric fan": "electric_fan",
  fan: "electric_fan",
  microwave: "microwave",
  microwave_oven: "microwave",
  "microwave oven": "microwave",
  rice_cooker: "rice_cooker",
  "rice cooker": "rice_cooker",
  electric_stove: "electric_stove",
  "electric stove": "electric_stove",
  stove: "electric_stove",
  induction_cooker: "induction_cooker",
  "induction cooker": "induction_cooker",
  water_dispenser: "water_dispenser",
  "water dispenser": "water_dispenser",
  electric_kettle: "electric_kettle",
  "electric kettle": "electric_kettle",
  kettle: "electric_kettle",
  vacuum_cleaner: "vacuum_cleaner",
  "vacuum cleaner": "vacuum_cleaner",
  vacuum: "vacuum_cleaner",
  water_heater: "water_heater",
  "water heater": "water_heater",
  heater: "water_heater",
};

function normalizeApplianceType(value) {
  const v = String(value ?? "").trim().toLowerCase();
  if (!v) return null;
  return ALIASES[v] ?? v.replace(/ /g, "_").replace(/-/g, "_");
}

/** Pages through a table so a large project cannot be silently truncated. */
async function readAll(table, columns) {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await admin
      .from(table)
      .select(columns)
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if ((data ?? []).length < pageSize) break;
  }
  return rows;
}

/** The step-17 qualification rule, in JavaScript, for a project where it is not installed. */
function qualificationFailure(technician, request) {
  if (!technician) return "not_available";
  if (!technician.user?.is_active) return "not_available";
  if (!technician.approved) return "not_available";
  if (technician.operational_status === "SUSPENDED") return "suspended";
  const type = normalizeApplianceType(request.appliance_type);
  const member = (technician.queue ?? []).some(
    (row) => row.appliance_type === type && row.is_active
  );
  return member ? null : "not_in_queue";
}

async function main() {
  console.log("SPARKServ booking-eligibility audit (read-only)");
  console.log(`Project: ${SUPABASE_URL}\n`);

  const [users, technicians, queues, requests, bookings] = await Promise.all([
    readAll("users", "id, name, role, is_active"),
    readAll("technicians", "id, approved, operational_status, specializations"),
    readAll("technician_queue_state", "technician_id, appliance_type, is_active, queue_position"),
    readAll(
      "service_requests",
      "id, customer_id, appliance_type, status, assignment_status, assigned_technician_id, created_at"
    ),
    readAll("bookings", "id, service_request_id, technician_id, status, scheduled_at"),
  ]);

  const usersById = new Map(users.map((u) => [u.id, u]));
  const requestsById = new Map(requests.map((r) => [r.id, r]));
  const techniciansById = new Map(
    technicians.map((t) => [
      t.id,
      {
        ...t,
        user: usersById.get(t.id) ?? null,
        queue: queues.filter((q) => q.technician_id === t.id),
      },
    ])
  );

  console.log(
    `${users.length} users, ${technicians.length} technicians, ${queues.length} queue memberships, ` +
      `${requests.length} service requests, ${bookings.length} bookings.\n`
  );

  // ---- 1. Bookings that already exist with an ineligible technician -------------
  const suspectBookings = [];
  for (const booking of bookings) {
    if (booking.status === "cancelled") continue;
    const request = requestsById.get(booking.service_request_id);
    if (!request) continue;
    const technician = techniciansById.get(booking.technician_id);
    const reason = qualificationFailure(technician, request);
    if (reason) {
      suspectBookings.push({
        bookingId: booking.id,
        bookingStatus: booking.status,
        scheduledAt: booking.scheduled_at,
        requestId: request.id,
        requestStatus: request.status,
        applianceType: normalizeApplianceType(request.appliance_type),
        technicianId: booking.technician_id,
        technicianName: technician?.user?.name ?? "(unknown)",
        reason,
      });
    }
  }

  // ---- 2. Requests that will be refused a booking once step 17 is applied -------
  const blockedRequests = [];
  for (const request of requests) {
    if (request.assignment_status !== "accepted") continue;
    if (!["quoted", "open"].includes(request.status)) continue;
    const technician = techniciansById.get(request.assigned_technician_id);
    const reason = qualificationFailure(technician, request);
    if (reason) {
      blockedRequests.push({
        requestId: request.id,
        createdAt: request.created_at,
        applianceType: normalizeApplianceType(request.appliance_type),
        technicianId: request.assigned_technician_id,
        technicianName: technician?.user?.name ?? "(unknown)",
        reason,
        somebodyElseCanTakeIt: technicians.some(
          (candidate) => qualificationFailure(techniciansById.get(candidate.id), request) === null
        ),
      });
    }
  }

  console.log("== 1. Live bookings whose technician is not qualified for the appliance ==");
  if (!suspectBookings.length) {
    console.log("   none.\n");
  } else {
    for (const row of suspectBookings) console.log(`   ${JSON.stringify(row)}`);
    console.log(
      `\n   ${suspectBookings.length} booking(s). Do NOT delete or rewrite these rows: each is a real\n` +
        "   appointment. Decide per case - keep it and let the assigned technician finish, or\n" +
        "   cancel it through the normal UI (which releases the slot and returns the request to\n" +
        "   `quoted` so a qualified technician can be assigned) - and record why.\n"
    );
  }

  console.log("== 2. Accepted requests that will be refused once step 17 is applied ==");
  if (!blockedRequests.length) {
    console.log("   none.\n");
  } else {
    for (const row of blockedRequests) console.log(`   ${JSON.stringify(row)}`);
    console.log(
      `\n   ${blockedRequests.length} request(s). Nothing is changed by the migration: the customer\n` +
        "   will be told the truth when they try to book. Handling: re-assign through the\n" +
        "   normal assignment flow (or ask support to), and prefer the requests where\n" +
        "   `somebodyElseCanTakeIt` is true.\n"
    );
  }

  const findings = suspectBookings.length + blockedRequests.length;
  console.log(findings === 0 ? "Nothing to look at." : `${findings} row(s) need a decision.`);
  // `process.exitCode`, not `process.exit()`: exiting while the HTTP client still holds
  // sockets trips a libuv assertion on Windows and turns a clean run into a non-zero
  // exit, which would make this unusable as a preflight gate.
  process.exitCode = findings === 0 ? 0 : 1;
}

main().catch((err) => {
  console.error(`\nAudit failed: ${err.message}`);
  process.exitCode = 2;
});

