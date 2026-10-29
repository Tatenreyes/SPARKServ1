import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import { CLOSED_REQUEST_STATUSES } from "@/lib/estimate-costs";
import { RecentRepairTable } from "@/components/RecentRepairTable";

/**
 * One page of the customer's repair requests.
 *
 * Ten per page, newest first, paged on the server via `?page=`. Paging in the
 * database rather than fetching everything and slicing in the browser matters on
 * a phone: a long-standing customer can accumulate hundreds of requests, and
 * shipping all of them to render ten is the single easiest way to make the
 * mobile app feel slow. The count is a separate `head: true` query so PostgREST
 * returns no rows for it — the same pattern the admin dashboard already uses.
 */
const PAGE_SIZE = 10;

export default async function MyRepairRequestsPage({
  searchParams,
}: {
  searchParams?: { page?: string; status?: string };
}) {
  const user = await getCurrentUser();
  const supabase = createClient();

  const parsed = Number.parseInt(searchParams?.page ?? "1", 10);
  const page = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  const from = (page - 1) * PAGE_SIZE;

  /**
   * `?status=active` is the view the dashboard's "Active repairs" tile opens, so the
   * number on the tile and the list behind it agree.
   *
   * The filter goes into BOTH queries — the page and its count — because a count that
   * ignored it would give the pager the wrong number of pages. The statuses come from
   * `CLOSED_REQUEST_STATUSES`, the same list `isClosedRequestStatus()` answers from,
   * so the SQL filter and every client-side check stay one rule.
   */
  const onlyActive = searchParams?.status === "active";
  const closedFilter = `(${CLOSED_REQUEST_STATUSES.join(",")})`;

  let requestsQuery = supabase
    .from("service_requests")
    .select("*")
    .eq("customer_id", user!.id)
    .order("created_at", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);

  let countQuery = supabase
    .from("service_requests")
    .select("*", { count: "exact", head: true })
    .eq("customer_id", user!.id);

  if (onlyActive) {
    requestsQuery = requestsQuery.not("status", "in", closedFilter);
    countQuery = countQuery.not("status", "in", closedFilter);
  }

  const [{ data: requests }, { count }] = await Promise.all([requestsQuery, countQuery]);

  const total = count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasPrevious = page > 1;
  const hasNext = page < pageCount;

  /** Paging must not drop the view the customer is in. */
  const pageHref = (target: number) =>
    `/customer/repairs/requests?page=${target}${onlyActive ? "&status=active" : ""}`;

  return (
    <div className="space-y-5">
      <div>
        <p className="spark-eyebrow">Repairs</p>
        <h1 className="mt-1.5 font-display text-2xl font-bold tracking-tight text-ink">
          Repair requests
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          {total === 0
            ? onlyActive
              ? "Nothing is waiting — every request you have submitted is finished or cancelled."
              : "Every request you submit will be listed here."
            : `${total} ${onlyActive ? "active " : ""}request${total === 1 ? "" : "s"} · newest first`}
        </p>
        <Link
          href={onlyActive ? "/customer/repairs/requests" : "/customer/repairs/requests?status=active"}
          className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-brand-ink hover:underline"
        >
          {onlyActive ? "Show every request" : "Show active only"}
        </Link>
      </div>

      {onlyActive && total === 0 ? (
        /* The table's own empty state reads "no repair requests yet", which would be
           wrong here: the customer does have requests, they are simply closed. */
        <div className="rounded-card border border-line bg-surface px-4 py-8 text-center shadow-[0_1px_2px_rgba(16,38,74,0.04)] sm:px-5">
          <p className="text-sm font-medium text-ink">Nothing active right now</p>
          <p className="mt-1 text-xs text-muted">
            Every request you have submitted is either finished or cancelled.
          </p>
        </div>
      ) : (
        <div className="rounded-card border border-line bg-surface px-4 py-4 shadow-[0_1px_2px_rgba(16,38,74,0.04)] sm:px-5">
          <RecentRepairTable requests={requests ?? []} limit={PAGE_SIZE} />
        </div>
      )}

      {pageCount > 1 && (
        <nav
          aria-label="Request pages"
          className="flex items-center justify-between gap-3"
        >
          <PageLink
            href={pageHref(page - 1)}
            disabled={!hasPrevious}
            direction="previous"
          />
          <p className="text-xs font-semibold text-muted">
            Page {page} of {pageCount}
          </p>
          <PageLink
            href={pageHref(page + 1)}
            disabled={!hasNext}
            direction="next"
          />
        </nav>
      )}
    </div>
  );
}

/**
 * A page step. Rendered as a disabled `<span>` rather than a dead link when it
 * is unavailable, so a screen reader does not announce a link that goes nowhere.
 */
function PageLink({
  href,
  disabled,
  direction,
}: {
  href: string;
  disabled: boolean;
  direction: "previous" | "next";
}) {
  const label = direction === "previous" ? "Previous" : "Next";
  const icon =
    direction === "previous" ? (
      <ChevronLeft className="h-4 w-4" aria-hidden="true" />
    ) : (
      <ChevronRight className="h-4 w-4" aria-hidden="true" />
    );

  if (disabled) {
    return (
      <span className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-line px-4 text-sm font-semibold text-muted/50">
        {icon}
        {label}
      </span>
    );
  }

  return (
    <Link
      href={href}
      className="inline-flex h-11 cursor-pointer items-center gap-1.5 rounded-xl border border-brand-600 bg-surface px-4 text-sm font-semibold text-brand-ink transition duration-200 hover:bg-brand-soft"
    >
      {icon}
      {label}
    </Link>
  );
}
