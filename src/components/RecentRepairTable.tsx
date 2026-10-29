import Link from "next/link";
import { ChevronRight, ClipboardList } from "lucide-react";
import StatusBadge from "@/components/StatusBadge";
import MobileRepairCard, { repairCta } from "@/components/mobile/MobileRepairCard";
import type { ServiceRequestRow } from "@/types/database";

/** Micro header label — shared so every table in the app scans the same way. */
const TH =
  "pb-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted whitespace-nowrap";

/**
 * Recent repairs, in whichever shape the viewport can actually hold.
 *
 * Below `md` this is a stack of cards; from `md` up it is the table it always
 * was. Both render from the same rows, so the two can never disagree — the
 * alternative (a horizontally scrolling table) technically "works" on a phone
 * and is unusable: it hides the status column behind a swipe, and a swipe inside
 * a vertically scrolling page is a gesture users do by accident.
 */
export function RecentRepairTable({
  requests,
  limit = 5,
}: {
  requests: ServiceRequestRow[];
  /**
   * How many to show. The dashboard wants the latest handful; the paged
   * "Repair requests" screen has already asked the database for exactly one
   * page, so it passes that page size and no slicing happens beyond it.
   */
  limit?: number;
}) {
  if (!requests?.length) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-soft text-muted/80">
          <ClipboardList className="h-5 w-5" />
        </span>
        <p className="mt-3 text-sm font-medium text-ink">No repairs yet</p>
        <p className="mt-1 text-xs text-muted">
          You don&apos;t have any repair requests yet. Tell us what&apos;s wrong and
          we&apos;ll match you with a technician.
        </p>
        <Link
          href="/customer/request-repair"
          className="mt-4 inline-flex h-11 cursor-pointer items-center gap-2 rounded-lg bg-brand-600 px-4 text-xs font-semibold text-white transition duration-200 hover:bg-brand-700"
        >
          Start service inquiry
        </Link>
      </div>
    );
  }

  const recent = requests.slice(0, limit);

  return (
    <>
      {/* Phone: cards. */}
      <ul className="space-y-3 md:hidden">
        {recent.map((request) => (
          <li key={request.id}>
            <MobileRepairCard
              applianceType={request.appliance_type}
              problem={request.issue_category ?? request.problem_description}
              status={request.status}
              dateISO={request.created_at}
              href={`/customer/service-request/${request.id}`}
              cta={repairCta(request.status)}
            />
          </li>
        ))}
      </ul>

      {/* Desktop: the table. */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-line">
              <th className={TH}>Reference</th>
              <th className={TH}>Appliance</th>
              <th className={TH}>Status</th>
              <th className={`${TH} text-right`}>Submitted</th>
              <th className={TH}>
                <span className="sr-only">Open request</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {recent.map((request) => (
              <tr key={request.id} className="transition duration-200 hover:bg-soft/70">
                <td className="py-3.5 pr-4 align-top">
                  <span className="font-mono text-[11px] text-muted">
                    #{request.id.slice(0, 8)}
                  </span>
                </td>
                <td className="py-3.5 pr-4 align-top">
                  {/* Appliance + issue stacked, so the row carries the useful
                      context instead of truncating the description mid-word. */}
                  <p className="font-medium capitalize text-ink">
                    {request.appliance_type?.replace(/_/g, " ") ?? "—"}
                  </p>
                  <p className="mt-0.5 line-clamp-1 text-xs text-muted">
                    {request.issue_category ?? request.problem_description ?? "—"}
                  </p>
                </td>
                <td className="py-3.5 pr-4 align-top">
                  <StatusBadge status={request.status} size="sm" withDot />
                </td>
                <td className="whitespace-nowrap py-3.5 text-right align-top text-xs text-muted">
                  {new Date(request.created_at).toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                  })}
                </td>
                <td className="py-3.5 pl-4 text-right align-top">
                  {/* `/customer/service-request/[id]` already existed but nothing
                      on the dashboard linked to it. */}
                  <Link
                    href={`/customer/service-request/${request.id}`}
                    aria-label={`Open request ${request.id.slice(0, 8)}`}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted/80 transition duration-200 hover:bg-brand-soft hover:text-brand-ink"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

