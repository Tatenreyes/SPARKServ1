#!/usr/bin/env node
/**
 * SPARKServ assignment sweep — `npm run cron:tick`
 * ================================================
 *
 * Runs the same two maintenance steps as `GET /api/cron/assignment-tick`, without
 * needing the dev server:
 *
 *   1. `expire_stale_offers()`       — lapses offers past their TTL, re-offers
 *                                      their requests, keeps every queue position
 *   2. re-match every `waiting` request — the state a request lands in when no
 *                                      eligible technician was free
 *
 * Why this exists: in production Vercel Cron calls the route every 5 minutes
 * (`vercel.json`), but locally nothing does. Ignored offers then accumulate, and
 * because `uniq_active_offer_per_technician` counts a lapsed-but-unswept offer as
 * live, the rotation looks jammed ("Waiting for an eligible technician" with no
 * offer sent to anyone). The engine now releases a lapsed offer before each walk,
 * so a *new* request is never blocked — this command is how you hand the older
 * requests back to the queue in one step.
 *
 * Usage:
 *   npm run cron:tick             apply the sweep
 *   npm run cron:tick -- --dry-run   report what would change, touch nothing
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (from
 * .env.local). It mutates the project it points at — that is what a sweep is —
 * so point .env.local at the project you mean.
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
const dryRun = process.argv.includes("--dry-run");

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

async function staleOffers() {
  const { data, error } = await admin
    .from("service_requests")
    .select("id, appliance_type, assigned_technician_id, offers_expires_at")
    .eq("assignment_status", "offered")
    .lte("offers_expires_at", new Date().toISOString());
  if (error) throw error;
  return data ?? [];
}

async function waitingRequests() {
  const { data, error } = await admin
    .from("service_requests")
    .select("id, appliance_type, created_at")
    .eq("assignment_status", "waiting")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

async function main() {
  console.log(`SPARKServ assignment sweep`);
  console.log(`Project: ${SUPABASE_URL}${dryRun ? "  (dry run — nothing will change)" : ""}\n`);

  const stale = await staleOffers();
  const waiting = await waitingRequests();

  console.log(`Offers past their TTL : ${stale.length}`);
  for (const offer of stale) {
    console.log(`  ${offer.id.slice(0, 8)}  ${offer.appliance_type}  expired ${offer.offers_expires_at}`);
  }
  console.log(`\nRequests waiting for a technician : ${waiting.length}`);
  for (const request of waiting) {
    console.log(`  ${request.id.slice(0, 8)}  ${request.appliance_type}  created ${request.created_at}`);
  }

  if (dryRun) {
    console.log("\nDry run: no changes made.");
    return;
  }

  // 1. Lapse the lapsed offers and re-offer their requests.
  const { data: expired, error: expireError } = await admin.rpc("expire_stale_offers");
  if (expireError) throw expireError;
  console.log(`\nLapsed ${expired?.count ?? 0} offer(s) and re-offered their requests.`);

  // 2. Re-run assignment for everything still waiting. Sequential on purpose:
  //    each walk takes the request's row lock, and the rotation must stay fair.
  let offered = 0;
  let stillWaiting = 0;
  for (const request of waiting) {
    const { data, error } = await admin.rpc("assign_technician_to_request", {
      p_request_id: request.id,
    });
    if (error) {
      console.error(`  ${request.id.slice(0, 8)}  FAILED: ${error.message}`);
      continue;
    }
    if (data?.outcome === "offered") {
      offered += 1;
      console.log(`  ${request.id.slice(0, 8)}  offered to ${String(data.assigned_technician_id).slice(0, 8)} (queue #${data.queue_position})`);
    } else {
      stillWaiting += 1;
      console.log(`  ${request.id.slice(0, 8)}  still waiting — ${JSON.stringify(data?.skipped ?? [])}`);
    }
  }

  console.log(`\nDone. Offered now: ${offered}. Still waiting: ${stillWaiting}.`);
  console.log("Queue positions are untouched by a sweep — nobody is removed for ignoring an offer.");
}

main().catch((error) => {
  console.error(`\nSweep failed: ${error.message ?? error}`);
  process.exit(1);
});
