import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { RECOVERY_COOKIE_NAME } from "@/lib/auth/recovery";
import {
  isRecoveryAuthorized,
  recoveryMarkerSecret,
  sessionIdFromAccessToken,
} from "@/lib/auth/recovery-marker";

/**
 * The gate behind /update-password, in one place.
 *
 * Three things must line up, and all three come from the server:
 *
 *   1. the marker cookie, which only `/auth/callback` writes and only after a
 *      recovery link was exchanged for a session;
 *   2. the user the auth server says the session belongs to (`getUser()` — the
 *      same validated call the middleware and `src/lib/auth.ts` use); and
 *   3. the `session_id` of that same session, read from the access token
 *      `getUser()` just approved.
 *
 * The marker must name *both* (2) and (3), so it is bound to the session the
 * recovery link created rather than to "anybody logged in":
 *
 *   - a customer who signs out and signs back in normally gets a new session id,
 *     so the marker stops matching even while the cookie is still in the jar;
 *   - a different account signing in in the same browser matches on neither the
 *     user id nor the session id;
 *   - a visitor who merely knows the /update-password URL holds nothing, because
 *     the marker cannot be minted without the server's signing key.
 *
 * A normal logged-in customer therefore cannot open the form by typing the URL,
 * and there is no fallback path that would let one: `isRecoveryAuthorized`
 * refuses everything it does not recognise, including a missing signing secret.
 *
 * Server-only: `next/headers` cannot be imported into a Client Component, and the
 * marker is httpOnly so the browser could not read it anyway.
 */
export async function hasRecoverySession(): Promise<boolean> {
  const marker = cookies().get(RECOVERY_COOKIE_NAME)?.value;
  if (!marker) return false;

  const supabase = createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return false;

  // Read-only, and only *after* `getUser()` validated the session: this names
  // the session that was approved, it does not authorise anything on its own.
  const {
    data: { session },
  } = await supabase.auth.getSession();

  return isRecoveryAuthorized({
    marker,
    userId: user.id,
    sessionId: sessionIdFromAccessToken(session?.access_token),
    secret: recoveryMarkerSecret(),
  });
}
