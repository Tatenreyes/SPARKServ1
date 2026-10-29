import { NextResponse } from "next/server";
import { RECOVERY_COOKIE_NAME, recoveryCookieOptions } from "@/lib/auth/recovery";

/**
 * Ends recovery authorization for this browser.
 *
 * The update form calls this immediately after a successful password change, so
 * the marker leaves the cookie jar instead of lingering for the rest of its 15
 * minutes. It clears one fixed cookie and returns a constant body:
 *
 *   - it cannot grant anything — deleting an authorization cannot authorize;
 *   - it takes no parameters, so there is no value to point at another account;
 *   - it needs no session, because a request without one has nothing to clear,
 *     and requiring a session would only make the call fail in the exact case it
 *     matters most (the form signs the recovery session out at the same moment).
 *
 * The real guarantee is not this endpoint: the marker is bound to the session id
 * (`isRecoveryAuthorized`), so it is already unusable once that session ends.
 * This is the tidy half of "cleared *or* invalidated".
 */
export const dynamic = "force-dynamic";

export async function DELETE() {
  const response = NextResponse.json({ ok: true });

  response.cookies.set(RECOVERY_COOKIE_NAME, "", {
    ...recoveryCookieOptions(),
    maxAge: 0,
  });

  return response;
}