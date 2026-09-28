import Link from "next/link";
import { ChevronRight, ClipboardList } from "lucide-react";
import StatusBadge from "@/components/StatusBadge";
import type { ServiceRequestRow } from "@/types/database";

/** Micro header label — shared so every table in the app scans the same way. */
const TH =
  "pb-2.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted whitespace-nowrap";

export function RecentRepairTable({ requests }: { requests: ServiceRequestRow[] }) {
  if (!requests?.length) {
    return (
      <div className="flex flex-col items-center justify-center py-10 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-soft text-muted/80">
          <ClipboardList className="h-5 w-5" />
        </span>
        <p className="mt-3 text-sm font-medium text-ink">No repair requests yet</p>
        <p className="mt-1 text-xs text-muted">
          Tell us what&apos;s wrong and we&apos;ll match you with a technician.
        </p>
        <Link
          href="/customer/request-repair"
          className="mt-4 inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg bg-brand-600 px-4 text-xs font-semibold text-white transition duration-200 hover:bg-brand-700"
        >
          Start a service inquiry
        </Link>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
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
          {requests.slice(0, 5).map((request) => (
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
  );
}

