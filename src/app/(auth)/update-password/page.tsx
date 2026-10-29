import Link from "next/link";
import { ArrowLeft, Mail, ShieldAlert } from "lucide-react";
import AuthShell from "@/components/AuthShell";
import UpdatePasswordForm from "@/components/UpdatePasswordForm";
import { hasRecoverySession } from "@/lib/auth/recovery-session";
import {
  FORGOT_PASSWORD_PATH,
  LOGIN_PATH,
  RECOVERY_SESSION_MISSING_MESSAGE,
} from "@/lib/auth/recovery";

export const metadata = {
  title: "Choose a new password — SPARKServ",
  description: "Set a new password for your SPARKServ account.",
};

/**
 * Rendered on every request: the gate below depends on the request's cookies, so
 * this page can never be prerendered.
 */
export const dynamic = "force-dynamic";

/**
 * The destination of a recovery link, and the only screen that can change a
 * password without the old one.
 *
 * The check happens here, on the server, before any form is rendered — not in
 * the client component, and not by trusting a query parameter:
 *
 *   - arriving from `/auth/callback` leaves the httpOnly recovery marker cookie
 *     *and* a session, so the form renders;
 *   - typing the URL directly (or reopening a used link, or waiting out the
 *     marker) fails the gate, and the visitor gets the panel below instead.
 *
 * Nothing about the account is read here — no profile row, no role, no email —
 * so this page cannot be used to discover anything about a user, and it changes
 * nothing except the password of the session that opened it.
 */
export default async function UpdatePasswordPage() {
  const allowed = await hasRecoverySession();

  return (
    <AuthShell
      headline="Choose a new password."
      subhead="Pick something you haven't used before — you'll need it the next time you log in."
    >
      {allowed ? <UpdatePasswordForm /> : <RecoveryLinkInvalid />}
    </AuthShell>
  );
}

/** Shown when the gate fails: no marker cookie, or no valid session behind it. */
function RecoveryLinkInvalid() {
  return (
    <div className="w-full max-w-[420px]">
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-warn-soft text-warn-ink ring-1 ring-line">
        <ShieldAlert className="h-5 w-5" aria-hidden="true" />
      </span>
      <h1 className="mt-5 font-display text-2xl font-bold leading-tight text-ink">
        This link can&apos;t be used
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-ink/60">{RECOVERY_SESSION_MISSING_MESSAGE}</p>

      <Link
        href={FORGOT_PASSWORD_PATH}
        className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-brand-700 hover:shadow-md active:scale-[0.98]"
      >
        <Mail className="h-4 w-4" aria-hidden="true" />
        Request a new link
      </Link>

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
