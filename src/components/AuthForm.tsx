"use client";

import { useState, useId } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import LoadingScreen from "@/components/LoadingScreen";
import { Eye, EyeOff, UserRoundCog, Wrench, Lock, Mail, User } from "lucide-react";
import { MIN_PASSWORD_LENGTH, PASSWORD_HINT } from "@/lib/password";

interface AuthFormProps {
  mode: "login" | "register";
}

/**
 * Fallback for the Suspense boundary every caller of `AuthForm` must provide.
 *
 * `AuthForm` reads `?redirectTo=` through `useSearchParams()`, which opts the
 * route out of static rendering unless the component is wrapped in Suspense. The
 * root layout used to carry `force-dynamic`, which hid that requirement by
 * making the whole site dynamic; with it removed the boundary is load-bearing.
 *
 * It mirrors the form's box so the swap does not shift the layout: same
 * `max-w-[420px]` column, same heading block, then `rows` input-sized rows —
 * three for login, more for the taller registration form.
 */
export function AuthFormSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="w-full max-w-[420px]" aria-hidden="true">
      <div className="mb-8">
        <div className="h-8 w-56 animate-pulse rounded-lg bg-soft" />
        <div className="mt-3 h-4 w-72 animate-pulse rounded bg-soft" />
      </div>
      <div className="space-y-5">
        {Array.from({ length: rows }, (_, row) => (
          <div key={row} className="space-y-1.5">
            <div className="h-4 w-28 animate-pulse rounded bg-soft" />
            <div className="h-11 w-full animate-pulse rounded-xl bg-soft" />
          </div>
        ))}
        <div className="h-12 w-full animate-pulse rounded-xl bg-soft" />
      </div>
    </div>
  );
}

export default function AuthForm({ mode }: AuthFormProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createClient();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"customer" | "technician">("customer");
  const [agreedToPolicy, setAgreedToPolicy] = useState(false);
  const [agreedToPrivacy, setAgreedToPrivacy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const emailId = useId();
  const passwordId = useId();
  const nameId = useId();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (mode === "register" && (!agreedToPolicy || !agreedToPrivacy)) {
      setError("Please agree to the policies and privacy policy to continue.");
      return;
    }

    setLoading(true);

    try {
      if (mode === "register") {
        const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
          email,
          password,
          options: {
            data: { name, role },
          },
        });
        if (signUpError) throw signUpError;

        if (signUpData.user) {
          const profileRes = await fetch("/api/auth/ensure-profile", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId: signUpData.user.id }),
          });
          if (!profileRes.ok) {
            throw new Error("Account was created, but the profile could not be initialized.");
          }
        }
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });
        if (signInError) throw signInError;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (user) {
        const { data: profile } = await supabase
          .from("users")
          .select("role")
          .eq("id", user.id)
          .single();

        const roleHome: Record<string, string> = {
          customer: "/customer/dashboard",
          technician: "/technician/dashboard",
          admin: "/admin/dashboard",
          super_admin: "/superadmin/dashboard",
        };
        const redirectTo = searchParams.get("redirectTo");
        router.push(redirectTo || roleHome[profile?.role ?? "customer"] || "/");
        router.refresh();
      } else {
        setError("Check your email to confirm your account before logging in.");
      }
    } catch (err) {
      setError(err instanceof TypeError && err.message === "Failed to fetch"
        ? "Unable to connect to the authentication service. Check your internet connection and refresh the page."
        : err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {loading && <LoadingScreen message={mode === "login" ? "Signing you in..." : "Creating your account..."} />}
      <div className="w-full max-w-[420px]">
        <div className="mb-8">
          <h1 className="font-display text-2xl font-bold text-ink leading-tight">
            {mode === "login" ? "Welcome back" : "Create your account"}
          </h1>
          <p className="mt-2 text-sm text-ink/60 leading-relaxed">
            {mode === "login"
              ? "Log in to manage your service requests and track repairs."
              : "Sign up to get started with SPARKServ today."}
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {mode === "register" && (
            <div className="space-y-1.5">
              <label htmlFor={nameId} className="flex items-center gap-2 text-sm font-semibold text-ink/80">
                <User className="h-4 w-4 text-ink/40" />
                Full name
              </label>
              <input
                id={nameId}
                required
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-xl border border-ink/10 bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-ink/30 transition-all duration-200 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10"
                placeholder="Juan Dela Cruz"
              />
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor={emailId} className="flex items-center gap-2 text-sm font-semibold text-ink/80">
              <Mail className="h-4 w-4 text-ink/40" />
              Email address
            </label>
            <input
              id={emailId}
              required
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full rounded-xl border border-ink/10 bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-ink/30 transition-all duration-200 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10"
              placeholder="Enter your email"
            />
          </div>

          <div className="space-y-1.5">
            {/* The label and the "Forgot password?" link share one row: the link
                is login-only, and the password field itself is unchanged. */}
            <div className="flex items-center justify-between gap-3">
              <label htmlFor={passwordId} className="flex items-center gap-2 text-sm font-semibold text-ink/80">
                <Lock className="h-4 w-4 text-ink/40" />
                Password
              </label>
              {mode === "login" && (
                <Link
                  href="/forgot-password"
                  className="text-xs font-semibold text-brand-ink underline-offset-4 transition-colors hover:underline"
                >
                  Forgot password?
                </Link>
              )}
            </div>
            <div className="relative">
              <input
                id={passwordId}
                required
                type={showPassword ? "text" : "password"}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                minLength={MIN_PASSWORD_LENGTH}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-ink/10 bg-surface px-3.5 py-2.5 pr-10 text-sm text-ink placeholder:text-ink/30 transition-all duration-200 focus:border-brand-500 focus:ring-4 focus:ring-brand-500/10"
                placeholder="Enter your password"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-ink/30 hover:text-ink/60 transition-colors"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {mode === "register" && (
              <p className="text-xs text-ink/40">{PASSWORD_HINT}</p>
            )}
          </div>

          {mode === "register" && (
            <div className="space-y-2.5">
              <p className="text-sm font-semibold text-ink/80">Choose account type</p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  type="button"
                  aria-pressed={role === "customer"}
                  onClick={() => setRole("customer")}
                  className={`flex flex-col items-center justify-center gap-2.5 rounded-xl border-2 p-4 transition-all duration-200 ${
                    role === "customer"
                      ? "border-brand-500 bg-brand-soft shadow-sm"
                      : "border-ink/10 bg-surface hover:border-ink/20"
                  }`}
                >
                  <div className={`flex h-10 w-10 items-center justify-center rounded-full ${
                    role === "customer" ? "bg-brand-500 text-white" : "bg-ink/5 text-ink/50"
                  }`}>
                    <UserRoundCog className="h-5 w-5" />
                  </div>
                  <div className="text-center">
                    <p className={`text-sm font-semibold ${role === "customer" ? "text-ink" : "text-ink/70"}`}>
                      Customer
                    </p>
                    <p className="text-xs text-ink/50">Looking for repairs</p>
                  </div>
                </button>

                <button
                  type="button"
                  aria-pressed={role === "technician"}
                  onClick={() => setRole("technician")}
                  className={`flex flex-col items-center justify-center gap-2.5 rounded-xl border-2 p-4 transition-all duration-200 ${
                    role === "technician"
                      ? "border-brand-500 bg-brand-soft shadow-sm"
                      : "border-ink/10 bg-surface hover:border-ink/20"
                  }`}
                >
                  <div className={`flex h-10 w-10 items-center justify-center rounded-full ${
                    role === "technician" ? "bg-brand-500 text-white" : "bg-ink/5 text-ink/50"
                  }`}>
                    <Wrench className="h-5 w-5" />
                  </div>
                  <div className="text-center">
                    <p className={`text-sm font-semibold ${role === "technician" ? "text-ink" : "text-ink/70"}`}>
                      Technician
                    </p>
                    <p className="text-xs text-ink/50">Offering repairs</p>
                  </div>
                </button>
              </div>
              {role === "technician" && (
                <div className="flex items-start gap-2 rounded-lg bg-warn-soft px-3 py-2.5 text-xs text-warn-ink">
                  <svg className="h-4 w-4 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                  <span>Technician accounts require admin approval before they can receive work from the queue.</span>
                </div>
              )}
            </div>
          )}

          {mode === "register" && (
            <div className="space-y-3 rounded-xl border border-ink/8 bg-surface p-4">
              <label className="flex items-start gap-3 cursor-pointer group">
                <div className="relative mt-0.5">
                  <input
                    type="checkbox"
                    checked={agreedToPolicy}
                    onChange={(e) => setAgreedToPolicy(e.target.checked)}
                    className="peer h-5 w-5 shrink-0 appearance-none rounded-md border-2 border-muted bg-surface checked:border-brand-600 checked:bg-brand-600 transition-colors duration-200 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
                  />
                  <svg className="absolute left-0.5 top-0.5 h-3.5 w-3.5 text-white opacity-0 peer-checked:opacity-100 transition-opacity pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <span className="text-xs text-ink/70 leading-relaxed">
                  I agree to the SPARKServ{" "}
                  <Link
                    href={role === "technician" ? "/policies/technician" : "/policies/customer"}
                    target="_blank"
                    className="font-semibold text-brand-ink hover:text-brand-ink underline underline-offset-2"
                  >
                    {role === "technician" ? "Technician Policies" : "Customer Policies"}
                  </Link>
                </span>
              </label>
              <label className="flex items-start gap-3 cursor-pointer group">
                <div className="relative mt-0.5">
                  <input
                    type="checkbox"
                    checked={agreedToPrivacy}
                    onChange={(e) => setAgreedToPrivacy(e.target.checked)}
                    className="peer h-5 w-5 shrink-0 appearance-none rounded-md border-2 border-muted bg-surface checked:border-brand-600 checked:bg-brand-600 transition-colors duration-200 cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
                  />
                  <svg className="absolute left-0.5 top-0.5 h-3.5 w-3.5 text-white opacity-0 peer-checked:opacity-100 transition-opacity pointer-events-none" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </div>
                <span className="text-xs text-ink/70 leading-relaxed">
                  I acknowledge the{" "}
                  <Link
                    href="/policies/privacy"
                    target="_blank"
                    className="font-semibold text-brand-ink hover:text-brand-ink underline underline-offset-2"
                  >
                    Privacy Policy
                  </Link>
                </span>
              </label>
            </div>
          )}

          {error && (
            <div role="alert" className="flex min-w-0 items-start gap-2.5 rounded-xl bg-alert-soft px-4 py-3 text-sm text-alert-ink">
              <svg className="mt-0.5 h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span className="min-w-0 flex-1 leading-relaxed">{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-xl bg-brand-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-brand-700 hover:shadow-md active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed disabled:active:scale-100"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Please wait...
              </span>
            ) : mode === "login" ? (
              "Log in"
            ) : (
              "Sign up"
            )}
          </button>
        </form>

        <p className="mt-6 text-center text-sm text-ink/60">
          {mode === "login" ? (
            <>
              Don&apos;t have an account?{" "}
              <Link href="/register" className="font-semibold text-brand-ink hover:text-brand-ink underline underline-offset-2 transition-colors">
                Sign up
              </Link>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <Link href="/login" className="font-semibold text-brand-ink hover:text-brand-ink underline underline-offset-2 transition-colors">
                Log in
              </Link>
            </>
          )}
        </p>
      </div>
    </>
  );
}
