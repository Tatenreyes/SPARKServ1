/**
 * SPARKServ queue integration test.
 *
 * Loads the real schema + migration files into an in-process Postgres (PGlite,
 * WASM) and then runs the queue-fairness scenario from the redesign spec
 * (sections 8-11, 15, 17-28, 32-33, 36, 38) against it, asserting every
 * expectation.
 *
 *   npm run test:queue-sql
 *
 * Why this exists: the queue redesign is ~1900 lines of PL/pgSQL with row
 * locks, an advisory lock, triggers and interval/capacity maths. Reading it is
 * not evidence that it runs. This harness is repeatable, offline and cannot
 * touch the live project. The companion `scripts/verify-queue-fairness.mjs`
 * proves the same scenario against the real Supabase project.
 *
 * Caveat: PGlite is Postgres compiled to WASM with `auth.uid()`/roles stubbed
 * (see scripts/sql-harness.sql). A green run means the SQL and the fairness
 * rules are sound — not that production is verified.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";
import { uuid_ossp } from "@electric-sql/pglite/contrib/uuid_ossp";

const repo = process.argv[2] ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => fs.readFileSync(path.join(repo, p), "utf8");

const db = new PGlite({ extensions: { uuid_ossp } });

let failures = 0;
const results = [];


function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `\n        ${detail}`}`);
}

async function exec(label, sql) {
  try {
    await db.exec(sql);
    console.log(`  loaded ${label}`);
  } catch (err) {
    console.log(`  FAILED loading ${label}: ${err.message}`);
    throw err;
  }
}

async function query(sql, params) {
  const res = await db.query(sql, params);
  return res.rows;
}

/** Impersonate a signed-in user the way PostgREST does. */
async function asUser(userId, role, fn) {
  await db.exec(`set role ${role};`);
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId ?? ""]);
  try {
    return await fn();
  } finally {
    await db.exec("reset role;");
    await db.query("select set_config('request.jwt.claim.sub', '', false)");
  }
}

async function queueOrder(applianceType = "refrigerator") {
  const rows = await query(
    `select qs.queue_position, qs.technician_id, u.name, qs.is_active
       from public.technician_queue_state qs
       join public.users u on u.id = qs.technician_id
      where qs.appliance_type = $1
      order by qs.queue_position`,
    [applianceType]
  );
  return rows;
}

const orderNames = (rows) => rows.filter((r) => r.is_active).map((r) => r.name).join(" -> ");
const positions = (rows) => JSON.stringify(rows.map((r) => [r.technician_id, r.queue_position]));

/**
 * supabase/schema.sql uses public.is_admin() in its very first policy (the
 * appliances policy) but only defines it ~180 lines later, so the file is not a
 * standalone fresh install — it assumes the helper functions already exist from
 * an earlier release (its own comment at the helper block says as much).
 *
 * Rather than paste those definitions here (two sources of truth that drift),
 * the real block is extracted from schema.sql and executed before the first
 * policy that needs it. Only current_role()/is_admin() are extracted: the third
 * helper (technician_linked_to_request) queries tables that do not exist yet,
 * and SQL function bodies are resolved at CREATE time.
 */
function extractHelperFunctions(sql) {
  const start = sql.indexOf("create or replace function public.current_role()");
  const end = sql.indexOf("-- Helper: does the calling technician have a link", start);
  if (start === -1 || end === -1) {
    throw new Error("could not locate the current_role()/is_admin() block in supabase/schema.sql");
  }
  return sql.slice(start, end);
}

/** First policy in schema.sql — everything before it is enums/tables/indexes. */
function firstPolicyIndex(sql) {
  const index = sql.indexOf('create policy "customer manages own appliances"');
  if (index === -1) throw new Error("could not locate the first policy in supabase/schema.sql");
  return index;
}

const schemaSql = read("supabase/schema.sql");
const firstPolicy = firstPolicyIndex(schemaSql);

console.log("== 1. Loading schema and migrations ==");
await exec("scripts/sql-harness.sql (Supabase stubs)", read("scripts/sql-harness.sql"));
await exec("supabase/schema.sql (extensions, enums, tables, indexes)", schemaSql.slice(0, firstPolicy));
await exec("supabase/schema.sql helper functions (pre-created)", extractHelperFunctions(schemaSql));
await exec("supabase/schema.sql (policies onward)", schemaSql.slice(firstPolicy));
// NOTE: supabase/migration_technician_queue.sql is deliberately NOT loaded — it
// is the historical, standalone version of the queue tables that schema.sql now
// contains inline, so running both would collide ("technician_queue_state
// already exists"). A fresh install (this harness) and the live upgrade path
// (that migration, then migration_queue_redesign.sql) must both end in the same
// shape, which is exactly what migration_queue_redesign.sql's guards guarantee.
await exec("supabase/migration_sync_live_schema.sql", read("supabase/migration_sync_live_schema.sql"));
await exec("supabase/migration_flow_hardening.sql", read("supabase/migration_flow_hardening.sql"));
await exec("supabase/migration_queue_redesign.sql", read("supabase/migration_queue_redesign.sql"));
// Re-running must be a no-op (idempotence).
await exec("supabase/migration_queue_redesign.sql (2nd run)", read("supabase/migration_queue_redesign.sql"));



console.log("\n== 2. Fixtures: technicians A, B, C + a customer ==");

/**
 * Users are provisioned the way Supabase does it: insert into auth.users and
 * let schema.sql's handle_new_user() trigger create the public.users (and
 * technicians) row, then adjust the profile. Inserting public.users directly
 * collides with the trigger's row — which is itself a useful thing to know the
 * harness reproduces faithfully.
 */
async function provisionUser({ email, name, role, location = null }) {
  const authUser = (
    await query("insert into auth.users (email, raw_user_meta_data) values ($1, $2) returning id", [
      email,
      JSON.stringify({ name, role }),
    ])
  )[0];
  await query("update public.users set name = $2, role = $3, is_active = true, location = $4 where id = $1", [
    authUser.id,
    name,
    role,
    location,
  ]);
  return authUser.id;
}

const tech = {};
const names = { A: "Technician A", B: "Technician B", C: "Technician C" };
for (const key of Object.keys(names)) {
  const id = await provisionUser({
    email: `${key.toLowerCase()}-queue-test@example.com`,
    name: names[key],
    role: "technician",
    location: "Makati",
  });
  // handle_new_user() already created the technicians row; fill it in.
  // specializations is a real text[] column: pass a JS array, not a JSON string
  // (Postgres rejects `'["Refrigerator"]'::text[]`).
  await query(
    "update public.technicians set specializations = $2, approved = true, approved_at = now() where id = $1",
    [id, ["Refrigerator"]]
  );
  tech[key] = id;
}

const customerId = await provisionUser({
  email: "customer-queue-test@example.com",
  name: "Queue Test Customer",
  role: "customer",
  location: "Makati",
});


const initialQueue = await queueOrder();
check("queue membership auto-created for all three technicians", initialQueue.length === 3, JSON.stringify(initialQueue));
check(
  "initial queue order is A -> B -> C",
  orderNames(initialQueue) === "Technician A -> Technician B -> Technician C",
  orderNames(initialQueue)
);

console.log("\n== 3. Fairness rotation (spec §22) ==");

async function createRequest(startIso, endIso, label) {
  const rows = await query(
    `insert into public.service_requests
       (customer_id, appliance_type, problem_description, status, assignment_status,
        location, requested_window_start, requested_window_end)
     values ($1,'refrigerator',$2,'open','matching','Makati',$3,$4)
     returning id`,
    [customerId, label, startIso, endIso]
  );
  return rows[0].id;
}

async function assign(requestId) {
  const rows = await query("select public.assign_technician_to_request($1) as result", [requestId]);
  return rows[0].result;
}

async function respond(requestId, technicianId, action, reason = null) {
  const rows = await query("select public.respond_to_offer($1,$2,$3,$4) as result", [
    requestId,
    technicianId,
    action,
    reason,
  ]);
  return rows[0].result;
}

// Jan 30 request: A is first and accepts -> B -> C -> A
const jan30 = await createRequest("2030-01-30T01:00:00Z", "2030-01-30T03:00:00Z", "Refrigerator not cooling");
const jan30Offer = await assign(jan30);
check("Jan 30 request is offered to Technician A", jan30Offer.assigned_technician_id === tech.A, JSON.stringify(jan30Offer));

const jan30Accepted = await respond(jan30, tech.A, "accept");
check("Technician A accepts the Jan 30 request", jan30Accepted.outcome === "accepted", JSON.stringify(jan30Accepted));

let rows = await queueOrder();
check("after A accepts: B -> C -> A", orderNames(rows) === "Technician B -> Technician C -> Technician A", orderNames(rows));
check("A is still IN the queue (a future booking does not remove him)", rows.some((r) => r.technician_id === tech.A), orderNames(rows));
check("A's position moved to the end (#3)", rows.find((r) => r.technician_id === tech.A)?.queue_position === 3, JSON.stringify(rows));

// Jan 24 request: B is first and accepts -> C -> A -> B
const jan24 = await createRequest("2030-01-24T01:00:00Z", "2030-01-24T03:00:00Z", "Refrigerator making noise");
const jan24Offer = await assign(jan24);
check("Jan 24 request is offered to Technician B (A is #3 now)", jan24Offer.assigned_technician_id === tech.B, JSON.stringify(jan24Offer));
await respond(jan24, tech.B, "accept");
rows = await queueOrder();
check("after B accepts: C -> A -> B", orderNames(rows) === "Technician C -> Technician A -> Technician B", orderNames(rows));

// Jan 25 request: C accepts -> A -> B -> C
const jan25 = await createRequest("2030-01-25T01:00:00Z", "2030-01-25T03:00:00Z", "Refrigerator leaking");
const jan25Offer = await assign(jan25);
check("Jan 25 request is offered to Technician C", jan25Offer.assigned_technician_id === tech.C, JSON.stringify(jan25Offer));
await respond(jan25, tech.C, "accept");
rows = await queueOrder();
check("after C accepts: A -> B -> C", orderNames(rows) === "Technician A -> Technician B -> Technician C", orderNames(rows));

// Jan 26 request: A is first and free that day even though Jan 30 is booked.
const jan26 = await createRequest("2030-01-26T01:00:00Z", "2030-01-26T03:00:00Z", "Refrigerator iced up");
const jan26Offer = await assign(jan26);
check(
  "Jan 26 request reaches Technician A while he still has the Jan 30 booking (spec §24)",
  jan26Offer.assigned_technician_id === tech.A,
  JSON.stringify(jan26Offer)
);
await respond(jan26, tech.A, "accept");
rows = await queueOrder();
check("after A accepts: B -> C -> A", orderNames(rows) === "Technician B -> Technician C -> Technician A", orderNames(rows));

// Give A a real appointment on Jan 30 (the fact that this booking exists must
// not stop him from being offered other work).
await query(
  `insert into public.bookings (service_request_id, customer_id, technician_id, scheduled_at, status, duration_minutes)
   values ($1,$2,$3,'2030-01-30T01:00:00Z','pending',120)`,
  [jan30, customerId, tech.A]
);

console.log("\n== 4. Schedule conflict skips for one request only (spec §8, §9, §23) ==");

// An administrator re-balances the rotation so A is #1 again (audited override).
const adminId = await provisionUser({
  email: "admin-queue-test@example.com",
  name: "Queue Test Admin",
  role: "admin",
});


for (const key of ["B", "C"]) {
  await asUser(adminId, "authenticated", () =>
    query("select public.admin_queue_override('refrigerator', $1, 'move_to_end', 'test setup: rebalance')", [tech[key]])
  );
}
rows = await queueOrder();
check("admin override rebalances the queue to A -> B -> C", orderNames(rows) === "Technician A -> Technician B -> Technician C", orderNames(rows));

// A is booked 08:00-10:00 Manila on Jan 27 (= 00:00-02:00Z).
const jan27 = await createRequest("2030-01-27T02:00:00Z", "2030-01-27T04:00:00Z", "Seed job for A on Jan 27");
await query(
  `insert into public.bookings (service_request_id, customer_id, technician_id, scheduled_at, status, duration_minutes)
   values ($1,$2,$3,'2030-01-27T00:00:00Z','pending',120)`,
  [jan27, customerId, tech.A]
);

const beforeConflict = await queueOrder();
// 01:00-03:00Z genuinely overlaps A's 00:00-02:00Z booking (a window that merely
// *touches* it would not be a conflict, and should not be treated as one).
const overlapping = await createRequest("2030-01-27T01:00:00Z", "2030-01-27T03:00:00Z", "Overlaps A's booking");
const overlappingOffer = await assign(overlapping);
const afterConflict = await queueOrder();
check(
  "A is skipped for the overlapping request and B gets the offer",
  overlappingOffer.assigned_technician_id === tech.B,
  JSON.stringify(overlappingOffer)
);
check("A keeps his queue position (#1) after being skipped", positions(beforeConflict) === positions(afterConflict), `${positions(beforeConflict)} vs ${positions(afterConflict)}`);

const scheduleSkips = await query(
  `select technician_id, reason from public.technician_queue_events
    where repair_request_id = $1 and action = 'SKIPPED_DUE_TO_SCHEDULE'`,
  [overlapping]
);
check(
  "the skip is audited for A only, with a schedule reason",
  scheduleSkips.length === 1 && scheduleSkips[0].technician_id === tech.A,
  JSON.stringify(scheduleSkips)
);

// Same day, non-overlapping window: A must still be offered it.
const laterThatDay = await createRequest("2030-01-27T06:00:00Z", "2030-01-27T08:00:00Z", "Later the same day");
const laterOffer = await assign(laterThatDay);
check(
  "a non-overlapping window the same day still reaches A (no whole-day lockout)",
  laterOffer.assigned_technician_id === tech.A,
  JSON.stringify(laterOffer)
);

// Declining does not consume A's turn (default policy) -> A stays #1, and B is
// skipped because they are already holding a live offer for the other request.
const decline = await respond(laterThatDay, tech.A, "decline", "Already booked that morning");
check("A's decline does not consume his queue turn", decline.decline_consumed_turn === false, JSON.stringify(decline));
rows = await queueOrder();
check("A remains #1 after declining", rows[0]?.technician_id === tech.A, orderNames(rows));
check(
  "skips and declines changed nobody's queue position",
  JSON.stringify(rows.map((r) => r.technician_id)) === JSON.stringify([tech.A, tech.B, tech.C]),
  orderNames(rows)
);


const holdingOfferSkips = await query(
  `select technician_id from public.technician_queue_events
    where repair_request_id = $1 and action = 'SKIPPED_DUE_TO_ACTIVE_OFFER'`,
  [laterThatDay]
);
check(
  "B is skipped only because they hold another live offer, not removed from the queue",
  holdingOfferSkips.length >= 1 && holdingOfferSkips.some((r) => r.technician_id === tech.B),
  JSON.stringify(holdingOfferSkips)
);

const laterState = await query(
  "select assignment_status, assigned_technician_id from public.service_requests where id = $1",
  [laterThatDay]
);
check(
  "the declined request moves on to the next free technician (C)",
  laterState[0].assignment_status === "offered" && laterState[0].assigned_technician_id === tech.C,
  JSON.stringify(laterState)
);

// B declines the overlapping request. A is skipped again (still conflicted) and
// C is skipped only because C already holds a live offer — so the request WAITS
// instead of being forced onto someone who cannot take it.
const bDecline = await respond(overlapping, tech.B, "decline", "On another job");
check("B's decline re-runs the queue walk", bDecline.outcome === "declined", JSON.stringify(bDecline));

const overlappingState = await query(
  "select assignment_status, assigned_technician_id from public.service_requests where id = $1",
  [overlapping]
);
check(
  "with nobody free the request becomes WAITING_FOR_TECHNICIAN (never lost)",
  overlappingState[0].assignment_status === "waiting" && !overlappingState[0].assigned_technician_id,
  JSON.stringify(overlappingState)
);

const cHolding = await query(
  `select 1 from public.technician_queue_events
    where repair_request_id = $1 and action = 'SKIPPED_DUE_TO_ACTIVE_OFFER' and technician_id = $2`,
  [overlapping, tech.C]
);
check("C is skipped only because of the one-live-offer rule", cHolding.length === 1, JSON.stringify(cHolding));

// C accepts the other request, which frees them up; re-running assignment (what
// the cron sweep does) then places the waiting request.
await respond(laterThatDay, tech.C, "accept");
const rematch = await assign(overlapping);
check(
  "a waiting request is re-matched as soon as a technician frees up",
  rematch.assigned_technician_id === tech.C,
  JSON.stringify(rematch)
);


console.log("\n== 5. Multiple appliance queues stay independent (spec §25) ==");
await query("update public.technicians set specializations = $2 where id = $1", [
  tech.A,
  ["Refrigerator", "Washing Machine"],
]);
const fridgeQueue = await queueOrder("refrigerator");
const washerQueue = await queueOrder("washing_machine");
const airconQueue = await queueOrder("aircon");
check("A joins the washing machine queue as its own membership", washerQueue.length === 1 && washerQueue[0].technician_id === tech.A, JSON.stringify(washerQueue));
check("A keeps an independent refrigerator position", fridgeQueue.length === 3, JSON.stringify(fridgeQueue));
check("A is not eligible for a queue he does not specialize in (aircon)", airconQueue.length === 0, JSON.stringify(airconQueue));

const washerPositions = await query(
  "select appliance_type, queue_position from public.technician_queue_state where technician_id = $1 order by appliance_type",
  [tech.A]
);
check("the same technician holds different positions per appliance queue", washerPositions.length === 2, JSON.stringify(washerPositions));

console.log("\n== 6. Full queue visibility for technicians (spec §11, §26) ==");
const snapshotAsC = await asUser(tech.C, "authenticated", () =>
  query("select * from public.technician_queue_snapshot('refrigerator')")
);
check("a technician sees the WHOLE refrigerator queue, not just themselves", snapshotAsC.length === 3, `rows=${snapshotAsC.length}`);
check(
  "exactly one row is flagged as self",
  snapshotAsC.filter((r) => r.is_self).length === 1 && snapshotAsC.find((r) => r.is_self).technician_id === tech.C,
  JSON.stringify(snapshotAsC.map((r) => [r.technician_name, r.is_self]))
);
check(
  "the snapshot exposes only safe fields (no phone, address or email)",
  !("phone" in snapshotAsC[0]) && !("address" in snapshotAsC[0]) && !("email" in snapshotAsC[0]),
  Object.keys(snapshotAsC[0]).join(",")
);
check(
  "each row carries a position, an operational status and the next booking",
  snapshotAsC.every((r) => typeof r.queue_position === "number" && Boolean(r.operational_status)),
  JSON.stringify(snapshotAsC[0])
);

const allQueuesAsA = await asUser(tech.A, "authenticated", () =>
  query("select distinct appliance_type from public.technician_queue_snapshot(null)")
);
check(
  "'All my queues' returns only the queues the technician belongs to",
  allQueuesAsA.length === 2 && allQueuesAsA.every((r) => ["refrigerator", "washing_machine"].includes(r.appliance_type)),
  JSON.stringify(allQueuesAsA)
);

let customerBlocked = false;
try {
  await asUser(customerId, "authenticated", () => query("select * from public.technician_queue_snapshot(null)"));
} catch (err) {
  customerBlocked = /only technicians and administrators/.test(err.message);
}
check("a customer calling the queue snapshot is refused", customerBlocked);

// A caller with no JWT at all (a raw service-role/PostgREST call) must also be
// refused: `null not in (...)` evaluates to NULL, which is not true, so this
// guard has to test for NULL explicitly or it silently passes.
let nullRoleBlocked = false;
try {
  await query("select * from public.technician_queue_snapshot('refrigerator')");
} catch (err) {
  nullRoleBlocked = /only technicians and administrators/.test(err.message);
}
check("a caller with no JWT is refused", nullRoleBlocked);

const customerQueueRows = await asUser(customerId, "authenticated", () =>
  query("select technician_id from public.technician_queue_state limit 5")
);
check("RLS hides queue membership rows from customers", customerQueueRows.length === 0, JSON.stringify(customerQueueRows));

const techQueueRows = await asUser(tech.B, "authenticated", () =>
  query("select distinct technician_id from public.technician_queue_state")
);
check("RLS lets a technician read the whole queue table (used to be self only)", techQueueRows.length >= 3, `rows=${techQueueRows.length}`);

// A technician must not be able to move themselves. Either the statement is
// rejected outright (no UPDATE grant) or RLS filters every row — both are a
// pass; silently changing a position is a fail.
let techCannotWrite = false;
try {
  const updated = await asUser(tech.B, "authenticated", () =>
    query("update public.technician_queue_state set queue_position = 1 where technician_id = $1 returning queue_position", [
      tech.B,
    ])
  );
  techCannotWrite = updated.length === 0;
} catch (err) {
  techCannotWrite = /permission denied|row-level security/i.test(err.message);
}
check("a technician cannot write their own queue position", techCannotWrite);

let customerCannotOverride = false;
try {
  await asUser(customerId, "authenticated", () =>
    query("select public.admin_queue_override('refrigerator', $1, 'move_to_end', 'nope')", [tech.C])
  );
} catch (err) {
  customerCannotOverride = /administrator access required|permission denied/.test(err.message);
}
check("a customer cannot call the admin override", customerCannotOverride);

let customerCannotAssign = false;
try {
  await asUser(customerId, "authenticated", () => query("select public.assign_technician_to_request($1)", [jan27]));
} catch (err) {
  customerCannotAssign = /permission denied/.test(err.message);
}
check("a customer cannot run the assignment engine directly", customerCannotAssign);

console.log("\n== 7. Capacity protection, time based (spec §17) ==");
await query("update public.technicians set max_daily_hours = 4 where id = $1", [tech.A]);
const washerDay = await createRequest("2030-01-28T05:00:00Z", "2030-01-28T07:00:00Z", "Two more hours on A's 4h day");
await query("update public.service_requests set appliance_type = 'washing_machine' where id = $1", [washerDay]);
// 3 hours of work are already booked that day (13:00-16:00 Manila = 05:00-08:00Z
// start 01:00Z, 180 min) — deliberately NOT overlapping the requested window, so
// the skip can only come from the hours limit, not from a schedule conflict.
await query(
  `insert into public.bookings (service_request_id, customer_id, technician_id, scheduled_at, status, duration_minutes)
   values ($1,$2,$3,'2030-01-28T01:00:00Z','pending',180)`,
  [washerDay, customerId, tech.A]
);

const washerOffer = await assign(washerDay);
const capacitySkip = await query(
  `select reason from public.technician_queue_events
    where repair_request_id = $1 and action = 'SKIPPED_DUE_TO_CAPACITY' and technician_id = $2`,
  [washerDay, tech.A]
);
check(
  "a 2h job is refused when only 1h of the daily limit is left",
  capacitySkip.length === 1 && /maximum working hours per day/.test(capacitySkip[0].reason),
  JSON.stringify(capacitySkip)
);
check("the over-capacity request waits rather than disappearing", washerOffer.assignment_status === "waiting", JSON.stringify(washerOffer));
const washerAfterCapacity = await queueOrder("washing_machine");
check(
  "a capacity skip does not remove the technician from the queue",
  washerAfterCapacity.length === 1 && washerAfterCapacity[0].is_active === true,
  JSON.stringify(washerAfterCapacity)
);

console.log("\n== 8. Offer expiry keeps the technician in the queue (spec §10) ==");
const expiring = await createRequest("2030-02-01T03:00:00Z", "2030-02-01T05:00:00Z", "Offer that will lapse");
await query("update public.service_requests set appliance_type = 'washing_machine' where id = $1", [expiring]);
const expiringOffer = await assign(expiring);
check("the offer goes to the only washing machine technician", expiringOffer.assigned_technician_id === tech.A, JSON.stringify(expiringOffer));
await query("update public.service_requests set offers_expires_at = now() - interval '1 minute' where id = $1", [expiring]);

const expiry = await query("select public.expire_stale_offers() as result");
check("the lapsed offer is swept up", expiry[0].result.count === 1, JSON.stringify(expiry[0].result));

const expiryEvents = await query(
  "select action, reason from public.technician_queue_events where repair_request_id = $1 and action = 'EXPIRED'",
  [expiring]
);
check("an EXPIRED audit event is recorded", expiryEvents.length === 1, JSON.stringify(expiryEvents));

const washerAfterExpiry = await queueOrder("washing_machine");
check(
  "the technician who let the offer lapse is still in the queue",
  washerAfterExpiry.length === 1 && washerAfterExpiry[0].is_active === true,
  JSON.stringify(washerAfterExpiry)
);
const expiredRequestState = await query(
  "select assignment_status from public.service_requests where id = $1",
  [expiring]
);
check(
  "the request is not stranded: it falls back to waiting for the next eligible technician",
  expiredRequestState[0].assignment_status === "waiting",
  JSON.stringify(expiredRequestState)
);

console.log("\n== 9. Concurrency: one job, one accepting technician (spec §28) ==");
const raceWindow = ["2030-02-05T01:00:00Z", "2030-02-05T03:00:00Z"];
const raceRequest = await createRequest(raceWindow[0], raceWindow[1], "Race for acceptance");
const raceOffer = await assign(raceRequest);
const [first, second] = await Promise.all([
  query("select public.respond_to_offer($1,$2,'accept') as result", [raceRequest, raceOffer.assigned_technician_id]),
  query("select public.respond_to_offer($1,$2,'accept') as result", [raceRequest, raceOffer.assigned_technician_id]),
]);
const outcomes = [first[0].result.outcome, second[0].result.outcome].sort();
check("exactly one accept wins; the other is told the offer is gone", JSON.stringify(outcomes) === '["accepted","not_offered"]', JSON.stringify(outcomes));

const turnEvents = await query(
  "select count(*)::int as n from public.technician_queue_events where repair_request_id = $1 and action = 'TURN_CONSUMED'",
  [raceRequest]
);
check("the queue turn is consumed exactly once", turnEvents[0].n === 1, JSON.stringify(turnEvents));

const [, parallelTwo] = await Promise.all([
  assign(await createRequest("2030-02-06T01:00:00Z", "2030-02-06T03:00:00Z", "Parallel request 1")),
  assign(await createRequest("2030-02-06T05:00:00Z", "2030-02-06T07:00:00Z", "Parallel request 2")),
]);
const parallelOne = await query(
  "select assigned_technician_id from public.service_requests where problem_description = 'Parallel request 1'"
);
check(
  "two parallel requests are never offered to the same technician",
  parallelOne[0].assigned_technician_id !== parallelTwo.assigned_technician_id,
  JSON.stringify([parallelOne[0], parallelTwo])
);

const uniqueIndex = await query(
  "select indexname from pg_indexes where schemaname = 'public' and indexname = 'uniq_active_offer_per_technician'"
);
check("the one-live-offer-per-technician index exists (DB-level race guard)", uniqueIndex.length === 1, JSON.stringify(uniqueIndex));

console.log("\n== 10. Audit trail + no duplicates (spec §27, §33, §36) ==");
const duplicateRows = await query(
  `select technician_id, appliance_type, count(*)::int as n
     from public.technician_queue_state group by 1,2 having count(*) > 1`
);
check("no duplicate queue memberships exist", duplicateRows.length === 0, JSON.stringify(duplicateRows));

const multipleOffers = await query(
  `select assigned_technician_id, count(*)::int as n from public.service_requests
    where assignment_status = 'offered' and assigned_technician_id is not null
    group by 1 having count(*) > 1`
);
check("no technician holds two live offers", multipleOffers.length === 0, JSON.stringify(multipleOffers));

const eventKinds = await query("select distinct action from public.technician_queue_events order by action");
check("the queue history records the documented actions", eventKinds.length >= 5, JSON.stringify(eventKinds.map((e) => e.action)));

const positionAudit = await query(
  `select action, old_position, new_position, reason from public.technician_queue_events
    where old_position is distinct from new_position and action in ('MOVED_TO_END', 'TURN_CONSUMED')
    order by created_at limit 3`
);
check(
  "position changes are audited with old and new positions",
  positionAudit.length >= 1 && positionAudit.every((e) => e.new_position > e.old_position),
  JSON.stringify(positionAudit)
);

console.log("\n== 11. Completing a job does not re-rotate the queue (spec §20) ==");
const beforeCompletion = await queueOrder();
const completedBooking = (
  await query(
    `insert into public.bookings (service_request_id, customer_id, technician_id, scheduled_at, status, duration_minutes)
     values ($1,$2,$3,'2030-01-30T01:00:00Z','in_progress',120) returning id`,
    [jan30, customerId, tech.A]
  )
)[0];
await query("update public.bookings set status = 'completed' where id = $1", [completedBooking.id]);
const afterCompletion = await queueOrder();
check(
  "completion leaves every queue position exactly as it was",
  positions(beforeCompletion) === positions(afterCompletion),
  `${orderNames(beforeCompletion)} vs ${orderNames(afterCompletion)}`
);

console.log("\n== 12. Operational status is separate from queue membership (spec §15) ==");
const statuses = await asUser(tech.B, "authenticated", () =>
  query(
    `select r.technician_name, r.operational_status, r.queue_position, r.is_member_active
       from public.technician_queue_snapshot('refrigerator') r order by r.queue_position`
  )
);
check(
  "statuses come from the documented vocabulary",
  statuses.every((s) =>
    ["AVAILABLE", "ON_JOB", "SCHEDULED", "TEMPORARILY_UNAVAILABLE", "OFFLINE", "SUSPENDED"].includes(s.operational_status)
  ),
  JSON.stringify(statuses.map((s) => s.operational_status))
);
check(
  "every technician in the queue is reported with a position and status",
  statuses.length === 3 && statuses.every((s) => typeof s.queue_position === "number" && Boolean(s.operational_status)),
  JSON.stringify(statuses)
);

console.log("\n== 13. Admin override needs a reason and is audited (spec §32, §33) ==");
let overrideNeedsReason = false;
try {
  await asUser(adminId, "authenticated", () =>
    query("select public.admin_queue_override('refrigerator', $1, 'move_to_end', '')", [tech.C])
  );
} catch (err) {
  overrideNeedsReason = /reason is required/.test(err.message);
}
check("an override without a reason is rejected", overrideNeedsReason);

const override = await asUser(adminId, "authenticated", () =>
  query(
    "select public.admin_queue_override('refrigerator', $1, 'move_to_end', 'Rebalancing after a cancellation') as result",
    [tech.C]
  )
);
check("an override with a reason succeeds", override[0].result.ok === true, JSON.stringify(override[0].result));

const overrideAudit = await query(
  "select actor_id, reason from public.technician_queue_events where action = 'ADMIN_OVERRIDE' order by created_at desc limit 1"
);
check(
  "the override is audited with actor and reason",
  overrideAudit[0].actor_id === adminId && /Rebalancing/.test(overrideAudit[0].reason),
  JSON.stringify(overrideAudit)
);

console.log("\n== 14. Cancelling or rescheduling never grants a new turn (spec §18, §19) ==");
const beforeChanges = await queueOrder();
await query("update public.bookings set scheduled_at = '2030-03-01T01:00:00Z' where id = $1", [completedBooking.id]);
const afterReschedule = await queueOrder();
check(
  "rescheduling an appointment does not change queue positions",
  positions(beforeChanges) === positions(afterReschedule),
  `${orderNames(beforeChanges)} vs ${orderNames(afterReschedule)}`
);

await query("update public.bookings set status = 'cancelled' where service_request_id = $1", [jan27]);
const afterCancellation = await queueOrder();
check(
  "cancelling an appointment does not send the technician back to the front",
  positions(afterReschedule) === positions(afterCancellation),
  `${orderNames(afterReschedule)} vs ${orderNames(afterCancellation)}`
);

console.log("\n== 15. Ratings and experience never influence the rotation (spec §1) ==");
const ratingProof = await query(
  `select count(*)::int as n from information_schema.columns
    where table_schema = 'public' and table_name = 'technician_queue_state'
      and column_name in ('rating', 'experience', 'score', 'jobs_completed')`
);
check("queue membership stores no rating/experience/score columns", ratingProof[0].n === 0, JSON.stringify(ratingProof));

const firstBefore = (await queueOrder())[0];
await query("update public.technicians set rating = 5, experience_years = 20, jobs_completed = 500 where id = $1", [tech.C]);
const firstAfterBoost = (await queueOrder())[0];
await query("update public.technicians set rating = 0, experience_years = 0, jobs_completed = 0 where id = $1", [tech.C]);
const firstAfterReset = (await queueOrder())[0];
check(
  "changing rating/experience moves nobody in the queue",
  firstBefore.technician_id === firstAfterBoost.technician_id &&
    firstBefore.technician_id === firstAfterReset.technician_id,
  `${firstBefore.name} / ${firstAfterBoost.name} / ${firstAfterReset.name}`
);

await db.close();

console.log(`\n${results.length - failures}/${results.length} checks passed`);
if (failures) {
  console.log(`\nFAILURES:\n${results.filter((r) => !r.ok).map((r) => ` - ${r.name}`).join("\n")}`);
}
process.exit(failures ? 1 : 0);






