/**
 * Unit tests for the password-recovery rules.
 *
 *   npm run test:auth
 *
 * These run the REAL modules — `src/lib/auth/recovery.ts` and
 * `src/lib/password.ts` — under Node 24's type stripping, so there is no build
 * step and no second copy of the rules to drift, exactly like
 * `npm run test:estimates` and `npm run test:issues`.
 *
 * What is proven here: the password rule, the duplicate-submission guards, the
 * callback decision table (exchange / verify / refuse), the open-redirect guard,
 * the shape of the recovery-gate cookie, the error-to-copy mapping that keeps the
 * request form from disclosing whether an account exists, and a set of
 * source-level guardrails (no token logging, no service-role client, no
 * identifier sent to `updateUser`).
 *
 * What is NOT covered here, and cannot be: the rendered React components, a real
 * recovery email, the live Supabase project's redirect allow-list, and the
 * browser's cookie handling. TESTING.md §4 lists the manual pass for those.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";

import {
  FORGOT_PASSWORD_PATH,
  LOGIN_PATH,
  PASSWORD_UPDATE_GENERIC_MESSAGE,
  PASSWORD_UPDATE_SAME_MESSAGE,
  PASSWORD_UPDATE_SESSION_MESSAGE,
  PASSWORD_UPDATE_WEAK_MESSAGE,
  RECOVERY_CALLBACK_PATH,
  RECOVERY_CLEAR_PATH,
  RECOVERY_COOKIE_MAX_AGE_SECONDS,
  RECOVERY_COOKIE_NAME,
  RECOVERY_ERROR_PARAM,
  RECOVERY_LINK_INVALID,
  RESET_REQUEST_EMAIL_MESSAGE,
  RESET_REQUEST_GENERIC_MESSAGE,
  RESET_REQUEST_NETWORK_MESSAGE,
  RESET_REQUEST_RATE_LIMIT_MESSAGE,
  RESET_REQUEST_SUCCESS_MESSAGE,
  UPDATE_PASSWORD_PATH,
  buildRecoveryRedirectTo,
  canSubmitPasswordUpdate,
  canSubmitResetRequest,
  describeResetRequestError,
  describeUpdatePasswordError,
  isLikelyEmail,
  isSafeRelativePath,
  planRecoveryCallback,
  recoveryCookieOptions,
  recoveryFailureRedirectPath,
  recoveryLinkNotice,
  resolveRecoveryNextPath,
} from "../../src/lib/auth/recovery.ts";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  PASSWORD_HINT,
  validateNewPassword,
} from "../../src/lib/password.ts";
import {
  RECOVERY_MARKER_VERSION,
  createRecoveryMarker,
  isRecoveryAuthorized,
  recoveryMarkerSecret,
  sessionIdFromAccessToken,
} from "../../src/lib/auth/recovery-marker.ts";

const ROOT = new URL("../../", import.meta.url);
const source = (path) => readFileSync(new URL(path, ROOT), "utf8");

// ---------------------------------------------------------- the password rule

test("a password shorter than the app's minimum is refused", () => {
  const short = "a".repeat(MIN_PASSWORD_LENGTH - 1);
  const result = validateNewPassword(short, short);

  assert.equal(result.ok, false);
  assert.match(result.message, new RegExp(`at least ${MIN_PASSWORD_LENGTH}`));
});

test("an empty password is refused", () => {
  assert.equal(validateNewPassword("", "").ok, false);
});

test("a password longer than bcrypt will read is refused before the server sees it", () => {
  const long = "a".repeat(MAX_PASSWORD_LENGTH + 1);
  const result = validateNewPassword(long, long);

  assert.equal(result.ok, false);
  assert.match(result.message, new RegExp(`${MAX_PASSWORD_LENGTH}`));
});

test("mismatched confirmation is refused even when both are long enough", () => {
  const result = validateNewPassword("correct-horse", "correct-hors");

  assert.equal(result.ok, false);
  assert.match(result.message, /do not match/i);
});

test("a matching password at the minimum length passes", () => {
  const password = "a".repeat(MIN_PASSWORD_LENGTH);
  assert.deepEqual(validateNewPassword(password, password), { ok: true });
});

test("the hint and the field minimum describe the same number", () => {
  assert.equal(PASSWORD_HINT, `Must be at least ${MIN_PASSWORD_LENGTH} characters`);
  // Registration must show the same rule as the reset form.
  assert.match(source("src/components/AuthForm.tsx"), /minLength=\{MIN_PASSWORD_LENGTH\}/);
  assert.match(source("src/components/AuthForm.tsx"), /\{PASSWORD_HINT\}/);
});

// ----------------------------------------------------- duplicate submissions

test("the request form cannot submit twice while a request is in flight", () => {
  const input = { email: "customer@example.com", submitting: false };
  assert.equal(canSubmitResetRequest(input), true);
  assert.equal(canSubmitResetRequest({ ...input, submitting: true }), false);
});

test("the request form refuses an address the browser would have caught", () => {
  for (const email of ["", "   ", "not-an-email", "name@", "@example.com", "name@example"]) {
    assert.equal(canSubmitResetRequest({ email, submitting: false }), false, email);
    assert.equal(isLikelyEmail(email), false, email);
  }
  assert.equal(isLikelyEmail(" customer@example.com "), true);
});

test("the update form cannot submit twice, and not at all while the fields disagree", () => {
  const base = { password: "correct-horse", confirmation: "correct-horse", submitting: false };
  assert.equal(canSubmitPasswordUpdate(base), true);
  assert.equal(canSubmitPasswordUpdate({ ...base, submitting: true }), false);
  assert.equal(canSubmitPasswordUpdate({ ...base, confirmation: "correct-hors" }), false);
  assert.equal(canSubmitPasswordUpdate({ ...base, password: "short", confirmation: "short" }), false);
});

// ------------------------------------ no account enumeration on the request

const ENUMERATION_PATTERNS = [
  /no account/i,
  /not found/i,
  /does not exist/i,
  /doesn't exist/i,
  /unregistered/i,
  /unknown (email|address|user)/i,
  /isn't registered/i,
];

function assertNoEnumerationLeak(text, label) {
  for (const pattern of ENUMERATION_PATTERNS) {
    assert.ok(!pattern.test(text), `${label} discloses account existence: "${text}"`);
  }
}

test("the success message is true whether or not the address has an account", () => {
  assert.match(RESET_REQUEST_SUCCESS_MESSAGE, /if an account exists/i);
  assertNoEnumerationLeak(RESET_REQUEST_SUCCESS_MESSAGE, "success message");
});

test("every reset-request failure maps to copy that says nothing about the account", () => {
  const failures = [
    { name: "AuthApiError", message: "User not found", status: 400, code: "user_not_found" },
    { name: "AuthApiError", message: "Email not confirmed", status: 400, code: "email_not_confirmed" },
    { name: "AuthApiError", message: "Database error saving new user", status: 500, code: "unexpected_failure" },
    undefined,
    null,
  ];

  for (const failure of failures) {
    const message = describeResetRequestError(failure);
    assert.equal(message, RESET_REQUEST_GENERIC_MESSAGE);
    assertNoEnumerationLeak(message, "generic failure");
  }
});

test("only format, rate limit and network failures are named, and none names an account", () => {
  const format = describeResetRequestError({ status: 400, code: "validation_failed" });
  assert.equal(format, RESET_REQUEST_EMAIL_MESSAGE);

  const rateLimit = describeResetRequestError({ status: 429, code: "over_email_send_rate_limit" });
  assert.equal(rateLimit, RESET_REQUEST_RATE_LIMIT_MESSAGE);
  assert.equal(describeResetRequestError({ status: 429 }), RESET_REQUEST_RATE_LIMIT_MESSAGE);

  const network = describeResetRequestError(new TypeError("Failed to fetch"));
  assert.equal(network, RESET_REQUEST_NETWORK_MESSAGE);

  for (const message of [format, rateLimit, network]) {
    assertNoEnumerationLeak(message, "named failure");
  }
});

// ------------------------------------------------ the callback decision table

const callbackParams = (overrides = {}) => ({
  code: null,
  tokenHash: null,
  type: null,
  providerError: null,
  next: null,
  ...overrides,
});

test("a PKCE code is exchanged against the browser that asked for the email", () => {
  const plan = planRecoveryCallback(callbackParams({ code: "abc123" }));
  assert.deepEqual(plan, {
    action: "exchange_code",
    code: "abc123",
    nextPath: UPDATE_PASSWORD_PATH,
  });
});

test("a token_hash link is accepted only for type=recovery", () => {
  const recovery = planRecoveryCallback(callbackParams({ tokenHash: "hash", type: "recovery" }));
  assert.deepEqual(recovery, {
    action: "verify_token",
    tokenHash: "hash",
    nextPath: UPDATE_PASSWORD_PATH,
  });

  // A signup or email-change token must never be spendable on a password reset.
  for (const type of ["signup", "email_change", "magiclink", "invite", null]) {
    assert.deepEqual(planRecoveryCallback(callbackParams({ tokenHash: "hash", type })), {
      action: "fail",
    });
  }
});

test("an expired or already-used link is refused rather than retried", () => {
  assert.deepEqual(
    planRecoveryCallback(callbackParams({ code: "abc123", providerError: "otp_expired" })),
    { action: "fail" }
  );
  assert.deepEqual(
    planRecoveryCallback(
      callbackParams({ tokenHash: "hash", type: "recovery", providerError: "access_denied" })
    ),
    { action: "fail" }
  );
});

test("a callback with nothing to exchange is refused", () => {
  assert.deepEqual(planRecoveryCallback(callbackParams()), { action: "fail" });
  assert.deepEqual(planRecoveryCallback(callbackParams({ code: "" })), { action: "fail" });
});

test("a refused link lands back on the request page with a generic code", () => {
  assert.equal(
    recoveryFailureRedirectPath(),
    `${FORGOT_PASSWORD_PATH}?${RECOVERY_ERROR_PARAM}=${RECOVERY_LINK_INVALID}`
  );
});

test("the bounced code renders a notice, and an unknown one renders nothing", () => {
  assert.match(recoveryLinkNotice(RECOVERY_LINK_INVALID), /invalid or has expired/i);
  for (const code of [null, undefined, "", "something_else", "<script>alert(1)</script>"]) {
    assert.equal(recoveryLinkNotice(code), null);
  }
});

// ------------------------------------------------------- redirect allow-list

test("the recovery redirect points at the callback route on the requesting origin", () => {
  assert.equal(
    buildRecoveryRedirectTo("http://localhost:3000"),
    `http://localhost:3000${RECOVERY_CALLBACK_PATH}?next=%2Fupdate-password`
  );

  // A trailing slash must not produce a double slash, which would be an unlisted
  // URL in the Supabase allow-list.
  assert.equal(
    buildRecoveryRedirectTo("https://sparkserv.example/"),
    `https://sparkserv.example${RECOVERY_CALLBACK_PATH}?next=%2Fupdate-password`
  );
});

test("next is only ever a same-site path, so the callback cannot be an open redirect", () => {
  const rejected = [
    "https://evil.example",
    "http://evil.example/update-password",
    "//evil.example",
    "/\\evil.example",
    "\\\\evil.example",
    "javascript:alert(1)",
    "update-password",
    "",
    null,
    undefined,
  ];

  for (const value of rejected) {
    assert.equal(isSafeRelativePath(value), false, String(value));
    assert.equal(resolveRecoveryNextPath(value), UPDATE_PASSWORD_PATH, String(value));
  }

  assert.equal(isSafeRelativePath("/update-password"), true);
  assert.equal(resolveRecoveryNextPath("/customer/dashboard"), "/customer/dashboard");
});

test("an unsafe next still lets a valid code through, but to the default path", () => {
  const plan = planRecoveryCallback(callbackParams({ code: "abc123", next: "//evil.example" }));
  assert.deepEqual(plan, {
    action: "exchange_code",
    code: "abc123",
    nextPath: UPDATE_PASSWORD_PATH,
  });
});

// ----------------------------------------------------------- the recovery gate

test("the gate cookie is httpOnly, path-wide and short-lived", () => {
  const options = recoveryCookieOptions();

  assert.equal(RECOVERY_COOKIE_NAME, "sparkserv-recovery");
  assert.equal(options.httpOnly, true);
  assert.equal(options.path, "/");
  assert.equal(options.sameSite, "lax");
  assert.ok(options.maxAge > 0 && options.maxAge <= 60 * 60, `maxAge was ${options.maxAge}`);
  assert.equal(options.maxAge, RECOVERY_COOKIE_MAX_AGE_SECONDS);
});

test("the gate checks the marker against the validated user and that session's id", () => {
  const gate = source("src/lib/auth/recovery-session.ts");

  // The user comes from the auth server, not from the cookie or the URL.
  assert.match(gate, /auth\.getUser\(\)/);
  assert.match(gate, /if \(!user\) return false/);
  assert.match(gate, /auth\.getSession\(\)/);
  assert.match(gate, /sessionIdFromAccessToken\(/);
  assert.match(gate, /isRecoveryAuthorized\(/);

  // And nothing about the request is treated as identity.
  assert.ok(!gate.includes("searchParams"), "the gate must not read the URL");
  assert.ok(!/headers\(\)/.test(gate), "the gate must not read headers as identity");
});

test("the update-password page refuses on the server, before any form renders", () => {
  const page = source("src/app/(auth)/update-password/page.tsx");

  assert.match(page, /await hasRecoverySession\(\)/);
  assert.match(page, /dynamic = "force-dynamic"/);
  assert.match(page, /allowed \? <UpdatePasswordForm \/> : <RecoveryLinkInvalid \/>/);
});

// --------------------------------------------------------- update failures

test("a missing or expired recovery session is reported as an unusable link", () => {
  const cases = [
    { name: "AuthSessionMissingError", message: "Auth session missing!", status: 400 },
    { name: "AuthApiError", message: "Session not found", status: 403, code: "session_not_found" },
    { name: "AuthApiError", message: "Session expired", status: 401, code: "session_expired" },
  ];

  for (const failure of cases) {
    assert.equal(
      describeUpdatePasswordError(failure),
      PASSWORD_UPDATE_SESSION_MESSAGE,
      failure.code ?? failure.name
    );
  }
});

test("reusing the current password, and a rejected password, each get their own copy", () => {
  assert.equal(
    describeUpdatePasswordError({ name: "AuthApiError", status: 422, code: "same_password" }),
    PASSWORD_UPDATE_SAME_MESSAGE
  );
  assert.equal(
    describeUpdatePasswordError({ name: "AuthApiError", status: 422, code: "weak_password" }),
    PASSWORD_UPDATE_WEAK_MESSAGE
  );
  // A project whose dashboard minimum is stricter than the app's rule still gets
  // a readable message rather than a blank failure.
  assert.equal(
    describeUpdatePasswordError({ name: "AuthApiError", status: 422 }),
    PASSWORD_UPDATE_WEAK_MESSAGE
  );
});

test("an unrecognised update failure, and a network failure, fall back safely", () => {
  assert.equal(
    describeUpdatePasswordError({ status: 500, message: "boom" }),
    PASSWORD_UPDATE_GENERIC_MESSAGE
  );
  assert.equal(describeUpdatePasswordError(null), PASSWORD_UPDATE_GENERIC_MESSAGE);
  assert.equal(
    describeUpdatePasswordError(new TypeError("Failed to fetch")),
    RESET_REQUEST_NETWORK_MESSAGE
  );
});

// ------------------------------- recovery authorization is bound to a session

const SECRET_ENV = { SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key-0123456789abcdef" };
const SECRET = recoveryMarkerSecret(SECRET_ENV);
const OTHER_SECRET = recoveryMarkerSecret({
  SUPABASE_SERVICE_ROLE_KEY: "a-different-service-role-key-0123456789",
});

const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
/** The session the recovery link created for A. */
const SESSION_RECOVERY_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
/** A later, ordinary sign-in by A. */
const SESSION_NORMAL_A = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
/** An ordinary session for B. */
const SESSION_B = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const NOW = 1_800_000_000;

/** A marker exactly as `/auth/callback` mints it, for one user and one session. */
function markerFor(userId, sessionId, options = {}) {
  const {
    now = NOW,
    ttl = RECOVERY_COOKIE_MAX_AGE_SECONDS,
    secret = SECRET,
  } = options;

  return createRecoveryMarker({ userId, sessionId, expiresAt: now + ttl }, secret);
}

/** The marker a completed recovery exchange for A would leave in the browser. */
const RECOVERY_MARKER_A = markerFor(USER_A, SESSION_RECOVERY_A);

/** `isRecoveryAuthorized` with the recovery state as the baseline. */
function authorize(overrides = {}) {
  return isRecoveryAuthorized({
    marker: RECOVERY_MARKER_A,
    userId: USER_A,
    sessionId: SESSION_RECOVERY_A,
    secret: SECRET,
    nowSeconds: NOW,
    ...overrides,
  });
}

test("the signing key is derived from the server-only secret, never from the browser", () => {
  assert.equal(typeof SECRET, "string");
  assert.ok(SECRET.length >= 32, "the derived key should be a full-length digest");
  // Key material, not the secret itself: the marker key must not be usable as
  // (or interchangeable with) the service-role key.
  assert.notEqual(SECRET, SECRET_ENV.SUPABASE_SERVICE_ROLE_KEY);

  // A deployment without the secret produces no marker and authorizes nothing.
  assert.equal(recoveryMarkerSecret({}), null);
  assert.equal(recoveryMarkerSecret({ SUPABASE_SERVICE_ROLE_KEY: "too-short" }), null);
  assert.equal(
    createRecoveryMarker(
      { userId: USER_A, sessionId: SESSION_RECOVERY_A, expiresAt: NOW + 900 },
      null
    ),
    null
  );
});

test("the marker names the user and the session in a signed payload", () => {
  const parts = RECOVERY_MARKER_A.split(".");
  assert.equal(parts.length, 2, "the marker is payload + signature");

  const claims = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8"));
  assert.deepEqual(claims, {
    v: RECOVERY_MARKER_VERSION,
    u: USER_A,
    s: SESSION_RECOVERY_A,
    e: NOW + RECOVERY_COOKIE_MAX_AGE_SECONDS,
  });
});

test("scenario 1 — a user without a recovery session cannot open /update-password", () => {
  assert.equal(authorize(), true, "baseline: the recovery session itself is authorized");

  // No marker at all: a normal, signed-in customer who types the URL.
  assert.equal(authorize({ marker: null }), false);
  assert.equal(authorize({ marker: undefined }), false);
  assert.equal(authorize({ marker: "" }), false);

  // A marker with nothing behind it.
  assert.equal(authorize({ userId: null }), false);
  assert.equal(authorize({ sessionId: null }), false);
  assert.equal(authorize({ userId: undefined, sessionId: undefined }), false);
});

test("scenario 2 — signing out and back in normally does not renew the recovery authorization", () => {
  // The marker was issued for the recovery session. The same account signing in
  // again gets a new session id, so the marker no longer matches even though the
  // cookie is still in the jar.
  assert.equal(authorize({ sessionId: SESSION_NORMAL_A }), false);

  // And with the session ended altogether (signed out) it is refused too.
  assert.equal(authorize({ userId: null, sessionId: null }), false);
});

test("scenario 3 — another account signing in in the same browser is refused", () => {
  assert.equal(authorize({ userId: USER_B, sessionId: SESSION_B }), false);
  assert.equal(authorize({ userId: USER_B }), false, "B on A's session id");
  assert.equal(authorize({ sessionId: SESSION_B }), false, "A on B's session id");

  // B's own recovery authorization cannot be borrowed from A's marker either.
  assert.equal(authorize({ marker: markerFor(USER_B, SESSION_B) }), false);
});

test("scenario 4 — a completed reset leaves the authorization unusable", () => {
  // Bound to the session, so both end states after a reset refuse the marker:
  // signed out (no session at all) and signed in again (a new session id).
  assert.equal(authorize({ userId: null, sessionId: null }), false);
  assert.equal(authorize({ sessionId: SESSION_NORMAL_A }), false);

  // The form also clears the cookie outright, then ends the session.
  const form = source("src/components/UpdatePasswordForm.tsx");
  assert.match(form, /fetch\(RECOVERY_CLEAR_PATH, \{ method: "DELETE" \}\)/);
  assert.match(form, /auth\.signOut\(\{ scope: "local" \}\)/);
  assert.equal(RECOVERY_CLEAR_PATH, "/api/auth/recovery");

  // ...and the endpoint it calls expires the one cookie it names.
  const clearRoute = source("src/app/api/auth/recovery/route.ts");
  assert.match(clearRoute, /export async function DELETE\(\)/);
  assert.match(clearRoute, /response\.cookies\.set\(RECOVERY_COOKIE_NAME, "", \{/);
  assert.match(clearRoute, /maxAge: 0/);
});

test("scenario 5 — an expired or reused link cannot establish a recovery session", () => {
  // Expired payload: refused although the signature is valid and the session matches.
  assert.equal(authorize({ marker: markerFor(USER_A, SESSION_RECOVERY_A, { ttl: -1 }) }), false);

  // Boundary: valid one second before expiry, refused at it.
  const boundary = markerFor(USER_A, SESSION_RECOVERY_A, { ttl: 60 });
  assert.equal(authorize({ marker: boundary, nowSeconds: NOW + 59 }), true);
  assert.equal(authorize({ marker: boundary, nowSeconds: NOW + 60 }), false);

  // A reused link is refused by the callback before any marker exists...
  assert.deepEqual(
    planRecoveryCallback({
      code: "spent",
      tokenHash: null,
      type: null,
      providerError: "otp_expired",
      next: null,
    }),
    { action: "fail" }
  );

  // ...and the callback can only mint a marker from the exchange's own result,
  // never from anything the browser sent.
  const route = source("src/app/auth/callback/route.ts");
  assert.match(route, /const marker = result\.error/);
  assert.match(route, /userId: result\.data\.user\?\.id/);
  assert.match(route, /sessionId: sessionIdFromAccessToken\(result\.data\.session\?\.access_token\)/);
  assert.match(route, /if \(marker\) \{/);
  assert.match(route, /response\.cookies\.set\(RECOVERY_COOKIE_NAME, marker, recoveryCookieOptions\(\)\)/);
  assert.ok(!route.includes('searchParams.get("userId")'), "the callback must not read a user id");
  assert.ok(!route.includes('searchParams.get("email")'), "the callback must not read an email");
});

test("a forged, unsigned, truncated or tampered marker is always refused", () => {
  const signature = RECOVERY_MARKER_A.split(".")[1];

  const payload = (overrides = {}) =>
    Buffer.from(
      JSON.stringify({
        v: RECOVERY_MARKER_VERSION,
        u: USER_A,
        s: SESSION_RECOVERY_A,
        e: NOW + RECOVERY_COOKIE_MAX_AGE_SECONDS,
        ...overrides,
      }),
      "utf8"
    ).toString("base64url");

  // An authenticated user writing their own cookie: well-formed JSON, no signature.
  assert.equal(authorize({ marker: payload() }), false);
  assert.equal(authorize({ marker: `${payload()}.` }), false);
  assert.equal(authorize({ marker: `${payload()}.not-a-signature` }), false);
  assert.equal(authorize({ marker: "1" }), false);
  assert.equal(authorize({ marker: "a.b.c" }), false);
  assert.equal(authorize({ marker: `${payload({ e: NOW + 1 })}.${signature}` }), false, "payload + original signature");

  // Signed with a different key — e.g. the secret was rotated, or the attacker
  // signed with something they control.
  assert.equal(authorize({ marker: markerFor(USER_A, SESSION_RECOVERY_A, { secret: OTHER_SECRET }) }), false);
  assert.equal(authorize({ secret: OTHER_SECRET }), false);

  // Tampered payload: the signature no longer covers it.
  assert.equal(authorize({ marker: `${payload({ u: USER_B })}.${signature}` }), false);
  assert.equal(authorize({ marker: `${payload({ e: NOW + 999_999 })}.${signature}` }), false);

  // No signing secret at all (misconfigured deployment): refused, not trusted.
  assert.equal(authorize({ secret: null }), false);
  assert.equal(authorize({ secret: "" }), false);
});

test("the session id is read from the access token, and anything else yields null", () => {
  const jwt = (claims) =>
    `header.${Buffer.from(JSON.stringify(claims), "utf8").toString("base64url")}.signature`;

  assert.equal(
    sessionIdFromAccessToken(jwt({ sub: USER_A, session_id: SESSION_RECOVERY_A })),
    SESSION_RECOVERY_A
  );

  for (const value of [
    jwt({ sub: USER_A }),
    jwt({ session_id: "" }),
    jwt({ session_id: 42 }),
    jwt({ session_id: null }),
    "not-a-jwt",
    "a.b",
    "a.!!!not-base64!!!.c",
    "",
    null,
    undefined,
  ]) {
    assert.equal(sessionIdFromAccessToken(value), null, String(value));
  }
});

// ----------------------------------------------------------------- wiring

test("the recovery routes exist and login links to the request page", () => {
  for (const path of [
    "src/app/(auth)/forgot-password/page.tsx",
    "src/app/(auth)/update-password/page.tsx",
    "src/app/auth/callback/route.ts",
    "src/app/api/auth/recovery/route.ts",
    "src/lib/auth/recovery-session.ts",
    "src/lib/auth/recovery-marker.ts",
  ]) {
    assert.ok(existsSync(new URL(path, ROOT)), `${path} is missing`);
  }

  assert.match(source("src/components/AuthForm.tsx"), /href="\/forgot-password"/);
  assert.equal(LOGIN_PATH, "/login");
  assert.match(source("src/components/ForgotPasswordForm.tsx"), /resetPasswordForEmail\(/);
  assert.match(
    source("src/components/ForgotPasswordForm.tsx"),
    /redirectTo: buildRecoveryRedirectTo\(/
  );
});

test("the callback never logs the code, the token hash or the session", () => {
  const route = source("src/app/auth/callback/route.ts");

  assert.ok(!/console\./.test(route), "the recovery callback must not log anything");
  assert.match(route, /exchangeCodeForSession\(plan\.code\)/);
  assert.match(route, /verifyOtp\(\{ type: "recovery", token_hash: plan\.tokenHash \}\)/);
});

test("no part of the recovery surface can write to the database or use a service-role client", () => {
  const files = [
    "src/app/auth/callback/route.ts",
    "src/app/(auth)/forgot-password/page.tsx",
    "src/app/(auth)/update-password/page.tsx",
    "src/app/api/auth/recovery/route.ts",
    "src/components/ForgotPasswordForm.tsx",
    "src/components/UpdatePasswordForm.tsx",
    "src/lib/auth/recovery.ts",
    "src/lib/auth/recovery-session.ts",
    "src/lib/auth/recovery-marker.ts",
  ];

  for (const path of files) {
    const text = source(path);
    assert.ok(!text.includes("createServiceRoleClient"), `${path} must not use the service-role client`);
    assert.ok(!/\.from\("users"\)/.test(text), `${path} must not touch the users table`);
    assert.ok(!/role\s*[:=]\s*["'](admin|super_admin|technician)["']/.test(text), `${path} must not set a role`);
  }
});

test("the marker module uses the service-role key as key material only", () => {
  const marker = source("src/lib/auth/recovery-marker.ts");

  // It reads the secret to derive a MAC key ...
  assert.match(marker, /env\.SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(marker, /createHmac\("sha256", keyMaterial\)/);

  // ... and does nothing else with it: no client, no request, no Supabase.
  assert.ok(
    !/from "@supabase|@\/lib\/supabase|createClient|createServerClient|createBrowserClient/.test(marker),
    "must not create a Supabase client"
  );
  assert.ok(!/fetch\(/.test(marker), "must not make network calls");
  assert.match(marker, /from "node:crypto"/);
});

test("the service-role key is read nowhere else on the recovery surface", () => {
  for (const path of [
    "src/app/auth/callback/route.ts",
    "src/app/(auth)/forgot-password/page.tsx",
    "src/app/(auth)/update-password/page.tsx",
    "src/app/api/auth/recovery/route.ts",
    "src/components/ForgotPasswordForm.tsx",
    "src/components/UpdatePasswordForm.tsx",
    "src/lib/auth/recovery.ts",
    "src/lib/auth/recovery-session.ts",
  ]) {
    assert.ok(!source(path).includes("SUPABASE_SERVICE_ROLE_KEY"), `${path} must not read the service-role key`);
  }
});

test("the password update sends only the password, never an identifier from the browser", () => {
  const form = source("src/components/UpdatePasswordForm.tsx");

  const call = form.match(/updateUser\([^)]*\)/);
  assert.ok(call, "UpdatePasswordForm must call supabase.auth.updateUser");
  assert.match(
    call[0].slice("updateUser(".length, -1),
    /^\{\s*password\s*\}$/,
    `updateUser must receive only the password, got ${call[0]}`
  );

  // No identity may travel in the URL either.
  assert.ok(!form.includes("useSearchParams"), "the update form must not read the URL");
  assert.ok(!/userId/.test(form), "the update form must not accept a user id");
});
