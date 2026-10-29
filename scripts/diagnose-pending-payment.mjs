#!/usr/bin/env node
/**
 * SPARKServ — READ-ONLY diagnosis: "a pending payment does not appear at /admin/payments"
 * =========================================================
 *
 * This script performs SELECTs only. It never inserts, updates, deletes, or calls a
 * mutating RPC, so it is safe to run against the live project.
 *
 * It answers, in order:
 *   1. Which ROLE does the key in .env.local actually authenticate as? (a service-role
 *      key and an anon key are both JWTs; only the payload says which is which)
 *   2. Does the EXACT admin-page query succeed, and what does it return?
 *   3. Does the admin-page stat-card count query succeed?
 *   4. Do the pending payments exist, and what are their (non-sensitive) columns?
 *   5. Do the bookings they point at exist, and at what status?
 *   6. What happens to the same query when it runs as `anon`?
 *
 * GCash references, tokens and passwords are deliberately NOT printed.
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

/** Decode a JWT payload WITHOUT verifying it. We only read the non-secret claims. */
function jwtClaims(token) {
  try {
    if (token.split(".").length !== 3) {
      // Supabase's newer keys (`sb_publishable_...` / `sb_secret_...`) are opaque
      // strings, not JWTs. Report the prefix only — never the value.
      return { role: `(opaque key, prefix ${token.slice(0, 6)})`, ref: "(n/a)" };
    }
    let payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    while (payload.length % 4) payload += "=";
    const json = Buffer.from(payload, "base64").toString("utf8");
    const claims = JSON.parse(json);
    return { role: claims.role ?? "(none)", ref: claims.ref ?? "(none)" };
  } catch {
    return { role: "(unparseable)", ref: "(unparseable)" };
  }
}

const env = loadEnv();
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(2);
}

console.log("SPARKServ — read-only payment-visibility diagnosis");
console.log("Project:", url);
console.log("");

// ---- 1. Which role is each configured key? -------------------------------------
console.log("-- 1. Configured key identities (JWT `role` claim; no secrets printed)");
const svc = jwtClaims(serviceKey);
const anon = anonKey ? jwtClaims(anonKey) : { role: "(not set)", ref: "(not set)" };
console.log(`   SUPABASE_SERVICE_ROLE_KEY    -> role=${svc.role}  ref=${svc.ref}`);
console.log(`   NEXT_PUBLIC_SUPABASE_ANON_KEY -> role=${anon.role}  ref=${anon.ref}`);
if (svc.role !== "service_role" && !String(svc.role).startsWith("(opaque key")) {
  console.log("   !! The key the admin pages use is NOT a service-role key. Every admin");
  console.log("      page query therefore runs as `" + svc.role + "`.");
}

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

// ---- 2. The EXACT admin-page query ---------------------------------------------
console.log("-- 2. /admin/payments primary query: payments.select('*').order('created_at')");
const pageQuery = await admin
  .from("payments")
  .select("*")
  .order("created_at", { ascending: false });
console.log("   error  :", pageQuery.error ? JSON.stringify(pageQuery.error) : "none");
console.log("   rows   :", pageQuery.data ? pageQuery.data.length : "null");
console.log("");

// ---- 3. The stat-card count query ----------------------------------------------
console.log("-- 3. pending_verification count query (stat card)");
const countQuery = await admin
  .from("payments")
  .select("*", { count: "exact", head: true })
  .eq("status", "pending_verification");
console.log("   error  :", countQuery.error ? JSON.stringify(countQuery.error) : "none");
console.log("   count  :", countQuery.count);
console.log("");

// ---- 4. Every payment row, non-sensitive columns only --------------------------
console.log("-- 4. payments rows (gcash_reference redacted)");
const all = pageQuery.data ?? [];
console.log(`   total rows visible to this client: ${all.length}`);
for (const p of all) {
  console.log(
    `   - id=${p.id} booking_id=${p.booking_id} customer_id=${p.customer_id} ` +
      `status=${p.status} amount=${p.amount} created_at=${p.created_at} ref=<redacted>`
  );
}
console.log("");

// ---- 5. The bookings those payments point at ----------------------------------
const bookingIds = [...new Set(all.map((p) => p.booking_id))];
console.log("-- 5. bookings referenced by those payments");
if (bookingIds.length) {
  const bookings = await admin
    .from("bookings")
    .select("id, customer_id, status, final_cost, service_request_id")
    .in("id", bookingIds);
  console.log("   error  :", bookings.error ? JSON.stringify(bookings.error) : "none");
  for (const b of bookings.data ?? []) {
    console.log(
      `   - id=${b.id} customer_id=${b.customer_id} status=${b.status} final_cost=${b.final_cost}`
    );
  }
} else {
  console.log("   (none)");
}
console.log("");

// ---- 6. The same query as `anon` (what a mis-set key would behave like) --------
console.log("-- 6. Same payments SELECT as `anon` (expect: permission denied)");
if (anonKey) {
  const anonClient = createClient(url, anonKey, { auth: { persistSession: false } });
  const anonQuery = await anonClient
    .from("payments")
    .select("*")
    .order("created_at", { ascending: false });
  console.log("   error  :", anonQuery.error ? JSON.stringify(anonQuery.error) : "none");
  console.log("   rows   :", anonQuery.data ? anonQuery.data.length : "null");
} else {
  console.log("   (no anon key configured)");
}
console.log("");

// ---- 7. users referenced by payments (the page's second query) -----------------
console.log("-- 7. /admin/payments secondary query: users.select('id,name').in('id', customerIds)");
const userIds = [...new Set(all.map((p) => p.customer_id))];
if (userIds.length) {
  const users = await admin.from("users").select("id, name").in("id", userIds);
  console.log("   error  :", users.error ? JSON.stringify(users.error) : "none");
  console.log("   rows   :", users.data ? users.data.length : "null");
} else {
  console.log("   (no payments, so no lookup ran — the page passes an empty array)");
}

if (anon.ref !== "(not set)" && svc.ref !== anon.ref) {
  console.log("   !! The two keys point at DIFFERENT projects (ref mismatch).");
}
console.log("");
