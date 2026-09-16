import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import StatusBadge from "@/components/StatusBadge";
import { CalendarDays, ChevronRight } from "lucide-react";

export default async function CustomerBookingsPage() {
  const user = await getCurrentUser();
  const supabase = createClient();

  const { data: bookings } = await supabase
    .from("bookings")
    .select("*")
    .eq("customer_id", user!.id)
    .order("scheduled_at", { ascending: false });

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 border-b border-slate-200 pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-600">Service schedule</p>
          <h1 className="mt-2 text-3xl font-semibold text-slate-900">Your bookings</h1>
          <p className="mt-2 text-sm text-slate-500">Keep every technician visit in one clear timeline.</p>
        </div>
        <Link href="/customer/inquiry" className="spark-button-primary h-11 px-4">Book a repair</Link>
      </div>
      {!bookings?.length ? (
        <div className="spark-card flex flex-col items-center justify-center px-6 py-16 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-50 text-brand-600"><CalendarDays className="h-6 w-6" /></span>
          <h2 className="mt-5 text-lg font-semibold text-slate-900">No visits scheduled</h2>
          <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">Once you confirm an estimate, your technician visit will appear here.</p>
          <Link href="/customer/inquiry" className="spark-button-secondary mt-6 h-10 px-4">Start a repair</Link>
        </div>
      ) : (
        <div className="space-y-3">
          {bookings.map((b) => (
            <Link
              key={b.id}
              href={`/customer/bookings/${b.id}`}
              className="spark-card group flex items-center justify-between gap-4 p-4 transition hover:-translate-y-0.5 hover:border-brand-300"
            >
              <div className="flex min-w-0 items-center gap-4">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><CalendarDays className="h-5 w-5" /></span>
                <div className="min-w-0">
                  <p className="font-semibold text-slate-900">{new Date(b.scheduled_at).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}</p>
                  <p className="mt-1 truncate text-sm text-slate-500">{new Date(b.scheduled_at).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}</p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-3"><StatusBadge status={b.status} /><ChevronRight className="h-4 w-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-brand-500" /></div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

