import { NextResponse, type NextRequest } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { expireStaleOffers, rematchWaitingRequests } from "@/lib/assignment";

export const dynamic = "force-dynamic";

/**
 * GET /api/cron/assignment-tick
 *
 * Scheduled assignment maintenance. Runs two sweeps:
 *   1. expireStaleOffers()     — lapses ignored offers and re-offers the
 *                                request to the next technician in the queue.
 *   2. rematchWaitingRequests() — retries requests that had nobody qualified,
 *                                which is what makes "waiting" temporary
 *                                rather than terminal.
 *
 * Protected by CRON_SECRET. Vercel Cron sends `Authorization: Bearer <secret>`
 * automatically once CRON_SECRET is set as a project env var; any other
 * scheduler can pass the same header (or ?secret=) manually.
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const header = request.headers.get("authorization");
  const querySecret = request.nextUrl.searchParams.get("secret");

  // Refuse to run unprotected in production; allow local dev without a secret.
  if (secret) {
    const authorized = header === `Bearer ${secret}` || querySecret === secret;
    if (!authorized) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured" },
      { status: 500 }
    );
  }

  try {
    const supabase = createServiceRoleClient();

    // Both sweeps are single Postgres transactions: each lapsed offer is marked
    // in the audit trail, the request is re-offered to the next eligible
    // technician, and the technician who ignored the offer KEEPS their queue
    // position (they were never removed — see QUEUE-SYSTEM.md).
    const expiredOffers = await expireStaleOffers(supabase);
    await rematchWaitingRequests(supabase);

    return NextResponse.json({
      data: {
        expired_offers: expiredOffers.count,
        lapsed: expiredOffers.expired,
      },
    });
  } catch (err) {
    console.error("assignment-tick failed:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}