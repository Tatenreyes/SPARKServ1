"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell, BellRing, Check } from "lucide-react";
import { useRealtimeNotifications } from "@/hooks/useRealtimeNotifications";
import { enablePushNotifications } from "@/lib/enablePush";
import type { NotificationRow } from "@/types/database";

export default function NotificationBell({ userId }: { userId: string }) {
  const [notifications, setNotifications] = useRealtimeNotifications(userId, []);
  const [open, setOpen] = useState(false);
  const [pushStatus, setPushStatus] = useState<"idle" | "granted" | "denied" | "unsupported">(
    "idle"
  );

  useEffect(() => {
    fetch("/api/notifications")
      .then((res) => res.json())
      .then((json) => {
        if (json.data) setNotifications(json.data);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  async function markAllRead() {
    setNotifications((current) => current.map((n) => ({ ...n, read: true })));
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    });
  }

  async function handleNotificationClick(n: NotificationRow) {
    if (!n.read) {
      setNotifications((current) => current.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: n.id }),
      });
    }
    setOpen(false);
  }

  async function handleEnablePush() {
    const result = await enablePushNotifications();
    setPushStatus(result);
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="relative rounded-full p-2 text-ink/60 hover:bg-ink/5"
        aria-label="Notifications"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-alert-500 px-1 text-[10px] font-semibold text-white">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-2 w-[min(20rem,calc(100vw-1rem))] rounded-card border border-ink/8 bg-white shadow-card">
          <div className="flex items-center justify-between border-b border-ink/8 px-4 py-3">
            <p className="text-sm font-semibold text-ink">Notifications</p>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:underline"
              >
                <Check className="h-3 w-3" /> Mark all read
              </button>
            )}
          </div>

          {pushStatus !== "granted" && (
            <button
              onClick={handleEnablePush}
              className="flex w-full items-center gap-2 border-b border-ink/8 px-4 py-2.5 text-left text-xs font-medium text-brand-600 hover:bg-brand-50"
            >
              <BellRing className="h-3.5 w-3.5" />
              {pushStatus === "denied"
                ? "Push notifications blocked — enable them in your browser settings"
                : pushStatus === "unsupported"
                  ? "Push notifications aren't supported in this browser"
                  : "Turn on push notifications"}
            </button>
          )}

          <div className="max-h-80 overflow-y-auto">
            {!notifications.length ? (
              <p className="px-4 py-6 text-center text-sm text-ink/40">No notifications yet.</p>
            ) : (
              notifications.map((n) => (
                <Link
                  key={n.id}
                  href={n.link ?? "#"}
                  onClick={() => handleNotificationClick(n)}
                  className={`block border-b border-ink/5 px-4 py-3 last:border-0 hover:bg-canvas ${
                    !n.read ? "bg-brand-50/40" : ""
                  }`}
                >
                  <p className="text-sm font-medium text-ink">{n.title}</p>
                  {n.body && <p className="mt-0.5 text-xs text-ink/60">{n.body}</p>}
                  <p className="mt-1 text-[11px] text-ink/35">
                    {new Date(n.created_at).toLocaleString()}
                  </p>
                </Link>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
