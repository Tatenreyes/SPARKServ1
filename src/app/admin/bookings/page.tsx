import { redirect } from "next/navigation";

/**
 * Booking review was a read-only list of every booking — and so was
 * `/admin/job-monitoring`: the same query (`bookings`, newest first, limit 50)
 * with a subset of the same columns. Two sidebar entries and two pages for one
 * list meant an administrator could not tell which was authoritative, and the
 * mobile navigation already treated them as a single "Repairs" tab.
 *
 * The list now lives on `/admin/job-monitoring`, which carries every column this
 * page had (Final cost included). This route is kept as a redirect so a
 * bookmarked URL, an older notification link or a stale browser tab still lands
 * somewhere useful instead of on a 404.
 */
export default function AdminBookingReviewPage() {
  redirect("/admin/job-monitoring");
}
