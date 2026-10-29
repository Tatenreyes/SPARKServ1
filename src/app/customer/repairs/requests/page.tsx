import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
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
  searchParams?: { page?: string };
}) {
  const user = await getCurrentUser();
  const supabase = createClient();

  const parsed = Number.parseInt(searchParams?.page ?? "1", 10);
  const page = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  const from = (page - 1) * PAGE_SIZE;

  const [{ data: requests }, { count }] = await Promise.all([
    supabase
      .from("service_requests")
      .select("*")
      .eq("customer_id", user!.id)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE_SIZE - 1),
    supabase
      .from("service_requests")
      .select("*", { count: "exact", head: true })
      .eq("customer_id", user!.id),
  ]);

  const total = count ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasPrevious = page > 1;
  const hasNext = page < pageCount;

  return (
    <div className="space-y-5">
      <div>
        <p className="spark-eyebrow">Repairs</p>
        <h1 className="mt-1.5 font-display text-2xl font-bold tracking-tight text-ink">
          Repair requests
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          {total === 0
            ? "Every request you submit will be listed here."
            : `${total} request${total === 1 ? "" : "s"} · newest first`}
        </p>
      </div>

      <div className="rounded-card border border-line bg-surface px-4 py-4 shadow-[0_1px_2px_rgba(16,38,74,0.04)] sm:px-5">
        <RecentRepairTable requests={requests ?? []} limit={PAGE_SIZE} />
      </div>

      {pageCount > 1 && (
        <nav
          aria-label="Request pages"
          className="flex items-center justify-between gap-3"
        >
          <PageLink
            href={`/customer/repairs/requests?page=${page - 1}`}
            disabled={!hasPrevious}
            direction="previous"
          />
          <p className="text-xs font-semibold text-muted">
            Page {page} of {pageCount}
          </p>
          <PageLink
            href={`/customer/repairs/requests?page=${page + 1}`}
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
