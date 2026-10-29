import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { DashboardStatGroup, DashboardPanel } from "@/components/DashboardCard";
import DashboardHero from "@/components/DashboardHero";
import DashboardServiceIllustration from "@/components/DashboardServiceIllustration";
import { ServiceTracking } from "@/components/ServiceTracking";
import { QuickActions } from "@/components/QuickActions";
import { applianceCoverage } from "@/lib/assignment-coverage";
import { isClosedRequestStatus } from "@/lib/estimate-costs";
import { customerAssignmentCopy } from "@/lib/queue";
import { formatPeso, type MobileAction } from "@/lib/customer-actions";
import {
  AlertTriangle,
  CalendarCheck2,
  ClipboardList,
  DollarSign,
  Plus,
  Wrench,
} from "lucide-react";

export default async function CustomerDashboard() {
  const user = await getCurrentUser();
  const supabase = createClient();

  // These reads do not depend on one another, so run them together instead of
  // making dashboard latency the sum of every database round trip.
  const [
    { data: requests },
    { data: bookings },
    { data: payments },
  ] = await Promise.all([
    supabase
      .from("service_requests")
      .select("*")
      .eq("customer_id", user!.id)
      .order("created_at", { ascending: false }),
    supabase
      .from("bookings")
      .select("*")
      .eq("customer_id", user!.id)
      .order("scheduled_at", { ascending: true }),
    supabase
      .from("payments")
      .select("id, booking_id, amount, status")
      .eq("customer_id", user!.id),
  ]);

  // "Active" is the shared rule (`isClosedRequestStatus`), not a local pair of string
  // comparisons: the tile's number and the `?status=active` list it opens must agree.
  const activeRequests = (requests ?? []).filter((r) => !isClosedRequestStatus(r.status));

  const dashboardNow = Date.now();
  const upcomingBookings = (bookings ?? []).filter(
    (booking) =>
      booking.status === "pending" &&
      new Date(booking.scheduled_at).getTime() >= dashboardNow
  );

  const pendingEstimates = (requests ?? []).filter((r) => r.status === "quoted").length;

  // Every payment row for this customer, so a single query answers three
  // questions: how many are still awaiting admin verification (the "awaiting
  // payment" tile), which bookings already have money against them (so the
  // Action centre never asks twice), and which finished repairs have nothing
  // paid against them at all.
  //
  // This replaces a `head: true` count. The count was correct but blind: the
  // same rows are needed to decide whether a payment card belongs on screen, and
  // fetching them once beats three round trips to the same table.
  const pendingPayments = (payments ?? []).filter(
    (payment) => payment.status === "pending_verification"
  ).length;

  const settledBookingIds = new Set(
    (payments ?? [])
      .filter((payment) => payment.status !== "rejected")
      .map((payment) => payment.booking_id)
  );

  // Estimates for this customer's own requests, newest first, so the tracking
  // strip can resolve its estimate/approval steps without a query per request.
  const requestIds = (requests ?? []).map((request) => request.id);
  const { data: estimates } = requestIds.length
    ? await supabase
        .from("estimates")
        .select("*")
        .in("service_request_id", requestIds)
        .order("created_at", { ascending: false })
    : { data: [] };

  // The request the tracking strip follows: the newest LIVE one. There is deliberately
  // no fallback to a finished request — "Service tracking" means what is happening now,
  // and a completed or cancelled repair belongs to Service history. The fallback that
  // used to be here drew a full seven-step rail for a closed job, under a heading that
  // claimed to be tracking it.
  const trackedRequest = activeRequests[0] ?? null;

  const trackedBookings = trackedRequest
    ? (bookings ?? [])
        .filter((booking) => booking.service_request_id === trackedRequest.id)
        // `bookings` is fetched ascending by scheduled_at; the tracking strip
        // expects newest first so it resolves the live booking, not the oldest.
        .reverse()
    : [];
  const trackedEstimates = trackedRequest
    ? (estimates ?? []).filter(
        (estimate) => estimate.service_request_id === trackedRequest.id
      )
    : [];

  /**
   * Has this repair actually started moving? The rail is seven steps, and only from
   * step 2 is there anything to TRACK: a request that is still `waiting`/`matching`
   * with no estimate and no appointment is a request, not progress, and drawing step 1
   * of 7 for it under "Service tracking" is what made an untouched request look like
   * work in flight.
   *
   * A booking or a non-draft estimate implies an accepted assignment (both are written
   * only for the assigned technician), but the assignment is checked first because it
   * is the earliest of the three.
   */
  const trackedHasProgress = Boolean(
    trackedRequest &&
      (trackedRequest.assignment_status === "accepted" ||
        trackedBookings.length > 0 ||
        trackedEstimates.some((estimate) => estimate.status !== "draft"))
  );

  // Coverage is asked only for the one state that has no rail to carry the answer: a
  // live request nobody has taken. Asking about a request that is already moving — or
  // finished — would be a wasted round trip.
  const trackedCoverage =
    trackedRequest && !trackedHasProgress && !trackedRequest.assigned_technician_id
      ? await applianceCoverage(trackedRequest.appliance_type)
      : null;

  /**
   * The dead end, on the dashboard: nobody covers this appliance, so there is nothing
   * to wait for. Same shared wording as the request page and the strip, so the three
   * cannot drift apart — and it replaces the rail rather than sitting beside it.
   */
  const coverageNotice =
    trackedRequest && !trackedHasProgress && trackedCoverage === false
      ? customerAssignmentCopy("waiting", { qualifiedTechnicianAvailable: false })
      : null;

  /**
   * The Action centre.
   *
   * Every card here is a decision the customer owns — approve a cost, confirm a
   * date, inspect the work, settle a balance. Nothing is invented: each item is
   * read from the request, estimate, booking and payment rows already fetched
   * above, so the list cannot disagree with the pages it links to. If the list is
   * empty, the customer genuinely has nothing to do.
   *
   * Ordered the way the work happens: the estimate decides whether the job
   * starts, the scheduling follows it, then the inspection, then the money.
   */
  const requestById = new Map((requests ?? []).map((request) => [request.id, request]));
  const actions: MobileAction[] = [];

  function applianceOf(serviceRequestId: string) {
    return requestById
      .get(serviceRequestId)
      ?.appliance_type?.replace(/_/g, " ");
  }

  function formatSlot(iso: string) {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "a date to be agreed";
    return date.toLocaleString("en-US", {
      month: "long",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  }

  // 1. A cost estimate waiting on approval or rejection.
  for (const estimate of estimates ?? []) {
    if (estimate.status !== "pending") continue;
    actions.push({
      id: `estimate-${estimate.id}`,
      kind: "estimate",
      title: "Estimate ready",
      subject: applianceOf(estimate.service_request_id),
      amount: estimate.estimated_cost,
      detail:
        estimate.notes ??
        "Approve it to let your technician book the visit. Nothing is charged until you approve.",
      cta: "Review estimate",
      href: "/customer/estimates",
    });
  }

  // 2. A visit that is scheduled but not yet confirmed by the customer.
  for (const booking of upcomingBookings) {
    if (booking.status !== "pending") continue;
    actions.push({
      id: `schedule-${booking.id}`,
      kind: "schedule",
      title: "Schedule confirmation required",
      subject: applianceOf(booking.service_request_id),
      detail: `Your technician proposed ${formatSlot(booking.scheduled_at)}.`,
      cta: "Confirm schedule",
      href: `/customer/bookings/${booking.id}`,
    });
  }

  // 3. A finished repair waiting on the customer's own inspection (§33). The
  //    repair is NOT finalised until they answer, so this is a real action.
  for (const booking of bookings ?? []) {
    if (booking.status !== "awaiting_inspection") continue;
    if (booking.inspection_confirmed_at) continue;
    actions.push({
      id: `inspection-${booking.id}`,
      kind: "inspection",
      title: "Repair finished — please inspect",
      subject: applianceOf(booking.service_request_id),
      detail: "Check the appliance works before the repair is completed and billed.",
      cta: "Inspect appliance",
      href: `/customer/bookings/${booking.id}`,
    });
  }

  // 4. A repair waiting for the customer's payment reference. Under the confirmed
  //    policy a booking reaches `awaiting_payment` when the customer has accepted
  //    the inspection, and only an administrator's verification completes it.
  for (const booking of bookings ?? []) {
    if (booking.status !== "awaiting_payment") continue;
    if (settledBookingIds.has(booking.id)) continue;
    const acceptedEstimate = (estimates ?? []).find(
      (estimate) =>
        estimate.service_request_id === booking.service_request_id &&
        estimate.status === "accepted"
    );
    actions.push({
      id: `payment-due-${booking.id}`,
      kind: "payment",
      title: "Payment required",
      subject: applianceOf(booking.service_request_id),
      amount: booking.final_cost ?? acceptedEstimate?.estimated_cost,
      detail:
        "Submit your GCash reference and an administrator will verify it. The repair is completed only after that check.",
      cta: "Submit payment",
      href: `/customer/bookings/${booking.id}`,
    });
  }

  // 5. A booking completed before the payment step was required, with nothing paid
  //    against it yet — the legacy path, still surfaced so it is not forgotten.
  for (const booking of bookings ?? []) {
    if (booking.status !== "completed") continue;
    if (settledBookingIds.has(booking.id)) continue;
    const acceptedEstimate = (estimates ?? []).find(
      (estimate) =>
        estimate.service_request_id === booking.service_request_id &&
        estimate.status === "accepted"
    );
    // A different sentence from the card above on purpose: the repair is already
    // finished, so "Payment required" (which reads as a step in the workflow)
    // would be wrong, and two identically-titled cards cannot be told apart.
    actions.push({
      id: `payment-outstanding-${booking.id}`,
      kind: "payment",
      title: "Payment outstanding",
      subject: applianceOf(booking.service_request_id),
      amount: booking.final_cost ?? acceptedEstimate?.estimated_cost,
      detail:
        "The repair is complete but no verified payment is on file. Upload your GCash reference and we'll verify it — payment is confirmed only after an administrator checks it.",
      cta: "Review payment",
      href: `/customer/bookings/${booking.id}`,
    });
  }

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  // Tighter vertical rhythm on a phone: at 360px a 24px gap between every
  // section is a scroll of nothing but margins, and a phone is where the person
  // is trying to reach one specific card. Unchanged from `md` up.
  return (
    <div className="space-y-4 md:space-y-5">
      <DashboardHero
        eyebrow="Customer workspace"
        title={`${greeting}, ${user?.name?.split(" ")[0] ?? "there"}`}
        subtitle="Your repairs, appointments, and next steps at a glance."
        illustration={<DashboardServiceIllustration />}
        actions={
          <Link
            href="/customer/request-repair"
            className="inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-accent-500 px-5 text-sm font-semibold text-white shadow-sm transition duration-200 hover:bg-accent-600"
          >
            <Plus className="h-4 w-4" />
            Start service inquiry
          </Link>
        }
      />

      {/* The platform announcement is deliberately not a card here any more. It
          is platform-wide, so it renders in the topbar every workspace shares
          (`PlatformAnnouncementTicker`, fed by `usePlatformAnnouncement`), which
          also means this page no longer reads `system_settings`. */}

      <DashboardStatGroup
        items={[
          {
            label: "Active repairs",
            value: activeRequests.length,
            // The list of this customer's requests — NOT `/customer/service-request`,
            // which is a legacy alias that redirects to the new-request wizard, so
            // the tile used to open a blank "service inquiry" form. `?status=active`
            // is the same view this tile counts, so the number and the list agree.
            href: "/customer/repairs/requests?status=active",
            icon: Wrench,
            colorClass: "bg-brand-soft text-brand-ink",
            hint: "View requests",
          },
          {
            label: "Pending estimates",
            value: pendingEstimates,
            href: "/customer/estimates",
            icon: ClipboardList,
            colorClass: "bg-warn-soft text-warn-ink",
            hint: pendingEstimates > 0 ? "Review and approve" : "All reviewed",
          },
          {
            label: "Upcoming visits",
            value: upcomingBookings.length,
            href: "/customer/bookings",
            icon: CalendarCheck2,
            colorClass: "bg-brand-soft text-brand-ink",
            hint: "See schedule",
          },
          {
            label: "Awaiting payment",
            value: pendingPayments,
            href: "/customer/bookings",
            icon: DollarSign,
            colorClass: "bg-accent-soft text-accent-ink",
            hint: pendingPayments > 0 ? "Settle balance" : "Nothing due",
          },
        ]}
      />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-12 xl:gap-5">
        <section
        aria-labelledby="next-step-heading"
          className="h-full md:order-1 overflow-hidden rounded-card border border-line bg-surface shadow-[0_1px_2px_rgba(16,38,74,0.04)] md:col-span-1 xl:col-span-6"
      >
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3 sm:px-5">
          <div>
            <p className="spark-eyebrow">Your dashboard</p>
            <h2 id="next-step-heading" className="mt-1 font-display text-base font-semibold text-ink">
              {actions.length > 0 ? "Next step" : "You’re all caught up"}
            </h2>
          </div>
          {actions.length > 0 && (
            <span className="rounded-full bg-warn-soft px-3 py-1 text-xs font-semibold text-warn-ink">
              {actions.length} item{actions.length === 1 ? "" : "s"} need{actions.length === 1 ? "s" : ""} attention
            </span>
          )}
        </div>
        {actions.length > 0 ? (
          <div className="flex flex-col gap-4 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-5 sm:py-5">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-ink">
                {actions[0].title}{actions[0].subject ? ` · ${actions[0].subject}` : ""}
              </p>
              {actions[0].detail && (
                <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">{actions[0].detail}</p>
              )}
              {typeof actions[0].amount === "number" && (
                <p className="mt-2 font-display text-lg font-bold text-ink">
                  {formatPeso(actions[0].amount)}
                </p>
              )}
              {actions.length > 1 && (
                <Link href="/customer/repairs" className="mt-2 inline-block text-xs font-semibold text-brand-ink hover:underline">
                  See all {actions.length} items
                </Link>
              )}
            </div>
            <Link
              href={actions[0].href}
              className="inline-flex h-11 w-full shrink-0 cursor-pointer items-center justify-center rounded-xl bg-brand-500 px-5 text-sm font-semibold text-white transition hover:bg-brand-600 sm:w-auto"
            >
              {actions[0].cta}
            </Link>
          </div>
        ) : (
          <p className="px-4 py-4 text-sm text-muted sm:px-5">
            We’ll let you know when there’s something to review.
            {trackedHasProgress ? " You can check your repair progress below." : ""}
          </p>
        )}
        </section>

        <div className="space-y-5 md:space-y-0 md:contents">
          {/* The rail exists only when there is progress to show. A request that is
              still waiting for a technician, or one that is already finished, has
              nothing for a seven-step tracker to report — and drawing step 1 of 7 for
              it is what made an untouched request look like work in flight. */}
          {trackedHasProgress && trackedRequest && (
            <DashboardPanel
              title="Service tracking"
              icon={Wrench}
              className="md:order-3 md:col-span-2 xl:col-span-12"
              action={
                <Link
                  href="/customer/progress-tracking"
                  className="text-xs font-semibold text-brand-ink hover:underline"
                >
                  View all
                </Link>
              }
            >
              {/* Bound to the real request/booking/estimate rows — this strip used
                  to be a hardcoded bar with a fixed caption. */}
              <ServiceTracking
                request={trackedRequest}
                bookings={trackedBookings}
                estimates={trackedEstimates}
                qualifiedTechnicianAvailable={trackedCoverage}
              />
            </DashboardPanel>
          )}

          {/* No rail to draw, but the customer still needs the one fact that changes
              what they should do about it: nobody covers this appliance, so waiting is
              pointless. Same shared wording as the request page. */}
          {coverageNotice && trackedRequest && (
            <div className="rounded-card border border-warn-ink/30 bg-warn-soft p-4 shadow-card sm:p-5 md:order-3 md:col-span-2 xl:col-span-12">
              <p className="flex items-start gap-1.5 text-sm font-semibold text-warn-ink">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {coverageNotice.title}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-warn-ink/80">
                {coverageNotice.body}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link
                  href="/customer/support"
                  className="inline-flex h-9 items-center rounded-lg bg-warn-ink px-4 text-xs font-semibold text-white transition hover:opacity-90"
                >
                  Contact support
                </Link>
                <Link
                  href={`/customer/service-request/${trackedRequest.id}`}
                  className="inline-flex h-9 items-center rounded-lg border border-warn-ink/30 px-4 text-xs font-semibold text-warn-ink transition hover:bg-surface"
                >
                  View your request
                </Link>
              </div>
            </div>
          )}
        </div>

        <div className="space-y-5 md:space-y-0 md:contents">

          <DashboardPanel title="Quick actions" bodyClassName="px-3 pb-3 pt-2" className="h-full md:order-2 md:col-span-1 xl:col-span-6">
            <QuickActions />
          </DashboardPanel>
        </div>
      </div>
    </div>
  );
}
