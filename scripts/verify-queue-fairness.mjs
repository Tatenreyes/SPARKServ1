#!/usr/bin/env node
/**
 * SPARKServ LIVE queue-fairness verification  —  `npm run verify:queue`
 * =====================================================================
 *
 * Runs the queue redesign's acceptance scenario (spec §22, §23, §24, §25, §26,
 * §28, §36, §38) against the REAL Supabase project in `.env.local`, using real
 * sign-ins, real JWTs, real RLS and the real Postgres functions.
 *
 * Why this exists alongside `scripts/test-queue-sql.mjs`:
 *
 *   test-queue-sql.mjs        exercises the SQL in an in-process WASM Postgres
 *                             with `auth.uid()` stubbed. It proves the *logic*.
 *   verify-queue-fairness.mjs (this file) proves the *deployed system*: PostgREST
 *                             exposure, GRANTs, RLS policies, JWT role claims and
 *                             the real `auth` schema.
 *
 * Safety properties:
 *
 *   * it REFUSES to run until the queue migration is applied (it checks for
 *     `technician_queue_state.queue_position` before touching anything);
 *   * every row it creates is scoped to a unique appliance type
 *     (`qa_queue_<runid>`) and a unique email prefix, so it can never collide
 *     with live queues, live technicians or real customers;
 *   * it cleans up after itself (users, requests, bookings, queue rows, audit
 *     rows). Pass `--keep` to leave the fixtures in place for inspection.
 *
 * What it does NOT prove: that the migration was pasted correctly, or anything
 * about UI rendering. Database semantics only.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KEEP = process.argv.includes("--keep");

/** Unique per run: isolates fixtures from live data and from parallel runs. */
const RUN = Date.now().toString(36);
const APPLIANCE = `qa_queue_${RUN}`;
const APPLIANCE_2 = `qa_queue2_${RUN}`;
const PASSWORD = `Sparkserv-${RUN}!`;
/** Matches the `queue_service_timezone` setting the migration seeds. */
const TZ_OFFSET_HOURS = 8;

// ---------------------------------------------------------------- env loading

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

/**
 * Abort with an actionable message. Thrown rather than `process.exit()`d so the
 * Supabase client's sockets close on their own — exiting mid-flight trips a libuv
 * assertion on Windows and buries the real message.
 */
function fail(message) {
  const error = new Error(message);
  error.reported = true;
  throw error;
}

const env = loadEnv();
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const envOk = Boolean(SUPABASE_URL && SERVICE_KEY && ANON_KEY);
if (!envOk) {
  console.error(
    "verify-queue-fairness: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY and NEXT_PUBLIC_SUPABASE_ANON_KEY must all be set in .env.local"
  );
}

// ------------------------------------------------------------------- reporting

let failures = 0;
let checks = 0;

function check(name, ok, detail = "") {
  checks++;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `\n        ${detail}`}`);
}

function section(title) {
  console.log(`\n== ${title} ==`);
}


// --------------------------------------------------------------------- clients

const admin = createClient(SUPABASE_URL ?? "http://127.0.0.1:54321", SERVICE_KEY ?? "unset", {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});

/** A user-scoped client: real sign-in, real JWT, real RLS. */
async function signInAs(email) {
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  await client.auth.setSession({
    access_token: data.session.access_token,
    refresh_token: data.session.refresh_token,
  });
  return client;
}

// --------------------------------------------------------------- time helpers

/**
 * A wall-clock time in the service timezone (`Asia/Manila`, UTC+8, no DST),
 * returned as an ISO instant. A fixed offset is deliberate and safe here: the
 * queue stores timestamptz, and "a 30 January booking must not block 24 January"
 * only means anything against real absolute times.
 */
function at(dayOffset, hour, minute = 0) {
  const manilaNow = new Date(Date.now() + TZ_OFFSET_HOURS * 3_600_000);
  const wall = Date.UTC(
    manilaNow.getUTCFullYear(),
    manilaNow.getUTCMonth(),
    manilaNow.getUTCDate() + dayOffset,
    hour,
    minute
  );
  return new Date(wall - TZ_OFFSET_HOURS * 3_600_000).toISOString();
}

// --------------------------------------------------------------- fixture state

const emails = {
  a: `qa-queue-${RUN}-a@sparkserv.invalid`,
  b: `qa-queue-${RUN}-b@sparkserv.invalid`,
  c: `qa-queue-${RUN}-c@sparkserv.invalid`,
  customer: `qa-queue-${RUN}-customer@sparkserv.invalid`,
};

const ids = { a: null, b: null, c: null, customer: null };
const requestIds = [];
const bookingIds = [];

// ------------------------------------------------------------------ DB helpers

/** Queue membership for one appliance type, ordered by position. */
async function positions(appliance = APPLIANCE) {
  const { data, error } = await admin
    .from("technician_queue_state")
    .select("technician_id, queue_position, is_active")
    .eq("appliance_type", appliance)
    .order("queue_position", { ascending: true });
  if (error) throw new Error(`reading queue positions: ${error.message}`);
  return (data ?? []).map((row) => [row.technician_id, row.queue_position, row.is_active]);
}

/** The rotation as letters ("A→C→B") for readable assertions. */
async function order(appliance = APPLIANCE) {
  const label = { [ids.a]: "A", [ids.b]: "B", [ids.c]: "C" };
  const rows = await positions(appliance);
  return rows.map(([technicianId]) => label[technicianId] ?? "?").join("→");
}

async function positionOf(technicianId, appliance = APPLIANCE) {
  const rows = await positions(appliance);
  return rows.find(([id]) => id === technicianId)?.[1] ?? null;
}

async function request(id) {
  const { data, error } = await admin.from("service_requests").select("*").eq("id", id).single();
  if (error) throw new Error(`reading request ${id}: ${error.message}`);
  return data;
}

async function createRequest(label, start, end, appliance = APPLIANCE) {
  const { data, error } = await admin
    .from("service_requests")
    .insert({
      customer_id: ids.customer,
      appliance_type: appliance,
      issue_category: "qa queue verification",
      problem_description: `QA queue fairness check ${label} (run ${RUN})`,
      location: "QA Verification Site",
      status: "open",
      assignment_status: "matching",
      requested_window_start: start,
      requested_window_end: end,
      requested_duration_minutes: 120,
    })
    .select("id")
    .single();
  if (error) throw new Error(`creating request ${label}: ${error.message}`);
  requestIds.push(data.id);
  return data.id;
}

/**
 * A real appointment on the technician's calendar. This is the only thing that
 * legitimately makes a requested window unavailable — and only for that window.
 */
async function createBooking(technicianId, serviceRequestId, start, hours = 2) {
  const { data, error } = await admin
    .from("bookings")
    .insert({
      service_request_id: serviceRequestId,
      customer_id: ids.customer,
      technician_id: technicianId,
      scheduled_at: start,
      duration_minutes: hours * 60,
      status: "confirmed",
    })
    .select("id")
    .single();
  if (error) throw new Error(`creating booking: ${error.message}`);
  bookingIds.push(data.id);
  return data.id;
}

async function assign(id) {
  const { data, error } = await admin.rpc("assign_technician_to_request", { p_request_id: id });
  if (error) throw new Error(`assign_technician_to_request: ${error.message}`);
  return data;
}

async function respond(id, technicianId, action, reason = null) {
  const { data, error } = await admin.rpc("respond_to_offer", {
    p_request_id: id,
    p_technician_id: technicianId,
    p_action: action,
    p_reason: reason,
  });
  if (error) throw new Error(`respond_to_offer(${action}): ${error.message}`);
  return data;
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  console.log(`SPARKServ live queue verification — run ${RUN}`);
  console.log(`Project: ${SUPABASE_URL}`);
  console.log(`Scoped appliance type: ${APPLIANCE}`);

  section("0. Preflight — is the queue migration applied?");

  const probe = await admin
    .from("technician_queue_state")
    .select("queue_position, is_active")
    .limit(1);
  if (probe.error) {
    fail(
      `technician_queue_state.queue_position is not readable (${probe.error.message}).\n` +
        "Apply the migrations first, in this order, in the Supabase SQL Editor:\n" +
        "  1. supabase/migration_sync_live_schema.sql\n" +
        "  2. supabase/migration_flow_hardening.sql\n" +
        "  3. supabase/migration_queue_redesign.sql"
    );
  }
  check("queue membership has an explicit queue_position column", true);

  const windowProbe = await admin
    .from("service_requests")
    .select("requested_window_start, requested_window_end")
    .limit(1);
  check(
    "requests carry a requested time window (§6/§16)",
    !windowProbe.error,
    windowProbe.error?.message ?? ""
  );

  const snapshotProbe = await admin.rpc("technician_queue_snapshot", { p_appliance_type: null });
  check(
    "technician_queue_snapshot() is callable",
    !snapshotProbe.error || !/Could not find the function/.test(snapshotProbe.error.message),
    snapshotProbe.error?.message ?? ""
  );

  section("1. Fixtures — technicians A, B, C and a customer");

  async function createUser(key, role, name) {
    const { data, error } = await admin.auth.admin.createUser({
      email: emails[key],
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { name, role },
    });
    if (error) throw new Error(`creating ${key}: ${error.message}`);
    ids[key] = data.user.id;
    return data.user.id;
  }

  await createUser("a", "technician", `QA Technician A ${RUN}`);
  await createUser("b", "technician", `QA Technician B ${RUN}`);
  await createUser("c", "technician", `QA Technician C ${RUN}`);
  await createUser("customer", "customer", `QA Customer ${RUN}`);
  check("created 3 technicians + 1 customer", Boolean(ids.a && ids.b && ids.c && ids.customer));

  // Approve and specialize. Adding a specialization is what joins an appliance
  // rotation (sync_queue_membership), so this is also the join test.
  for (const key of ["a", "b", "c"]) {
    const { error } = await admin
      .from("technicians")
      .update({
        approved: true,
        approved_at: new Date().toISOString(),
        specializations: [APPLIANCE],
        max_daily_hours: 8,
        max_concurrent_jobs: 2,
        max_jobs_per_day: 4,
        operational_status: "AVAILABLE",
      })
      .eq("id", ids[key]);
    if (error) throw new Error(`approving ${key}: ${error.message}`);
  }

  const members = await positions();
  check(
    "each technician joined the appliance rotation exactly once (no duplicate membership §36)",
    members.length === 3 && new Set(members.map(([id]) => id)).size === 3,
    JSON.stringify(members)
  );

  const joinedEvents = await events("JOINED_QUEUE");
  check(
    "joining the rotation is audited (§33)",
    joinedEvents.length >= 3,
    `expected >= 3 JOINED_QUEUE events, saw ${joinedEvents.length}`
  );

  // Pin the starting order to A→B→C so the spec's scenario is deterministic.
  await admin
    .from("technician_queue_state")
    .update({ queue_position: 1 })
    .eq("appliance_type", APPLIANCE)
    .eq("technician_id", ids.a);
  await admin
    .from("technician_queue_state")
    .update({ queue_position: 2 })
    .eq("appliance_type", APPLIANCE)
    .eq("technician_id", ids.b);
  await admin
    .from("technician_queue_state")
    .update({ queue_position: 3 })
    .eq("appliance_type", APPLIANCE)
    .eq("technician_id", ids.c);
  check(`initial rotation is A→B→C (got ${await order()})`, (await order()) === "A→B→C");

  const duplicate = await admin.from("technician_queue_state").insert({
    technician_id: ids.a,
    appliance_type: APPLIANCE,
    queue_position: 99,
  });
  check(
    "a duplicate membership is impossible (§36)",
    Boolean(duplicate.error),
    duplicate.error ? "" : "the insert succeeded — there is no unique constraint"
  );
}

// ---------------------------------------------------------------------------
// The acceptance scenario (spec §22–§26, §28, §36, §38)
// ---------------------------------------------------------------------------

async function scenario() {
  section("2. A technician sees the WHOLE rotation, not just themselves (§26, §36)");

  const clientB = await signInAs(emails.b);
  const snapshot = await clientB.rpc("technician_queue_snapshot", { p_appliance_type: APPLIANCE });
  check("the snapshot RPC accepts a technician JWT", !snapshot.error, snapshot.error?.message ?? "");

  const rows = (snapshot.data ?? []).slice().sort((x, y) => x.queue_position - y.queue_position);
  const label = { [ids.a]: "A", [ids.b]: "B", [ids.c]: "C" };
  const visibleOrder = rows.map((row) => label[row.technician_id] ?? "?").join("→");

  check(
    `the queue lists every technician in the rotation, not just the caller (§26) — got ${visibleOrder}`,
    rows.length === 3 && visibleOrder === "A→B→C",
    JSON.stringify(rows.map((r) => [label[r.technician_id], r.queue_position, r.operational_status]))
  );
  check(
    "exactly one row is flagged is_self and it is the caller",
    rows.filter((row) => row.is_self).length === 1 &&
      rows.find((row) => row.is_self)?.technician_id === ids.b
  );
  check("other technicians' names are visible (You indicator needs them)", rows.every((row) => row.technician_name));
  check(
    "no private fields leak into the queue view (§11)",
    rows.every((row) =>
      ["email", "phone", "address", "customer_id", "customer_name"].every((key) => !(key in row))
    ),
    JSON.stringify(Object.keys(rows[0] ?? {}))
  );
  check(
    "each row carries an operational status from the documented vocabulary (§15)",
    rows.every((row) =>
      ["AVAILABLE", "ON_JOB", "SCHEDULED", "TEMPORARILY_UNAVAILABLE", "OFFLINE", "SUSPENDED"].includes(
        row.operational_status
      )
    )
  );

  const clientCustomer = await signInAs(emails.customer);
  const customerSnapshot = await clientCustomer.rpc("technician_queue_snapshot", {
    p_appliance_type: APPLIANCE,
  });
  check(
    "a customer cannot read the technician queue (§13, §36)",
    Boolean(customerSnapshot.error),
    customerSnapshot.error ? "" : "the customer was allowed to read the queue"
  );

  section("3. §38 / §22 — accepting consumes the turn and moves the technician to the end");

  const r1 = await createRequest("§22 A accepts a day+7 repair", at(7, 9), at(7, 11));
  const offer1 = await assign(r1);
  check(
    "the first offer goes to the head of the rotation (A)",
    offer1?.assigned_technician_id === ids.a,
    JSON.stringify(offer1)
  );

  const accept1 = await respond(r1, ids.a, "accept");
  check("A's acceptance is confirmed", accept1?.outcome === "accepted", JSON.stringify(accept1));
  check(
    `A's turn is consumed immediately: rotation becomes B→C→A (got ${await order()})`,
    (await order()) === "B→C→A"
  );
  check(
    "A is NOT removed from the rotation because of the future booking (§2)",
    (await positionOf(ids.a)) === 3
  );

  // The real appointment that A accepted — day+7, 09:00–11:00.
  await createBooking(ids.a, r1, at(7, 9), 2);

  section("4. §24 — a future booking never makes a technician globally unavailable");

  const futureEligibility = await admin.rpc("technician_eligibility_failure", {
    p_technician_id: ids.a,
    p_appliance_type: APPLIANCE,
    p_location: "QA Verification Site",
    p_start: at(3, 14),
    p_end: at(3, 16),
    p_request_id: null,
  });
  check(
    "A is still eligible for a day+3 request while holding a day+7 booking",
    !futureEligibility.error && futureEligibility.data === null,
    JSON.stringify(futureEligibility.data ?? futureEligibility.error?.message)
  );

  const clashEligibility = await admin.rpc("technician_eligibility_failure", {
    p_technician_id: ids.a,
    p_appliance_type: APPLIANCE,
    p_location: "QA Verification Site",
    p_start: at(7, 10),
    p_end: at(7, 12),
    p_request_id: null,
  });
  check(
    "…but the very same technician is skipped for a window that genuinely clashes",
    !clashEligibility.error && typeof clashEligibility.data === "string",
    JSON.stringify(clashEligibility.data ?? clashEligibility.error?.message)
  );

  const r2 = await createRequest("§38 day+3 request", at(3, 14), at(3, 16));
  const offer2 = await assign(r2);
  check(
    "the day+3 offer goes to B, the head of the rotation",
    offer2?.assigned_technician_id === ids.b,
    JSON.stringify(offer2)
  );
  check("A's position is untouched by that offer", (await positionOf(ids.a)) === 3);

  const accept2 = await respond(r2, ids.b, "accept");
  check("B accepts", accept2?.outcome === "accepted", JSON.stringify(accept2));
  check(`rotation becomes C→A→B (got ${await order()})`, (await order()) === "C→A→B");

  const r3 = await createRequest("§38 day+4 request", at(4, 10), at(4, 12));
  const offer3 = await assign(r3);
  check(
    "the day+4 offer goes to C, the head of the rotation",
    offer3?.assigned_technician_id === ids.c,
    JSON.stringify(offer3)
  );
  const accept3 = await respond(r3, ids.c, "accept");
  check("C accepts", accept3?.outcome === "accepted", JSON.stringify(accept3));
  check(`rotation returns to A→B→C (got ${await order()})`, (await order()) === "A→B→C");
  section("5. §23 — a genuine clash skips one technician for one request only");

  // A heads the rotation (A→B→C). Give A an appointment that clashes with the
  // window about to be requested: booked day+6 08:00–10:00, request 09:00–11:00.
  const anchor = await createRequest("§23 anchor for A's appointment", at(6, 8), at(6, 10));
  await createBooking(ids.a, anchor, at(6, 8), 2);

  const aPositionBefore = await positionOf(ids.a);
  const r4 = await createRequest("§23 conflicting request (day+6 09:00–11:00)", at(6, 9), at(6, 11));
  const offer4 = await assign(r4);

  check(
    "A is skipped for that window only: the offer moves on",
    offer4?.assigned_technician_id !== ids.a,
    JSON.stringify(offer4)
  );
  check(
    `A keeps position #${aPositionBefore} despite being skipped (§8)`,
    (await positionOf(ids.a)) === aPositionBefore
  );
  check(
    "the skip is audited with old == new position (§8, §33)",
    (await events("SKIPPED_DUE_TO_SCHEDULE")).some(
      (event) => event.technician_id === ids.a && event.old_position === event.new_position
    ),
    JSON.stringify((await events("SKIPPED_DUE_TO_SCHEDULE")).slice(0, 1))
  );
  check(
    "the offer goes to the next rotation member (B)",
    offer4?.assigned_technician_id === ids.b,
    JSON.stringify(offer4)
  );

  const accept4 = await respond(r4, ids.b, "accept");
  check("B accepts that request", accept4?.outcome === "accepted", JSON.stringify(accept4));
  check(`rotation becomes C→A→B (got ${await order()})`, (await order()) === "C→A→B");

  section("6. §25 / §12 — appliance queues are computed independently");

  await admin
    .from("technicians")
    .update({ specializations: [APPLIANCE, APPLIANCE_2] })
    .eq("id", ids.a);
  await admin
    .from("technicians")
    .update({ specializations: [APPLIANCE, APPLIANCE_2] })
    .eq("id", ids.c);

  check(
    `adding a second specialization does not disturb the first queue (${await order()})`,
    (await order()) === "B→C→A"
  );

  const members2 = await positions(APPLIANCE_2);
  const members2Labels = members2.map(([id]) => label[id] ?? "?").join("→");
  check(
    "only eligible technicians join the second queue (§12)",
    members2.length === 2 && !members2.some(([id]) => id === ids.b),
    members2Labels
  );

  const bEligibilitySecondQueue = await admin.rpc("technician_eligibility_failure", {
    p_technician_id: ids.b,
    p_appliance_type: APPLIANCE_2,
    p_location: "QA Verification Site",
    p_start: at(5, 13),
    p_end: at(5, 15),
    p_request_id: null,
  });
  check(
    "a technician without the specialization is ineligible for that queue (§5)",
    !bEligibilitySecondQueue.error && typeof bEligibilitySecondQueue.data === "string",
    JSON.stringify(bEligibilitySecondQueue.data ?? bEligibilitySecondQueue.error?.message)
  );

  check(
    "A holds a different position in each queue (§12, §25)",
    (await positionOf(ids.a, APPLIANCE)) !== (await positionOf(ids.a, APPLIANCE_2)),
    `queue 1: #${await positionOf(ids.a)} · queue 2: #${await positionOf(ids.a, APPLIANCE_2)}`
  );

  const secondQueueHead = (await positions(APPLIANCE_2))[0]?.[0] ?? null;
  const r5 = await createRequest("§25 second-appliance request", at(5, 13), at(5, 15), APPLIANCE_2);
  const offer5 = await assign(r5);
  check(
    "the second queue offers to its own head; an ineligible technician is never offered (§12, §25)",
    offer5?.assigned_technician_id === secondQueueHead && offer5?.assigned_technician_id !== ids.b,
    JSON.stringify({ head: label[secondQueueHead], offer5 })
  );
  check("the first queue is still untouched by the second queue's activity", (await order()) === "C→A→B");

  section("7. §9 — a decline is recorded and passed on, without costing the turn");

  const declineHead = (await positions())[0]?.[0] ?? null;
  const declineHeadPositionBefore = await positionOf(declineHead);
  const r6 = await createRequest("§9 decline", at(9, 9), at(9, 11));
  const offer6 = await assign(r6);
  check(
    "the head of the rotation receives the offer",
    offer6?.assigned_technician_id === declineHead,
    JSON.stringify(offer6)
  );

  const decline = await respond(r6, declineHead, "decline", "QA: cannot make that day");
  check("the decline is recorded", decline?.outcome === "declined", JSON.stringify(decline));
  check(
    "the default policy does not consume the turn for a decline (§9)",
    decline?.decline_consumed_turn === false,
    JSON.stringify(decline)
  );
  check(
    `the declining technician keeps position #${declineHeadPositionBefore}`,
    (await positionOf(declineHead)) === declineHeadPositionBefore
  );
  const declinedEvents = await events("DECLINED");
  check(
    "the decline and its reason are audited (§33)",
    declinedEvents.some(
      (event) => event.technician_id === declineHead && (event.reason ?? "").includes("cannot make")
    ),
    JSON.stringify(declinedEvents.slice(0, 1))
  );
  const afterDecline = await request(r6);
  check(
    "the request moves to the next eligible technician, never back to the decliner",
    afterDecline.assignment_status === "offered" && afterDecline.assigned_technician_id !== declineHead,
    JSON.stringify({
      status: afterDecline.assignment_status,
      technician: afterDecline.assigned_technician_id,
    })
  );

  section("8. §10 — an ignored offer expires and is re-offered, with no queue penalty");

  const r7 = await createRequest("§10 expiry", at(10, 9), at(10, 11));
  const offer7 = await assign(r7);
  const staleTechnician = offer7?.assigned_technician_id ?? null;
  const stalePositionBefore = await positionOf(staleTechnician);
  const { error: staleError } = await admin
    .from("service_requests")
    .update({ offers_expires_at: new Date(Date.now() - 60_000).toISOString() })
    .eq("id", r7);
  check("could age the offer past its TTL", !staleError, staleError?.message ?? "");

  const sweep = await admin.rpc("expire_stale_offers");
  check("the expiry sweep the cron job runs succeeds", !sweep.error, sweep.error?.message ?? "");
  check(
    "the lapsed offer is audited (§10, §33)",
    (await events("EXPIRED")).some((event) => event.technician_id === staleTechnician),
    JSON.stringify((await events("EXPIRED")).slice(0, 1))
  );
  check(
    `an expiry does not remove the technician from the queue (#${stalePositionBefore})`,
    (await positionOf(staleTechnician)) === stalePositionBefore
  );
  const afterExpiry = await request(r7);
  check(
    "the lapsed request is re-offered or parked as waiting (§4)",
    ["offered", "waiting"].includes(afterExpiry.assignment_status),
    afterExpiry.assignment_status
  );

  section("9. §28 — concurrent assignment cannot double-book a request");

  const r8 = await createRequest("§28 concurrency", at(11, 9), at(11, 11));
  const [attemptOne, attemptTwo] = await Promise.all([assign(r8), assign(r8)]);
  const holders = [attemptOne?.assigned_technician_id, attemptTwo?.assigned_technician_id].filter(
    Boolean
  );
  check(
    "at most one technician ends up holding the offer",
    new Set(holders).size <= 1,
    JSON.stringify(holders)
  );

  const { data: liveOffers } = await admin
    .from("technician_offer_history")
    .select("technician_id, status")
    .eq("service_request_id", r8)
    .eq("status", "offered");
  check(
    "no duplicate live offer rows exist for the request (§36)",
    (liveOffers ?? []).length <= 1,
    JSON.stringify(liveOffers)
  );

  const r8After = await request(r8);
  check(
    "the request never ends up both unassigned and marked as offered",
    r8After.assignment_status !== "offered" || Boolean(r8After.assigned_technician_id),
    JSON.stringify({ status: r8After.assignment_status })
  );
  section("10. §20 / §1 — completion and ratings never re-order the queue");

  const orderBeforeCompletion = await order();
  if (bookingIds.length) {
    await admin.from("bookings").update({ status: "completed" }).eq("id", bookingIds[0]);
  }
  check(
    `completing a repair does not move anyone (§20) — ${orderBeforeCompletion}`,
    (await order()) === orderBeforeCompletion
  );

  await admin
    .from("technicians")
    .update({ rating: 5, experience_years: 25, jobs_completed: 999 })
    .eq("id", ids.a);
  check(
    `rating and experience do not affect the rotation (§1) — ${orderBeforeCompletion}`,
    (await order()) === orderBeforeCompletion
  );

  section("11. §28 / §32 / §36 — clients cannot manipulate the queue");

  const bPositionBefore = await positionOf(ids.b);
  const { error: tamperError } = await clientB
    .from("technician_queue_state")
    .update({ queue_position: 1 })
    .eq("appliance_type", APPLIANCE)
    .eq("technician_id", ids.b);
  check(
    "a technician cannot rewrite their own queue position",
    Boolean(tamperError) || (await positionOf(ids.b)) === bPositionBefore,
    tamperError ? tamperError.message : "the update went through"
  );
  check(
    "the declared position is unchanged after the attempt",
    (await positionOf(ids.b)) === bPositionBefore
  );

  const { error: customerWriteError } = await clientCustomer
    .from("technician_queue_state")
    .update({ queue_position: 1 })
    .eq("technician_id", ids.a);
  check(
    "a customer cannot touch the queue at all",
    Boolean(customerWriteError),
    "the customer update was permitted"
  );

  const { error: forgedOverrideError } = await clientB.rpc("admin_queue_override", {
    p_appliance_type: APPLIANCE,
    p_technician_id: ids.b,
    p_action: "move_to_end",
    p_reason: "QA: forged override attempt",
  });
  check(
    "a technician cannot use the administrative override (§32)",
    Boolean(forgedOverrideError),
    "the override was accepted from a technician"
  );

  section("12. §33 — the audit trail covers the documented actions");

  const allEvents = await events();
  const actions = new Set(allEvents.map((event) => event.action));
  for (const expected of [
    "JOINED_QUEUE",
    "OFFERED",
    "ACCEPTED",
    "DECLINED",
    "EXPIRED",
    "SKIPPED_DUE_TO_SCHEDULE",
    "TURN_CONSUMED",
  ]) {
    check(`the queue history records ${expected}`, actions.has(expected), [...actions].join(", "));
  }
  check(
    "every turn consumption carries old and new positions",
    allEvents
      .filter((event) =>
        ["TURN_CONSUMED", "MOVED_TO_END", "POSITION_CHANGED"].includes(event.action)
      )
      .every((event) => event.old_position !== null && event.new_position !== null)
  );

  section("13. §36 — final state: everyone is still in the rotation, exactly once");

  const finalMembers = await positions();
  check(
    "all three technicians are still members of the rotation",
    finalMembers.length === 3 &&
      [ids.a, ids.b, ids.c].every((id) => finalMembers.some(([row]) => row === id)),
    JSON.stringify(finalMembers.map(([id, position]) => [label[id], position]))
  );
  check(
    "positions are unique",
    new Set(finalMembers.map(([, position]) => position)).size === finalMembers.length,
    JSON.stringify(finalMembers.map(([, position]) => position))
  );
  console.log(`  final rotation: ${await order()}`);

  const finalSnapshot = await clientB.rpc("technician_queue_snapshot", {
    p_appliance_type: APPLIANCE,
  });
  check(
    "the technician still sees every technician at the end of the run (§26)",
    (finalSnapshot.data ?? []).length === 3,
    JSON.stringify(
      (finalSnapshot.data ?? []).map((row) => [label[row.technician_id], row.queue_position])
    )
  );
}

// ---------------------------------------------------------------------------
// Teardown + runner
// ---------------------------------------------------------------------------

async function cleanup() {
  section("Cleanup");

  // Bookings and offer history belong to our requests (FK cascade), but deleting
  // explicit rows keeps the teardown obvious in the Supabase logs.
  if (requestIds.length) {
    await admin.from("bookings").delete().in("service_request_id", requestIds);
    await admin.from("service_requests").delete().in("id", requestIds);
  }

  for (const appliance of [APPLIANCE, APPLIANCE_2]) {
    await admin.from("technician_queue_events").delete().eq("appliance_type", appliance);
    await admin.from("technician_queue_state").delete().eq("appliance_type", appliance);
  }

  const technicianIds = [ids.a, ids.b, ids.c].filter(Boolean);
  if (technicianIds.length) {
    await admin.from("technician_availability").delete().in("technician_id", technicianIds);
    await admin.from("technician_service_areas").delete().in("technician_id", technicianIds);
    await admin.from("technician_time_off").delete().in("technician_id", technicianIds);
  }

  for (const key of ["a", "b", "c", "customer"]) {
    if (!ids[key]) continue;
    await admin.from("users").delete().eq("id", ids[key]);
    await admin.auth.admin.deleteUser(ids[key]);
  }

  console.log("  fixtures removed");
}

if (envOk) {
  main()
    .then(scenario)
  .then(async () => {
    if (KEEP) {
      console.log(`\n--keep: fixtures left in place (emails end with ${RUN}).`);
    } else {
      await cleanup();
    }
    console.log(`\n${checks - failures}/${checks} checks passed`);
    if (failures) {
      console.error(`${failures} check(s) FAILED — the live queue does not match the new model.`);
    }
    process.exitCode = failures ? 1 : 0;
  })
  .catch(async (error) => {
    console.error(`\nverify-queue-fairness: ${error?.message ?? error}`);
    if (!error?.reported) console.error(error?.stack ?? "");
    try {
      if (!KEEP) await cleanup();
    } catch (cleanupError) {
      console.error(`cleanup failed: ${cleanupError?.message ?? cleanupError}`);
    }
    process.exitCode = 1;
  });
}

if (!envOk) process.exitCode = 1;

async function events(action = null) {
  let query = admin
    .from("technician_queue_events")
    .select("*")
    .eq("appliance_type", APPLIANCE)
    .order("created_at", { ascending: false })
    .limit(200);
  if (action) query = query.eq("action", action);
  const { data, error } = await query;
  if (error) throw new Error(`reading queue events: ${error.message}`);
  return data ?? [];
}
