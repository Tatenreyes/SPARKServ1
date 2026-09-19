import Link from "next/link";
import AuthShell from "@/components/AuthShell";
import { ArrowRight, LogIn, UserPlus } from "lucide-react";

interface ChooseAuthPageProps {
  searchParams: { redirectTo?: string };
}

export default function ChooseAuthPage({ searchParams }: ChooseAuthPageProps) {
  const redirectTo = searchParams.redirectTo || "/customer/request-repair";
  const query = `?redirectTo=${encodeURIComponent(redirectTo)}`;

  return (
    <AuthShell
      headline="Let’s get your repair moving."
      subhead="Choose how you want to continue and we’ll take you straight to your service request."
    >
      <div className="w-full max-w-sm rounded-card border border-ink/8 bg-white p-7 shadow-card">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-600">Start a service</p>
        <h1 className="mt-2 font-display text-2xl font-semibold text-ink">How would you like to continue?</h1>
        <p className="mt-2 text-sm leading-6 text-ink/65">Log in to use your existing account, or create a new customer account in a few moments.</p>
        <div className="mt-7 space-y-3">
          <Link href={`/login${query}`} className="flex items-center justify-between rounded-lg bg-brand-500 px-4 py-3 text-sm font-semibold text-white transition hover:bg-brand-600">
            <span className="flex items-center gap-3"><LogIn className="h-4 w-4" /> Log in</span>
            <ArrowRight className="h-4 w-4" />
          </Link>
          <Link href={`/register${query}`} className="flex items-center justify-between rounded-lg border border-brand-200 bg-brand-50 px-4 py-3 text-sm font-semibold text-brand-700 transition hover:border-brand-400 hover:bg-brand-100">
            <span className="flex items-center gap-3"><UserPlus className="h-4 w-4" /> Sign up</span>
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
        <Link href="/" className="mt-6 block text-center text-xs font-semibold text-slate-500 hover:text-brand-600">Return home</Link>
      </div>
    </AuthShell>
  );
}
