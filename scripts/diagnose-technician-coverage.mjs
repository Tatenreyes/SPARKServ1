#!/usr/bin/env node
/**
 * SPARKServ — READ-ONLY: why a request is "waiting for an eligible technician".
 *
 * The customer-facing copy for `waiting` says "every qualified technician is booked or
 * at capacity for that slot". That is only ONE of the two ways to end up there; the
 * other is that NO approved technician covers the appliance type at all. The two need
 * different answers, so this prints the evidence for both.
 *
 * SELECTs only. Nothing is inserted, updated or assigned.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { normalizeApplianceType } from "../src/lib/queue.ts";

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
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

console.log("SPARKServ — read-only: technician coverage vs the appliance types asked for");
console.log("Project:", env.NEXT_PUBLIC_SUPABASE_URL);
console.log("");

// ---- every technician -----------------------------------------------------------
const technicians =
  (await admin
    .from("technicians")
    .select(
      "id, approved, availability, operational_status, specializations, active_job_load, max_concurrent_jobs, max_jobs_per_day"
    )).data ?? [];

const userIds = technicians.map((t) => t.id);
const users = userIds.length
  ? (await admin.from("users").select("id, name, role, is_active").in("id", userIds)).data ?? []
  : [];
const nameById = new Map(users.map((u) => [u.id, u.name]));

console.log("-- technicians");
if (!technicians.length) console.log("   (none)");
for (const t of technicians) {
  console.log(
    `   - ${(nameById.get(t.id) ?? t.id).padEnd(24)} approved=${String(t.approved).padEnd(5)} ` +
      `available=${String(t.availability).padEnd(5)} status=${String(t.operational_status).padEnd(12)} ` +
      `load=${t.active_job_load}/${t.max_concurrent_jobs} ` +
      `covers=[${(t.specializations ?? []).join(", ")}]`
  );
}
console.log("");

// ---- coverage: which appliance types an APPROVED technician covers --------------
// Normalised with the app's OWN rule (`normalizeApplianceType`, which mirrors
// public.normalize_appliance_type() in the database), so "Vacuum Cleaner" and
// "vacuum_cleaner" are the same appliance here exactly as they are in the queue.
const coverage = new Map();
for (const t of technicians) {
  for (const raw of t.specializations ?? []) {
    const type = normalizeApplianceType(raw) ?? raw;
    const entry = coverage.get(type) ?? { approved: 0, available: 0, names: [], unapproved: [] };
    if (t.approved) {
      entry.approved += 1;
      if (t.availability) entry.available += 1;
      entry.names.push(nameById.get(t.id) ?? t.id);
    } else {
      entry.unapproved.push(nameById.get(t.id) ?? t.id);
    }
    coverage.set(type, entry);
  }
}

console.log("-- appliance types, by whether an APPROVED technician covers them");
if (!coverage.size) console.log("   (none — every request would go to `waiting`)");
for (const [type, entry] of [...coverage.entries()].sort()) {
  console.log(
    `   - ${type.padEnd(20)} approved=${entry.approved} available=${entry.available}` +
      (entry.names.length ? `  [${entry.names.join(", ")}]` : "  [NOBODY]") +
      (entry.unapproved.length ? `  (only unapproved: ${entry.unapproved.join(", ")})` : "")
  );
}
console.log("");

// ---- what customers are actually asking for -------------------------------------
const requests =
  (await admin
    .from("service_requests")
    .select(
      "id, appliance_type, status, assignment_status, created_at, customer_id, assigned_technician_id"
    )
    .order("created_at", { ascending: false })
    .limit(25)).data ?? [];

console.log("-- newest requests, against that coverage");
for (const r of requests) {
  const type = normalizeApplianceType(r.appliance_type) ?? r.appliance_type;
  const entry = coverage.get(type);
  console.log(
    `   - ${String(r.appliance_type).padEnd(20)} (-> ${type.padEnd(18)}) status=${String(r.status).padEnd(10)} ` +
      `assignment=${String(r.assignment_status).padEnd(9)} ${String(r.created_at).slice(0, 16)}`
  );
  console.log(
    `       ${entry
      ? `${entry.approved} approved technician(s) cover it, ${entry.available} currently available`
      : "!! NO APPROVED TECHNICIAN COVERS THIS APPLIANCE TYPE — it can never be matched"}`
  );
}

// ---- the rotation, by appliance type --------------------------------------------
const queue = (await admin.from("technician_queue_state").select("*")).data ?? [];
const byType = new Map();
for (const row of queue) {
  const list = byType.get(row.appliance_type) ?? { active: [], inactive: [] };
  (row.is_active ? list.active : list.inactive).push(nameById.get(row.technician_id) ?? row.technician_id);
  byType.set(row.appliance_type, list);
}

console.log("");
console.log("-- the rotation, per appliance type (only an ACTIVE row can be matched)");
for (const [type, list] of [...byType.entries()].sort()) {
  const flag = list.active.length ? " " : "  !! no active member";
  console.log(
    `   - ${type.padEnd(20)} active=[${list.active.join(", ")}]` +
      `${list.inactive.length ? ` inactive=[${list.inactive.join(", ")}]` : ""}${flag}`
  );
}

// ---- the exact call the API now makes ------------------------------------------
// POST /api/service-requests asks this before it answers, so the customer is told
// "nobody covers this appliance" instead of being left in a queue that cannot move.
console.log("");
console.log("-- appliance_has_qualified_technician() — the call POST /api/service-requests makes");
for (const type of ["Vacuum Cleaner", "Refrigerator", "Microwave Oven", "washing_machine", "Television"]) {
  const { data, error } = await admin.rpc("appliance_has_qualified_technician", {
    p_appliance_type: type,
  });
  console.log(
    `   - ${type.padEnd(18)} -> ${error ? `ERROR ${error.message}` : String(data)}` +
      (error ? "" : data ? "  (covered)" : "  (NOBODY — the customer is told so)")
  );
}


