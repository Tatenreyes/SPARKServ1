/**
 * Password recovery — the paths, the recovery-cookie contract, and every
 * decision the callback route and the two forms make.
 *
 * The module is deliberately dependency-free (no React, no Next, no Supabase):
 * the callback route and the components are thin wrappers around it, so the
 * whole decision table — which link is exchangeable, which is expired, which
 * error text is safe to show, which redirect target is allowed — is exercised
 * directly by `scripts/tests/password-recovery.test.mjs`, the same way
 * `src/lib/estimate-costs.ts` is tested.
 *
 * Three security properties are pinned down here rather than in the UI:
 *
 *   1. No message in this file says whether an email address has an account.
 *      `resetPasswordForEmail` answers 200 for unknown addresses too; anything
 *      that leaked "no such user" would turn the form into an enumeration
 *      oracle.
 *   2. `next` is never trusted as an absolute URL. `resolveRecoveryNextPath`
 *      only accepts a single-slash relative path, so
 *      `/auth/callback?next=https://evil.example` is not an open redirect.
 *   3. The recovery gate is an httpOnly marker cookie set by the callback
 *      route, never a query parameter. A visitor who merely knows the
 *      /update-password URL holds nothing.
 */
import { validateNewPassword } from "../password.ts";

// ------------------------------------------------------------------ routes

export const LOGIN_PATH = "/login";
export const FORGOT_PASSWORD_PATH = "/forgot-password";
export const UPDATE_PASSWORD_PATH = "/update-password";
export const RECOVERY_CALLBACK_PATH = "/auth/callback";

// -------------------------------------------------- request-form messages

/**
 * Shown after any validly submitted request. It is deliberately true whether or
 * not the address has an account — that is the whole point of the wording.
 */
export const RESET_REQUEST_SUCCESS_MESSAGE =
  "If an account exists for that email, we've sent a link to reset the password. Check your inbox and your spam folder.";

export const RESET_REQUEST_EMAIL_MESSAGE =
  "Enter a valid email address, for example name@example.com.";

export const RESET_REQUEST_RATE_LIMIT_MESSAGE =
  "Too many reset emails have been requested recently. Wait a few minutes, then try again.";

export const RESET_REQUEST_NETWORK_MESSAGE =
  "Unable to reach the authentication service. Check your internet connection and try again.";

export const RESET_REQUEST_GENERIC_MESSAGE =
  "We couldn't send the reset email just now. Please try again in a moment.";

// ------------------------------------------------- update-password messages

export const PASSWORD_UPDATE_SESSION_MESSAGE =
  "Your reset link is no longer valid. Request a new link and try again.";

export const PASSWORD_UPDATE_SAME_MESSAGE =
  "That is already your current password. Choose a different one.";

export const PASSWORD_UPDATE_WEAK_MESSAGE =
  "That password was rejected by the password policy. Try a longer, less predictable password.";

export const PASSWORD_UPDATE_GENERIC_MESSAGE =
  "We couldn't update your password just now. Please try again.";

/** Copy for the panel shown when /update-password is opened without the gate. */
export const RECOVERY_SESSION_MISSING_MESSAGE =
  "This password reset link is invalid or has expired, or it has already been used. Request a new link to continue.";

// ----------------------------------------------------------------- the gate

/**
 * Recovery-authorization cookie, written only by `/auth/callback` and only after
 * a recovery link has been exchanged for a session. It is httpOnly because
 * nothing in the browser needs to read it, and short-lived because it only has
 * to survive one trip to /update-password.
 *
 * The value is deliberately *not* a constant: it is a signed payload naming the
 * user and the session the exchange created (see
 * `src/lib/auth/recovery-marker.ts`), so it cannot be minted by a client and it
 * stops matching the moment the session it was issued for ends.
 */
export const RECOVERY_COOKIE_NAME = "sparkserv-recovery";
export const RECOVERY_COOKIE_MAX_AGE_SECONDS = 15 * 60;

/**
 * Ends recovery authorization for this browser: the update form `DELETE`s it
 * immediately after a successful password change, so the marker does not sit in
 * the cookie jar for the rest of its 15 minutes.
 */
export const RECOVERY_CLEAR_PATH = "/api/auth/recovery";

export interface RecoveryCookieOptions {
  path: string;
  httpOnly: boolean;
  sameSite: "lax" | "strict" | "none";
  secure: boolean;
  maxAge: number;
}

export function recoveryCookieOptions(): RecoveryCookieOptions {
  return {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    // Local development runs on http://localhost, where a Secure cookie is
    // dropped by the browser and the gate would always fail.
    secure: process.env.NODE_ENV === "production",
    maxAge: RECOVERY_COOKIE_MAX_AGE_SECONDS,
  };
}

// ------------------------------------------------------ callback planning

export type RecoveryCallbackPlan =
  | { action: "exchange_code"; code: string; nextPath: string }
  | { action: "verify_token"; tokenHash: string; nextPath: string }
  | { action: "fail" };

export interface RecoveryCallbackParams {
  code: string | null;
  tokenHash: string | null;
  type: string | null;
  providerError: string | null;
  next: string | null;
}

/**
 * Decides what the callback route should do with the query string Supabase sent
 * back, without performing any I/O.
 *
 *  - `code` is the PKCE parameter. The default "Reset Password" template links
 *    to `{{ .ConfirmationURL }}`, Supabase verifies the token on its own domain
 *    and redirects here with a single-use code that must be exchanged against
 *    the code-verifier cookie this browser set when it asked for the email.
 *  - `token_hash` is the alternative for a project whose template links straight
 *    at the app (`{{ .TokenHash }}`). Only `type=recovery` is accepted, so a
 *    signup or email-change token can never be spent on a password reset.
 *  - An `error` / `error_code` means Supabase already refused the token
 *    (expired, already used, revoked). It is not retried — the visitor is sent
 *    back to request a fresh link.
 */
export function planRecoveryCallback(params: RecoveryCallbackParams): RecoveryCallbackPlan {
  const nextPath = resolveRecoveryNextPath(params.next);

  if (params.providerError) return { action: "fail" };

  if (params.code) {
    return { action: "exchange_code", code: params.code, nextPath };
  }

  const type = (params.type ?? "").trim().toLowerCase();
  if (params.tokenHash && type === "recovery") {
    return { action: "verify_token", tokenHash: params.tokenHash, nextPath };
  }

  return { action: "fail" };
}

/** Where a refused or expired recovery link lands. */
export function recoveryFailureRedirectPath(): string {
  return `${FORGOT_PASSWORD_PATH}?${RECOVERY_ERROR_PARAM}=${RECOVERY_LINK_INVALID}`;
}

// --------------------------------------------------------- request notices

/** Query parameter the callback uses to hand a failure back to the form. */
export const RECOVERY_ERROR_PARAM = "error";
export const RECOVERY_LINK_INVALID = "link_invalid";

/**
 * The banner copy for a bounced recovery link, or null when the form was opened
 * normally. Unknown codes are ignored rather than echoed, so the page never
 * renders text chosen by whoever wrote the URL.
 */
export function recoveryLinkNotice(code: string | null | undefined): string | null {
  if (code === RECOVERY_LINK_INVALID) {
    return "That password reset link is invalid or has expired. Enter your email to request a new one.";
  }
  return null;
}

// ------------------------------------------------------------ redirect URLs

/**
 * The `redirectTo` handed to `resetPasswordForEmail`.
 *
 * Built from the origin the request was made on (not a hard-coded host) so one
 * build works on localhost, on the production domain and on a Vercel preview —
 * each of which must be listed under Authentication → URL Configuration →
 * Redirect URLs, because Supabase refuses an unlisted target.
 *
 * The emailed link never points straight at /update-password: it goes through
 * /auth/callback so the PKCE code is exchanged server-side and the recovery
 * marker cookie is only set once that exchange has succeeded.
 */
export function buildRecoveryRedirectTo(origin: string): string {
  const base = origin.replace(/\/+$/, "");
  return `${base}${RECOVERY_CALLBACK_PATH}?next=${encodeURIComponent(UPDATE_PASSWORD_PATH)}`;
}

/** True for a same-site path only: `/x`, never `//host`, `/\host` or `https://host`. */
export function isSafeRelativePath(value: string | null | undefined): boolean {
  if (typeof value !== "string" || value.length === 0) return false;
  if (!value.startsWith("/")) return false;
  if (value.startsWith("//")) return false;
  if (value.includes("\\")) return false;
  return true;
}

/** The requested `next`, or /update-password when it is missing or unsafe. */
export function resolveRecoveryNextPath(value: string | null | undefined): string {
  return isSafeRelativePath(value) ? (value as string) : UPDATE_PASSWORD_PATH;
}

// ------------------------------------------------------------ error mapping

/** The shape both a Supabase `AuthError` and a thrown `TypeError` satisfy. */
export interface AuthFailureShape {
  name?: string;
  message?: string;
  code?: string | null;
  status?: number;
}

function isNetworkFailure(error: AuthFailureShape): boolean {
  return (
    error.name === "TypeError" ||
    /failed to fetch|fetch failed|networkerror|network request failed/i.test(error.message ?? "")
  );
}

/**
 * Turns a `resetPasswordForEmail` failure into copy for the form.
 *
 * Only three failures are ever named — bad format, rate limit, unreachable
 * service — and none of them depends on whether the address exists. Everything
 * else collapses into one generic sentence, which is what keeps the form from
 * becoming an account-enumeration oracle.
 */
export function describeResetRequestError(error: AuthFailureShape | null | undefined): string {
  if (!error) return RESET_REQUEST_GENERIC_MESSAGE;
  if (isNetworkFailure(error)) return RESET_REQUEST_NETWORK_MESSAGE;

  if (
    error.status === 429 ||
    error.code === "over_email_send_rate_limit" ||
    error.code === "over_request_rate_limit"
  ) {
    return RESET_REQUEST_RATE_LIMIT_MESSAGE;
  }

  if (
    error.status === 400 &&
    (error.code === "validation_failed" || error.code === "email_address_invalid")
  ) {
    return RESET_REQUEST_EMAIL_MESSAGE;
  }

  return RESET_REQUEST_GENERIC_MESSAGE;
}

/**
 * Turns an `updateUser({ password })` failure into copy for the form.
 *
 * The session cases matter most: the recovery session can be gone before the
 * form is submitted (link used twice, marker cookie expired, password already
 * changed in another tab), and "Auth session missing" is not something to show
 * a customer.
 */
export function describeUpdatePasswordError(error: AuthFailureShape | null | undefined): string {
  if (!error) return PASSWORD_UPDATE_GENERIC_MESSAGE;
  if (isNetworkFailure(error)) return RESET_REQUEST_NETWORK_MESSAGE;

  const code = error.code ?? "";
  const message = (error.message ?? "").toLowerCase();

  if (
    code === "session_not_found" ||
    code === "session_expired" ||
    error.name === "AuthSessionMissingError" ||
    message.includes("auth session missing") ||
    message.includes("session from session_id claim")
  ) {
    return PASSWORD_UPDATE_SESSION_MESSAGE;
  }

  if (code === "same_password") return PASSWORD_UPDATE_SAME_MESSAGE;
  if (code === "weak_password" || error.status === 422) return PASSWORD_UPDATE_WEAK_MESSAGE;

  return PASSWORD_UPDATE_GENERIC_MESSAGE;
}

// ------------------------------------------------------- submission guards

/** Deliberately permissive: the browser's `type="email"` does the real work. */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isLikelyEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value.trim());
}

/**
 * Whether the request form may start a submission.
 *
 * `submitting` is the duplicate-submission guard: the button is disabled while a
 * request is in flight, and this is the same rule expressed where the handler
 * can enforce it even if the click got through (Enter key, double tap, or a
 * retry racing the first response).
 */
export function canSubmitResetRequest(input: { email: string; submitting: boolean }): boolean {
  return !input.submitting && isLikelyEmail(input.email);
}

/** The equivalent guard for the update form: no double submit, no mismatch. */
export function canSubmitPasswordUpdate(input: {
  password: string;
  confirmation: string;
  submitting: boolean;
}): boolean {
  return !input.submitting && validateNewPassword(input.password, input.confirmation).ok;
}
