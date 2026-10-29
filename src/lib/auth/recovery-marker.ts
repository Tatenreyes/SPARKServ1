/**
 * The recovery marker cookie, as a signed token bound to one recovery session.
 *
 * The first version of this feature wrote a constant `"1"` into the cookie and
 * the gate asked only "is there a marker, and is anybody logged in?". That
 * answers the wrong question. The marker outlived the session it was issued for,
 * so for up to 15 minutes after a recovery exchange:
 *
 *   - the account could sign out and sign in normally and the marker still
 *     opened /update-password, and
 *   - a *different* account could sign in in the same browser and the marker
 *     would open /update-password for them.
 *
 * Neither case changes another account's password (`updateUser` acts on the
 * session's own user), but both defeat the rule that the form may only be
 * reached through a recovery link, and both are exactly what "the marker is not
 * bound to the session" means.
 *
 * The marker is therefore a signed payload naming the user *and* the session
 * that the recovery exchange produced:
 *
 *     base64url({"v":1,"u":<user id>,"s":<session id>,"e":<expiry>}).base64url(hmac)
 *
 *  - **Signed**, so a client cannot mint one. This matters: an authenticated
 *    user could otherwise write `sparkserv-recovery=<their own user id>` in
 *    their own browser (the cookie is httpOnly, so it cannot be *replaced* once
 *    set, but it does not exist until a recovery happens) and reach the form
 *    without ever using a recovery link. Every forged, unsigned, truncated or
 *    tampered value is refused, and a missing secret refuses everything rather
 *    than degrading to "trust the cookie".
 *  - **Session-bound**, so it dies with the session it was issued for. Signing
 *    out and back in produces a new `session_id`, and the marker stops matching
 *    even though the cookie is still there — which is what makes the reset
 *    authorization one-use in practice, without server-side state.
 *  - **Self-expiring**, so a cookie kept alive past its `maxAge` is still
 *    refused.
 *
 * The user id is never taken from the browser as authority: it is written from
 * the GoTrue response to the code/token exchange, and re-checked against the
 * user `getUser()` returns. Nothing in this file decides *whose* password is
 * changed — `updateUser({ password })` always acts on the session.
 *
 * Server-only (imports `node:crypto`, which must not reach a client bundle), so
 * `scripts/tests/password-recovery.test.mjs` exercises it directly under Node.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

/** Bumped when the payload shape changes, so previously issued markers stop verifying. */
export const RECOVERY_MARKER_VERSION = 1;

/**
 * Labels the key derivation. The service-role key is used as *key material*
 * rather than as the MAC key itself, so a marker can never be confused with, or
 * turned into, a credential for anything else that uses that secret.
 */
const RECOVERY_MARKER_KEY_LABEL = "sparkserv/recovery-marker/v1";

export interface RecoveryMarkerClaims {
  /**
   * `auth.users.id` the recovery link was exchanged for. Nullable on purpose:
   * an exchange that returned no user must produce no marker, not an empty one.
   */
  userId: string | null | undefined;
  /** The `session_id` claim of the session that exchange created. */
  sessionId: string | null | undefined;
  /** Unix seconds. Mirrors the cookie's own maxAge. */
  expiresAt: number;
}

/**
 * Derives the marker's signing key from a server-only secret.
 *
 * `SUPABASE_SERVICE_ROLE_KEY` is the secret this app already requires on the
 * server (see `.env.example`) and is never exposed to the browser, which is what
 * makes it usable here without adding another variable to configure. Returns
 * null when it is absent, and every caller treats null as "no recovery
 * authorization" — the flow fails closed, it does not fall back to an unsigned
 * cookie.
 *
 * The environment is a parameter so the rule can be exercised without one.
 */
export function recoveryMarkerSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  const keyMaterial = env.SUPABASE_SERVICE_ROLE_KEY;
  if (typeof keyMaterial !== "string" || keyMaterial.length < 16) return null;
  return createHmac("sha256", keyMaterial).update(RECOVERY_MARKER_KEY_LABEL).digest("hex");
}

function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function constantTimeEquals(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function currentSeconds(override?: number): number {
  return typeof override === "number" && Number.isFinite(override)
    ? Math.floor(override)
    : Math.floor(Date.now() / 1000);
}

/**
 * Builds the marker value for a session that a recovery exchange just created.
 *
 * Returns null when it cannot be built — no secret, or a session that carries no
 * id. Callers treat null as "no recovery authorization": the callback refuses to
 * open the form rather than falling back to something unsigned.
 */
export function createRecoveryMarker(
  claims: RecoveryMarkerClaims,
  secret: string | null
): string | null {
  if (!secret) return null;
  if (!claims.userId || !claims.sessionId) return null;
  if (!Number.isFinite(claims.expiresAt)) return null;

  const payload = Buffer.from(
    JSON.stringify({
      v: RECOVERY_MARKER_VERSION,
      u: claims.userId,
      s: claims.sessionId,
      e: Math.floor(claims.expiresAt),
    }),
    "utf8"
  ).toString("base64url");

  return `${payload}.${signPayload(payload, secret)}`;
}

export interface RecoveryAuthorizationInput {
  /** Raw cookie value, straight from the request. */
  marker: string | null | undefined;
  /** `user.id` from a session the auth server validated (`getUser()`). */
  userId: string | null | undefined;
  /** `session_id` claim of that same session. */
  sessionId: string | null | undefined;
  secret: string | null;
  /** Injectable clock, in unix seconds, for tests. */
  nowSeconds?: number;
}

/**
 * The single decision behind /update-password: is this browser, right now,
 * authorized by the recovery link that was exchanged here?
 *
 * Every input comes from the server — the cookie from the request, the user and
 * session id from a validated session, the secret from the environment — so no
 * browser-supplied value is ever authority to change a password. A refusal is
 * the default for every unknown: a missing secret, a missing marker, no
 * validated user, no session id, a malformed or unsigned value, a signature that
 * does not match, an old payload version, an expired payload, or a marker issued
 * for a different user or a different session.
 */
export function isRecoveryAuthorized(input: RecoveryAuthorizationInput): boolean {
  const { marker, userId, sessionId, secret } = input;

  if (!secret || !marker || !userId || !sessionId) return false;

  const parts = marker.split(".");
  if (parts.length !== 2) return false;

  const [payload, signature] = parts;
  if (!payload || !signature) return false;

  // Verify before decoding: an unverified payload is never parsed.
  if (!constantTimeEquals(signature, signPayload(payload, secret))) return false;

  const claims = decodeClaims(payload);
  if (!claims || claims.v !== RECOVERY_MARKER_VERSION) return false;
  if (typeof claims.e !== "number" || claims.e <= currentSeconds(input.nowSeconds)) return false;

  return claims.u === userId && claims.s === sessionId;
}

interface DecodedClaims {
  v?: number;
  u?: string;
  s?: string;
  e?: number;
}

function decodeClaims(payload: string): DecodedClaims | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    return parsed as DecodedClaims;
  } catch {
    return null;
  }
}

/**
 * Reads the `session_id` claim out of an access token.
 *
 * The token is deliberately *not* verified here — the caller has already
 * validated the session with `getUser()`, which is the authoritative check. This
 * only names the session that check approved, so the marker can be bound to that
 * exact session rather than to "whoever happens to be logged in".
 *
 * Returns null for anything that is not a three-part JWT carrying a non-empty
 * string `session_id`, which makes the gate fail closed rather than fall back to
 * a weaker binding.
 */
export function sessionIdFromAccessToken(accessToken: string | null | undefined): string | null {
  if (typeof accessToken !== "string") return null;

  const parts = accessToken.split(".");
  if (parts.length !== 3) return null;

  let claims: { session_id?: unknown };
  try {
    claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }

  const sessionId = claims?.session_id;
  return typeof sessionId === "string" && sessionId.length > 0 ? sessionId : null;
}
