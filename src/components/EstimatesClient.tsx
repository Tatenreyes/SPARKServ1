"use client";

/**
 * The customer's estimate list, grouped by request.
 *
 * The CURRENT version of each request is shown in full (the shared
 * EstimateReviewCard), and every earlier version is available underneath it as
 * history — a revision never destroys what was already reviewed.
 *
 * Drafts cannot appear here: RLS hides `draft` rows from customers, and the page
 * only asks for what it may read.
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import EstimateReviewCard from "@/components/EstimateReviewCard";
import { isCompletedRequestStatus, isOpenEstimateStatus } from "@/lib/estimate-costs";
import type { EstimateRow } from "@/types/database";

interface RequestInfo {
  id: string;
  appliance_type: string;
  problem_description: string;
  /**
   * The request's assignment state. The card needs it because an approved estimate
   * alone is not enough to book: the technician has to have ACCEPTED the request, and
   * a form that cannot succeed is worse than an explanation.
   */
  assignment_status: string;
  /**
   * The request's lifecycle state. Also needed for the same reason, one step later:
   * a repair that is already booked, under way, finished or cancelled cannot be
   * booked again, and this page uses it to keep finished repairs out of the list of
   * work in progress.
   */
  status: string;
}

export default function EstimatesClient({
  initialEstimates,
  requestInfo,
}: {
  initialEstimates: EstimateRow[];
  requestInfo: Record<string, RequestInfo>;
}) {
  const router = useRouter();

  /** Newest first, and only versions the customer is allowed to see. */
  const visible = initialEstimates
    .filter((estimate) => estimate.status !== "draft")
    .sort((a, b) => {
      if (a.service_request_id !== b.service_request_id) return 0;
      return b.version - a.version;
    });

  const byRequest = new Map<string, EstimateRow[]>();
  for (const estimate of visible) {
    const list = byRequest.get(estimate.service_request_id) ?? [];
    // A request/version is one customer-facing estimate. Keep the newest row
    // when legacy or retried submissions created duplicate rows with the same
    // version, otherwise the customer sees the same card twice.
    if (list.some((existing) => existing.version === estimate.version)) continue;
    list.push(estimate);
    byRequest.set(estimate.service_request_id, list);
  }

  if (!visible.length) {
    return (
      <p className="mt-6 text-sm text-ink/50">
        No estimates yet. Your technician sends one after accepting your request.
      </p>
    );
  }

  /** One card per request: the version that still matters, earlier versions behind it. */
  function cardFor(requestId: string, versions: EstimateRow[]) {
    const newest = versions[0];
    const current =
      versions.find((estimate) => isOpenEstimateStatus(estimate.status)) ??
      versions.find((estimate) => estimate.status === "accepted") ??
      newest;
    const history = versions.filter((estimate) => estimate.id !== current.id);

    return (
      <div key={requestId}>
        {/* The card refreshes the server component itself after a decision, so no
            local copy of the list is kept — that is what stops a stale row from
            offering a second decision. */}
        <EstimateReviewCard
          estimate={current}
          history={history}
          request={requestInfo[requestId] ?? null}
          onChanged={() => router.refresh()}
        />
      </div>
    );
  }

  // A completed repair's estimate has MOVED to Service history. It is the record of a
  // finished job, not something to review, and leaving it among the estimates that
  // still want a decision is what made finished work look like an open one.
  //
  // A CANCELLED request keeps its estimate: nothing was repaired, so Service history
  // has no row to carry the quote, and the card itself explains that no appointment
  // can be booked from it.
  const groups = [...byRequest.entries()].filter(
    ([requestId]) => !isCompletedRequestStatus(requestInfo[requestId]?.status)
  );

  if (!groups.length) {
    return (
      <p className="mt-6 text-sm text-ink/50">
        Nothing to review. Your finished repairs and the estimates they were approved at
        are in{" "}
        <Link
          href="/customer/repair-history"
          className="font-semibold text-brand-ink hover:underline"
        >
          Repair history
        </Link>
        .
      </p>
    );
  }

  return (
    <div className="mt-6 space-y-8">
      {groups.map(([requestId, versions]) => cardFor(requestId, versions))}
    </div>
  );
}
