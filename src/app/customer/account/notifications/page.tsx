import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth";
import MobileNotificationsList from "@/components/mobile/MobileNotificationsList";

/**
 * The customer's full notification history.
 *
 * The bell in the topbar shows the latest few in a dropdown; this is where the
 * rest live. Capped at 50 (newest first) rather than unbounded — a phone should
 * never be asked to lay out a year of notifications in one pass.
 */
export default async function CustomerNotificationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = createClient();
  const { data: notifications } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <div className="space-y-5">
      <div>
        <p className="spark-eyebrow">Account</p>
        <h1 className="mt-1.5 font-display text-2xl font-bold tracking-tight text-ink">
          Notifications
        </h1>
        <p className="mt-1.5 text-sm leading-relaxed text-muted">
          Anything that needs a decision is also listed in your Action centre on the
          dashboard — notifications are the record, not the only way to find out.
        </p>
      </div>

      <MobileNotificationsList initialNotifications={notifications ?? []} />
    </div>
  );
}
