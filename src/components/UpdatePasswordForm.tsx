"use client";

import { useState, useId } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import LoadingScreen from "@/components/LoadingScreen";
import { CheckCircle2, Eye, EyeOff, Lock } from "lucide-react";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH, PASSWORD_HINT, validateNewPassword } from "@/lib/password";
import {
  LOGIN_PATH,
  RECOVERY_CLEAR_PATH,
  canSubmitPasswordUpdate,
  describeUpdatePasswordError,
} from "@/lib/auth/recovery";

/**
 * The form behind the recovery gate on /update-password.
 *
 * It changes exactly one thing, and only for the session that opened it:
 * `supabase.auth.updateUser({ password })`. No user id, no email and no profile
 * row travels from this component, so there is no value a caller could tamper
 * with to point the update at a different account — the auth server derives the
 * account from the session cookie it issued.
 *
 * The old password is not asked for: possession of a valid recovery session is
 * the proof, which is why that session may only be created by /auth/callback.
 * On success the recovery authorization is closed off immediately, in two steps
 * that cover each other:
 *
 *   1. `DELETE /api/auth/recovery` clears the marker cookie, and
 *   2. signing out ends the session the marker was bound to, so even a marker
 *      that survived step 1 cannot be matched again by a later sign-in.
 *
 * Neither step is allowed to turn a completed password change into an error on
 * screen, so both are best-effort.
 */
export default function UpdatePasswordForm() {
  const supabase = createClient();
  const router = useRouter();

  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const passwordId = useId();
  const confirmationId = useId();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const check = validateNewPassword(password, confirmation);
    if (!check.ok) {
      setError(check.message);
      return;
    }

    // Same rule as the disabled button, re-checked where it cannot be bypassed.
    if (!canSubmitPasswordUpdate({ password, confirmation, submitting })) return;

    setSubmitting(true);

    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });

      if (updateError) {
        setError(describeUpdatePasswordError(updateError));
        return;
      }

      setPassword("");
      setConfirmation("");
      setDone(true);

      // The password is already changed: nothing below may surface an error or
      // undo the confirmation, so both steps are best-effort.
      try {
        // Clear the marker cookie so the authorization leaves the jar with it.
        await fetch(RECOVERY_CLEAR_PATH, { method: "DELETE" });
      } catch {
        // Not fatal — the marker is bound to the session id ended below, so it
        // is unusable even if this request never lands.
      }

      try {
        // End the recovery session. This is what actually invalidates the
        // marker: a later sign-in gets a new session id and cannot match it.
        await supabase.auth.signOut({ scope: "local" });
      } catch {
        // Best-effort: the customer is about to log in with the new password.
      }

      router.refresh();
    } catch (thrown) {
      setError(describeUpdatePasswordError(thrown instanceof Error ? thrown : null));
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <div className="w-full max-w-[420px]">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-signal-soft text-signal-ink ring-1 ring-line">
          <CheckCircle2 className="h-5 w-5" aria-hidden="true" />
        </span>
        <h1 className="mt-5 font-display text-2xl font-bold leading-tight text-ink">
          Password updated
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-ink/60">
          Your new password is saved and this reset link has been closed. Log in with your new
          password to continue.
        </p>

        <Link
          href={LOGIN_PATH}
          className="mt-6 flex w-full items-center justify-center rounded-xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-brand-700 hover:shadow-md active:scale-[0.98]"
        >
          Back to log in
        </Link>
      </div>
    );
  }

  return (
    <>
      {submitting && <LoadingScreen message="Saving your new password..." />}
      <div className="w-full max-w-[420px]">
        <div className="mb-8">
          <h1 className="font-display text-2xl font-bold leading-tight text-ink">
            Choose a new password
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-ink/60">
            Your reset link has been verified. Set the password you&apos;ll use to log in from now
            on.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <PasswordField
            id={passwordId}
            label="New password"
            hint={PASSWORD_HINT}
            placeholder="Enter your new password"
            value={password}
            onChange={setPassword}
            visible={showPassword}
            onToggleVisible={() => setShowPassword((current) => !current)}
          />

          <PasswordField
            id={confirmationId}
            label="Confirm new password"
            placeholder="Re-enter your new password"
            value={confirmation}
            onChange={setConfirmation}
            visible={showConfirmation}
            onToggleVisible={() => setShowConfirmation((current) => !current)}
          />

          {error && (
            <div
              role="alert"
              className="flex min-w-0 items-start gap-2.5 rounded-xl bg-alert-soft px-4 py-3 text-sm text-alert-ink"
            >
              <svg
                className="mt-0.5 h-5 w-5 shrink-0"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span className="min-w-0 flex-1 leading-relaxed">{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-brand-700 hover:shadow-md active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100"
          >
            {submitting ? (
              <span className="flex items-center justify-center gap-2">
                <svg
                  className="h-4 w-4 animate-spin"
                  viewBox="0 0 24 24"
                  fill="none"
                  aria-hidden="true"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Saving...
              </span>
            ) : (
              "Update password"
            )}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-ink/60">
          <Link
            href={LOGIN_PATH}
            className="font-semibold text-brand-ink underline-offset-2 transition-colors hover:underline"
          >
            Back to log in
          </Link>
        </p>
      </div>
    </>
  );
}

/**
 * One password field with its own show/hide control. Shared by both fields so
 * the two cannot drift apart in markup, `autoComplete` or length rule.
 */
function PasswordField({
  id,
  label,
  hint,
  placeholder,
  value,
  onChange,
  visible,
  onToggleVisible,
}: {
  id: string;
  label: string;
  hint?: string;
  placeholder: string;
  value: string;
  onChange: (next: string) => void;
  visible: boolean;
  onToggleVisible: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="flex items-center gap-2 text-sm font-semibold text-ink/80">
        <Lock className="h-4 w-4 text-ink/40" aria-hidden="true" />
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          required
          type={visible ? "text" : "password"}
          autoComplete="new-password"
          minLength={MIN_PASSWORD_LENGTH}
          maxLength={MAX_PASSWORD_LENGTH}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-full rounded-xl border border-ink/10 bg-surface px-3.5 py-2.5 pr-10 text-sm text-ink placeholder:text-ink/30 transition-all duration-200 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10"
          placeholder={placeholder}
        />
        <button
          type="button"
          onClick={onToggleVisible}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-ink/30 transition-colors hover:text-ink/60"
          aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {hint && <p className="text-xs text-ink/40">{hint}</p>}
    </div>
  );
}
