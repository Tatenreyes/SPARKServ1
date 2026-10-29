/**
 * The app's password rule, defined once.
 *
 * The registration form has always carried it — `minLength={6}` plus the
 * "Must be at least 6 characters" hint — and Supabase's own default minimum is
 * 6 as well. The reset form has to apply the *same* rule: a customer who signed
 * up with a 6-character password must not be told by a different screen of the
 * same product that their new one is too short.
 *
 * Raising the minimum is a two-place change — `MIN_PASSWORD_LENGTH` here **and**
 * Authentication → Providers → Email → Password requirements in the Supabase
 * dashboard. The server keeps its own copy; if the two disagree, the server
 * wins and `updateUser` comes back as a `weak_password` error, which the reset
 * form surfaces as a readable message rather than a blank failure.
 *
 * Plain module (no React/Next imports) so `scripts/tests/password-recovery.test.mjs`
 * can exercise the real rule under Node 24's type stripping, the same way
 * `src/lib/estimate-costs.ts` is tested.
 */

export const MIN_PASSWORD_LENGTH = 6;

/**
 * bcrypt — what Supabase Auth uses — only reads the first 72 bytes of a
 * password, and GoTrue refuses anything longer outright. Without this bound the
 * field would accept a longer password and the server would reject it, so the
 * length is capped where the user can still see why.
 */
export const MAX_PASSWORD_LENGTH = 72;

/** Hint under the field, shared by /register and /update-password. */
export const PASSWORD_HINT = `Must be at least ${MIN_PASSWORD_LENGTH} characters`;

export type PasswordCheck = { ok: true } | { ok: false; message: string };

/**
 * Validates a new password against the app's rule and against its confirmation.
 *
 * Length is checked before the match so the message names the problem the user
 * has to fix first; the two-field comparison is deliberately not the only
 * check, because `updateUser` never sees the confirmation.
 */
export function validateNewPassword(password: string, confirmation: string): PasswordCheck {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return {
      ok: false,
      message: `Your password must be at least ${MIN_PASSWORD_LENGTH} characters long.`,
    };
  }

  if (password.length > MAX_PASSWORD_LENGTH) {
    return {
      ok: false,
      message: `Your password must be ${MAX_PASSWORD_LENGTH} characters or fewer.`,
    };
  }

  if (password !== confirmation) {
    return { ok: false, message: "Those passwords do not match." };
  }

  return { ok: true };
}
