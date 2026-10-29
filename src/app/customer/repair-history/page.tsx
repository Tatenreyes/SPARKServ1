import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { formatMoney, isBookableEstimate } from "@/lib/estimate-costs";
import type { EstimateRow } from "@/types/database";
import { Wrench, Star, Wallet, CalendarClock } from "lucide-react";

export default async function RepairHistoryPage() {
  const user = await getCurrentUser();
  const supabase = createClient();

  const { data: history } = await supabase
    .from("service_history")
    .select("*")
    .eq("customer_id", user!.id)
    .order("completed_at", { ascending: false });

  const { data: ratings } = await supabase
    .from("ratings")
    .select("booking_id, rating, comment")
    .eq("customer_id", user!.id);

  const ratingByBooking = new Map(
    (ratings ?? []).map((rating) => [rating.booking_id, rating])
  );

  // The estimate each finished repair was agreed at.
  //
  // `service_history` archives the BOOKING, not the quote, so the link is
  // booking → its request → the version the appointment was created from:
  // `bookings.estimate_id` names that exact version when the customer booked it
  // themselves, and an administrator-scheduled booking falls back to the request's
  // current approval. This is the half of the move that `/customer/estimates` gave up
  // when the repair completed — the quote is not lost, it changed pages.
  const historyBookingIds = (history ?? []).map((entry) => entry.booking_id);
  const { data: historyBookings } = historyBookingIds.length
    ? await supabase
        .from("bookings")
        .select("id, service_request_id, estimate_id")
        .in("id", historyBookingIds)
    : { data: [] };

  const historyRequestIds = [
    ...new Set((historyBookings ?? []).map((booking) => booking.service_request_id)),
  ];
  const { data: historyEstimates } = historyRequestIds.length
    ? await supabase.from("estimates").select("*").in("service_request_id", historyRequestIds)
    : { data: [] };

  const historyBookingById = new Map(
    (historyBookings ?? []).map((booking) => [booking.id, booking])
  );

  /**
   * The approved estimate a finished repair was agreed at, or `null` when there is
   * none — a card then shows the final cost alone rather than inventing a quote.
   */
  function approvedEstimateFor(bookingId: string): EstimateRow | null {
    const booking = historyBookingById.get(bookingId);
    if (!booking) return null;

    const mine = (historyEstimates ?? []).filter(
      (estimate) => estimate.service_request_id === booking.service_request_id
    );

    return (
      mine.find((estimate) => estimate.id === booking.estimate_id) ??
      mine.find((estimate) => isBookableEstimate(estimate)) ??
      null
    );
  }

  const totalRepairs = history?.length ?? 0;
  const totalSpent = (history ?? []).reduce((sum, h) => sum + (h.final_cost ?? 0), 0);
  const avgRating =
    ratings && ratings.length > 0
      ? ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length
      : null;
  const lastService = history && history.length > 0 ? history[0].completed_at : null;

  return (
    <div>
      <h1 className="font-display text-2xl font-semibold text-ink">Repair history</h1>
      <p className="mt-1 text-sm text-ink/65">Every repair you&apos;ve completed through SPARKServ.</p>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard icon={<Wrench className="h-4 w-4" />} label="Total Repairs" value={String(totalRepairs)} />
        <SummaryCard
          icon={<Star className="h-4 w-4" />}
          label="Avg. Rating"
          value={avgRating != null ? `${avgRating.toFixed(1)}/5` : "—"}
        />
        <SummaryCard
          icon={<Wallet className="h-4 w-4" />}
          label="Total Spent"
          value={`₱${totalSpent.toFixed(0)}`}
        />
        <SummaryCard
          icon={<CalendarClock className="h-4 w-4" />}
          label="Last Service"
          value={lastService ? new Date(lastService).toLocaleDateString() : "—"}
        />
      </div>

      {!history?.length ? (
        <p className="mt-8 text-sm text-ink/50">No completed repairs yet.</p>
      ) : (
        <div className="mt-8 space-y-3">
          {history.map((h) => {
            const rating = ratingByBooking.get(h.booking_id);
            return (
              <div key={h.id} className="rounded-card border border-ink/8 bg-surface p-4 shadow-card">
                <div className="flex items-center justify-between">
                  <p className="font-medium capitalize text-ink">
                    {h.appliance_type.replace(/_/g, " ")}
                  </p>
                  <p className="text-xs text-ink/50">
                    {new Date(h.completed_at).toLocaleDateString()}
                  </p>
                </div>
                {h.final_cost != null && (
                  <p className="mt-1 text-sm text-ink/65">Cost: ₱{h.final_cost.toFixed(2)}</p>
                )}
                {h.summary && <p className="mt-1 text-sm text-ink/50">{h.summary}</p>}

                <ApprovedEstimate estimate={approvedEstimateFor(h.booking_id)} />

                {rating ? (
                  <div className="mt-2">
                    <span
                      className="inline-flex items-center gap-0.5"
                      aria-label={`Rated ${rating.rating} out of 5`}
                    >
                      {[1, 2, 3, 4, 5].map((step) => (
                        <Star
                          key={step}
                          aria-hidden="true"
                          className={`h-3.5 w-3.5 ${
                            step <= rating.rating
                              ? "fill-warn-ink text-warn-ink"
                              : "text-line"
                          }`}
                        />
                      ))}
                    </span>
                    {rating.comment && (
                      <p className="mt-1 text-xs text-ink/60">{rating.comment}</p>
                    )}
                  </div>
                ) : (
                  <Link
                    href={`/customer/bookings/${h.booking_id}`}
                    className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-ink hover:underline"
                  >
                    <Star className="h-3.5 w-3.5" aria-hidden="true" />
                    Rate this repair
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * The approved estimate a finished repair was agreed at, shown as a RECORD.
 *
 * This is where a completed repair's estimate lives now: it left
 * `/customer/estimates` the moment the repair finished, because a finished job has
 * nothing left to review and keeping the quote there made completed work look open.
 * Read-only by design — there is nothing to approve, decline or schedule here.
 */
function ApprovedEstimate({ estimate }: { estimate: EstimateRow | null }) {
  if (!estimate) return null;

  return (
    <div className="mt-2 rounded-xl border border-line bg-soft/50 px-3 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold text-ink">
          Approved estimate · {formatMoney(estimate.estimated_cost)}
        </p>
        <span className="text-[11px] text-muted">
          {estimate.approved_at
            ? `Approved ${new Date(estimate.approved_at).toLocaleDateString()}`
            : `Version ${estimate.version}`}
        </span>
      </div>

      <dl className="mt-1.5 space-y-0.5">
        <CostLine label="Labour" value={estimate.labor_cost} />
        <CostLine label="Parts" value={estimate.parts_cost} />
        <CostLine
          label={
            estimate.other_description
              ? `Additional: ${estimate.other_description}`
              : "Additional charges"
          }
          value={estimate.other_cost}
        />
      </dl>

      {estimate.scope && (
        <p className="mt-1.5 text-[11px] leading-relaxed text-muted">{estimate.scope}</p>
      )}
    </div>
  );
}

function CostLine({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="min-w-0 break-words text-[11px] text-muted">{label}</dt>
      <dd className="shrink-0 text-xs font-medium text-ink/80">{formatMoney(value)}</dd>
    </div>
  );
}

function SummaryCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-card border border-ink/8 bg-surface p-3 shadow-card">
      <div className="flex items-center gap-1.5 text-ink/40">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p className="mt-1.5 font-display text-lg font-semibold text-ink">{value}</p>
    </div>
  );
}
