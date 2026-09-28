import Link from "next/link";
import {
  Bell,
  CheckCircle2,
  CircleDollarSign,
  FileText,
  MessageSquareText,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { NotificationRow } from "@/types/database";

const NOTIFICATION_META: Record<string, { icon: LucideIcon; tone: string }> = {
  technician_assigned: { icon: Wrench, tone: "bg-brand-soft text-brand-ink" },
  estimate_ready: { icon: FileText, tone: "bg-warn-soft text-warn-ink" },
  booking_confirmed: { icon: CheckCircle2, tone: "bg-signal-soft text-signal-ink" },
  payment_requested: { icon: CircleDollarSign, tone: "bg-accent-soft text-accent-ink" },
  support_reply: { icon: MessageSquareText, tone: "bg-brand-soft text-brand-ink" },
  // Emitted by `expireStaleOffers` in src/lib/assignment.ts.
  offer_expired: { icon: Bell, tone: "bg-alert-soft text-alert-ink" },
};

export function NotificationsPanel({ notifications }: { notifications: NotificationRow[] }) {
  if (!notifications?.length) {
    return (
      <div className="flex flex-col items-center justify-center px-5 py-10 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-soft text-muted/80">
          <Bell className="h-5 w-5" />
        </span>
        <p className="mt-3 text-sm font-medium text-ink">You&apos;re all caught up</p>
        <p className="mt-1 text-xs text-muted">
          Updates about your requests and bookings will appear here.
        </p>
      </div>
    );
  }

  return (
    <ul className="divide-y divide-line">
      {notifications.slice(0, 5).map((notification) => {
        const meta = NOTIFICATION_META[notification.type] ?? {
          icon: Bell,
          tone: "bg-soft text-muted",
        };
        const Icon = meta.icon;
        const unread = !notification.read;

        const content = (
          <div
            className={`flex gap-3 px-5 py-3.5 transition duration-200 ${
              unread ? "bg-brand-soft/40" : "hover:bg-soft"
            }`}
          >
            <span
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${meta.tone}`}
            >
              <Icon className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-start gap-2">
                <p
                  className={`min-w-0 flex-1 truncate text-sm ${
                    unread ? "font-semibold text-ink" : "font-medium text-ink/80"
                  }`}
                >
                  {notification.title}
                </p>
                {unread && (
                  <span
                    className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500"
                    aria-label="Unread"
                  />
                )}
              </div>
              {notification.body && (
                <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-muted">
                  {notification.body}
                </p>
              )}
              <p className="mt-1 text-[11px] text-muted/80">
                {formatTimeAgo(notification.created_at)}
              </p>
            </div>
          </div>
        );

        return notification.link ? (
          <li key={notification.id}>
            <Link href={notification.link} className="block cursor-pointer">
              {content}
            </Link>
          </li>
        ) : (
          <li key={notification.id}>{content}</li>
        );
      })}
    </ul>
  );
}

/**
 * Relative timestamps for notification surfaces.
 *
 * The previous version returned `${mins}h ago` for anything under an hour, so a
 * notification from four minutes ago read "4h ago" — which is worse than no
 * timestamp at all on a screen people use to judge how stale something is.
 */
export function formatTimeAgo(iso: string): string {
  const timestamp = new Date(iso).getTime();
  if (Number.isNaN(timestamp)) return "";

  const mins = Math.floor((Date.now() - timestamp) / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;

  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;

  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;

  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
