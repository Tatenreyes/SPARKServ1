"use client";

import { useState, useId } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { ArrowLeft, Mail, MailCheck } from "lucide-react";
import {
  LOGIN_PATH,
  RESET_REQUEST_EMAIL_MESSAGE,
  RESET_REQUEST_SUCCESS_MESSAGE,
  buildRecoveryRedirectTo,
  canSubmitResetRequest,
  describeResetRequestError,
} from "@/lib/auth/recovery";

/**
 * "Forgot password?" — asks Supabase to email a reset link.
 *
 * Two behaviours are load-bearing, and both are enforced here rather than left
 * to the server:
 *
 *   - The response is generic. `resetPasswordForEmail` answers 200 for an
 *     address with no account, so this form must not add a difference of its
 *     own: every valid submission ends on the same "check your email" panel,
 *     whether or not the address exists. Only a malformed address, a rate limit
 *     and an unreachable service are ever named.
 *   - The request cannot be submitted twice. The button is disabled while a
 *     request is in flight and `canSubmitResetRequest` re-checks at the top of
 *     the handler, so a double click, an Enter-key repeat, or a retry racing the
 *     first response cannot spend two of the project's email quota.
 *
 * The redirect target is built from `window.location.origin`, so the link comes
 * back to whichever host the request was made on (localhost, production, or a
 * preview deployment) — each of which must be listed in the Supabase dashboard
 * under Authentication → URL Configuration.
 */
export default function ForgotPasswordForm({ notice = null }: { notice?: string | null }) {
  const supabase = createClient();

  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const emailId = useId();

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (!canSubmitResetRequest({ email, submitting })) {
      if (!submitting) setError(RESET_REQUEST_EMAIL_MESSAGE);
      return;
    }

    setSubmitting(true);

    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo: buildRecoveryRedirectTo(window.location.origin),
      });

      if (resetError) {
        setError(describeResetRequestError(resetError));
        return;
      }

      setSent(true);
    } catch (thrown) {
      setError(describeResetRequestError(thrown instanceof Error ? thrown : null));
    } finally {
      setSubmitting(false);
    }
  }

  if (sent) {
    return (
      <div className="w-full max-w-[420px]">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-brand-soft text-brand-ink ring-1 ring-line">
          <MailCheck className="h-5 w-5" aria-hidden="true" />
        </span>
        <h1 className="mt-5 font-display text-2xl font-bold leading-tight text-ink">
          Check your email
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-ink/60">{RESET_REQUEST_SUCCESS_MESSAGE}</p>
        <p className="mt-3 text-xs leading-relaxed text-ink/50">
          The link can only be used once and it expires after a short while. If it has not arrived
          in a few minutes, check your spam folder.
        </p>

        <button
          type="button"
          onClick={() => {
            setSent(false);
            setError(null);
          }}
          className="mt-6 w-full rounded-xl border border-ink/10 bg-surface px-4 py-3 text-sm font-semibold text-ink/80 transition-all duration-200 hover:border-ink/20 hover:text-ink"
        >
          Use a different email
        </button>

        <p className="mt-6 text-center text-sm text-ink/60">
          <Link
            href={LOGIN_PATH}
            className="inline-flex items-center gap-1.5 font-semibold text-brand-ink underline-offset-2 transition-colors hover:underline"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
            Back to log in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-[420px]">
      <div className="mb-8">
        <h1 className="font-display text-2xl font-bold leading-tight text-ink">
          Reset your password
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-ink/60">
          Enter the email address on your account and we&apos;ll send you a link to choose a new
          password.
        </p>
      </div>

      {notice && (
        <div
          role="status"
          className="mb-5 flex min-w-0 items-start gap-2.5 rounded-xl bg-warn-soft px-4 py-3 text-sm text-warn-ink"
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
          <span className="min-w-0 flex-1 leading-relaxed">{notice}</span>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-1.5">
          <label
            htmlFor={emailId}
            className="flex items-center gap-2 text-sm font-semibold text-ink/80"
          >
            <Mail className="h-4 w-4 text-ink/40" aria-hidden="true" />
            Email address
          </label>
          <input
            id={emailId}
            required
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="w-full rounded-xl border border-ink/10 bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-ink/30 transition-all duration-200 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10"
            placeholder="Enter your email"
          />
        </div>

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
              Sending link...
            </span>
          ) : (
            "Send reset link"
          )}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-ink/60">
        <Link
          href={LOGIN_PATH}
          className="inline-flex items-center gap-1.5 font-semibold text-brand-ink underline-offset-2 transition-colors hover:underline"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
          Back to log in
        </Link>
      </p>
    </div>
  );
}
