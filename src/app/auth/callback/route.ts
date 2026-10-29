import { NextResponse, type NextRequest } from "next/server";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { Database } from "@/types/database";
import {
  RECOVERY_COOKIE_MAX_AGE_SECONDS,
  RECOVERY_COOKIE_NAME,
  planRecoveryCallback,
  recoveryCookieOptions,
  recoveryFailureRedirectPath,
} from "@/lib/auth/recovery";
import {
  createRecoveryMarker,
  recoveryMarkerSecret,
  sessionIdFromAccessToken,
} from "@/lib/auth/recovery-marker";

/**
 * The one place a recovery link is turned into a session.
 *
 * Supabase emails a link that lands on its own domain; the browser is then sent
 * here, and this route does the part that must happen on the server:
 *
 *   1. `exchangeCodeForSession(code)` — the PKCE exchange. The code is useless
 *      without the code-verifier cookie that `resetPasswordForEmail` wrote in
 *      the browser that requested the email, so a link forwarded to someone
 *      else's machine fails here rather than at the password form.
 *      (`token_hash` + `type=recovery` is the equivalent path for a project
 *      whose email template links straight at the app — see README §3.)
 *   2. It writes the session cookies onto the redirect response.
 *   3. Only on success does it mint the httpOnly recovery marker — a signed
 *      payload naming *this* user and *this* session (see
 *      `src/lib/auth/recovery-marker.ts`), so the authorization it grants dies
 *      with the session it was issued for — and redirect to /update-password.
 *
 * A refused or expired link never reaches /update-password: the visitor is
 * bounced to /forgot-password with a generic notice, and no marker cookie is
 * written. Nothing on this path logs the code, the token hash or the session —
 * the only output is the redirect.
 */
export const dynamic = "force-dynamic";

type PendingCookie = { name: string; value: string; options: CookieOptions };

export async function GET(request: NextRequest) {
  const url = new URL(request.url);

  const plan = planRecoveryCallback({
    code: url.searchParams.get("code"),
    tokenHash: url.searchParams.get("token_hash"),
    type: url.searchParams.get("type"),
    providerError: url.searchParams.get("error_code") ?? url.searchParams.get("error"),
    next: url.searchParams.get("next"),
  });

  if (plan.action === "fail") {
    return NextResponse.redirect(new URL(recoveryFailureRedirectPath(), url.origin));
  }

  /**
   * The session cookies are collected here instead of being written straight to
   * a response, because the redirect target is only known once the exchange has
   * been attempted. `setAll` is called by @supabase/ssr's storage when the
   * SIGNED_IN / PASSWORD_RECOVERY event fires, which is what makes this the
   * supported way to persist the session from a route handler.
   */
  const pendingCookies: PendingCookie[] = [];

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          pendingCookies.push(...cookiesToSet);
        },
      },
    }
  );

  const result =
    plan.action === "exchange_code"
      ? await supabase.auth.exchangeCodeForSession(plan.code)
      : await supabase.auth.verifyOtp({ type: "recovery", token_hash: plan.tokenHash });

  /**
   * The marker is minted from what GoTrue returned for *this* exchange — never
   * from anything in the query string — and names both the user and the session,
   * so it is bound to this recovery and dies with it. `createRecoveryMarker`
   * returns null when it cannot be built (no signing secret, no user, no session
   * id), and a null marker is treated as a refused link below rather than as a
   * reason to let the visitor through.
   */
  const marker = result.error
    ? null
    : createRecoveryMarker(
        {
          userId: result.data.user?.id,
          sessionId: sessionIdFromAccessToken(result.data.session?.access_token),
          expiresAt: Math.floor(Date.now() / 1000) + RECOVERY_COOKIE_MAX_AGE_SECONDS,
        },
        recoveryMarkerSecret()
      );

  const destination = marker ? plan.nextPath : recoveryFailureRedirectPath();
  const response = NextResponse.redirect(new URL(destination, url.origin));

  // Replay what the exchange wrote (including the cleared code-verifier cookie)
  // onto the redirect, which is the response the browser actually keeps.
  pendingCookies.forEach(({ name, value, options }) => {
    response.cookies.set(name, value, options);
  });

  if (marker) {
    response.cookies.set(RECOVERY_COOKIE_NAME, marker, recoveryCookieOptions());
  }

  return response;
}
