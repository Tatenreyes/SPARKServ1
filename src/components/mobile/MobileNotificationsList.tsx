"use client";

import { useState } from "react";
import Link from "next/link";
import { BellOff, Check, ChevronRight } from "lucide-react";
import type { NotificationRow } from "@/types/database";

/**
 * The customer's notification list, as action-oriented cards.
 *
 * Two things this deliberately does that the topbar's dropdown does not:
 *
 *   * **It stays a list of next steps.** Each card keeps its title as the
 *     headline ("Estimate ready") and its body as the evidence ("Your technician
 *     submitted a ₱1,850 estimate"), with the notification's own `link` as a
 *     full-width action. A notification that only says "your status changed"
 *     still renders, it just doesn't pretend to be useful.
 *   * **Unread is never colour-only.** An unread card carries a dot *and* a bold
 *     "New" chip, so it survives a greyscale screen and a colour-blind reader.
 *
 * Marking read hits the same `/api/notifications` PATCH the bell uses — the
 * badge on the bottom navigation is refreshed on the next page transition, so
 * both stay consistent without a second realtime subscription.
 */
export default function MobileNotificationsList({
  initialNotifications,
}: {
  initialNotifications: NotificationRow[];
}) {
  const [notifications, setNotifications] = useState(initialNotifications);
  const unread = notifications.filter((n) => !n.read).length;

  function markRead(id: string) {
    const target = notifications.find((n) => n.id === id);
    if (!target || target.read) return;
    setNotifications((current) =>
      current.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
    fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    }).catch(() => {});
  }

  async function markAllRead() {
    setNotifications((current) => current.map((n) => ({ ...n, read: true })));
    await fetch("/api/notifications", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    }).catch(() => {});
  }

  if (!notifications.length) {
    return (
      <div className="flex flex-col items-center rounded-card border border-dashed border-line px-5 py-12 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-soft text-muted/80">
          <BellOff className="h-5 w-5" aria-hidden="true" />
        </span>
        <p className="mt-3 text-sm font-semibold text-ink">You&apos;re all caught up</p>
        <p className="mt-1 max-w-xs text-xs leading-relaxed text-muted">
          Estimate approvals, schedule confirmations and payment requests will
          appear here the moment they need you.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {unread > 0 && (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-semibold text-muted">
            {unread} unread of {notifications.length}
          </p>
          <button
            type="button"
            onClick={markAllRead}
            className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-semibold text-brand-ink transition duration-200 hover:bg-brand-soft"
          >
            <Check className="h-3.5 w-3.5" aria-hidden="true" />
            Mark all read
          </button>
        </div>
      )}

      <ul className="space-y-3">
        {notifications.map((n) => (
          <li
            key={n.id}
            className={`rounded-card border p-4 shadow-[0_1px_2px_rgba(16,38,74,0.04)] ${
              n.read ? "border-line bg-surface" : "border-brand-300 bg-brand-soft/50"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <p className="text-sm font-semibold text-ink">{n.title}</p>
              {!n.read && (
                <span className="shrink-0 rounded-full bg-brand-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] text-white">
                  New
                </span>
              )}
            </div>

            {n.body && (
              <p className="mt-1 text-xs leading-relaxed text-muted">{n.body}</p>
            )}
            <p className="mt-2 text-[11px] text-muted/80">
              {new Date(n.created_at).toLocaleString("en-US", {
                month: "long",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}
            </p>

            {n.link && (
              <Link
                href={n.link}
                onClick={() => markRead(n.id)}
                className="mt-3 flex h-11 w-full cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-brand-500 px-4 text-sm font-semibold text-white transition duration-200 hover:bg-brand-600"
              >
                {actionLabel(n.title)}
                <ChevronRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Turn a notification headline into a verb.
 *
 * Notifications are written by the API with headlines like "Estimate Ready" or
 * "Payment Required", so a small mapping gives the button the right words
 * instead of a generic "Open". Anything unmapped falls back to "Open" rather
 * than guessing.
 */
function actionLabel(title: string): string {
  const lower = title.toLowerCase();
  if (lower.includes("estimate")) return "Review estimate";
  if (lower.includes("payment")) return "Review payment";
  if (lower.includes("schedule") || lower.includes("booking")) return "Confirm schedule";
  if (lower.includes("inspection")) return "Inspect appliance";
  if (lower.includes("assigned")) return "View technician";
  if (lower.includes("completed")) return "View service report";
  return "Open";
}
