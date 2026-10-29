"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Unread notification count, for the mobile bottom-navigation badge.
 *
 * Deliberately a plain `fetch` on mount and on every navigation, and NOT a
 * second `useRealtimeNotifications` subscription. `NotificationBell` already
 * subscribes to the channel `notifications:user:<id>` on every dashboard; a
 * second subscriber to that identical topic is a duplicate realtime connection
 * purchased for a decorative number. Re-reading it whenever the route changes is
 * enough: the badge is a hint that something is waiting, and the bell in the
 * topbar stays the live, authoritative count.
 *
 * A failed request leaves the count at zero rather than throwing, because a
 * missing badge must never take a navigation bar down.
 */
export function useUnreadNotificationCount(): number {
  const pathname = usePathname();
  const [count, setCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/notifications")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled || !Array.isArray(json?.data)) return;
        setCount(
          (json.data as { read?: boolean }[]).filter((row) => !row.read).length
        );
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [pathname]);

  return count;
}
