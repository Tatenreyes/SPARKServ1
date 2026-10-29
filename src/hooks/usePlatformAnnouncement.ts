"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * The platform-wide announcement from `system_settings`, for the topbar strip.
 *
 * Read through `GET /api/settings` rather than passed down from a route layout.
 * The topbar belongs to `DashboardShell`, which all four workspaces share: a prop
 * would mean the same query repeated in four layouts, and a server layout does
 * not re-render on client-side navigation anyway, so it would be exactly as
 * stale as this. One request per full page load, and the strip appears on a
 * route nobody had to remember to wire up.
 *
 * Dismissal is per browser session and keyed by the message *text*, so closing
 * the strip silences the announcement that was read and a new one still arrives.
 * (`sessionStorage`, not `localStorage`: an announcement is a moment in time, not
 * a preference.)
 *
 * A failed request leaves the message empty and the strip absent — a missing
 * announcement must never take the topbar down.
 */
const DISMISSED_KEY = "sparkserv:announcement-dismissed";

export function usePlatformAnnouncement(): {
  /** The announcement as published, or `""` when there is none. */
  message: string;
  /** A message exists and has not been dismissed in this session. */
  visible: boolean;
  dismiss: () => void;
} {
  const [message, setMessage] = useState("");
  const [dismissedMessage, setDismissedMessage] = useState<string | null>(null);

  // Applied in an effect, not during render: reading `sessionStorage` while
  // rendering would make the server and first client render disagree.
  useEffect(() => {
    try {
      setDismissedMessage(window.sessionStorage.getItem(DISMISSED_KEY));
    } catch {
      // Storage can be unavailable (private mode, blocked cookies). The strip
      // simply stays visible, which is the safe default for an announcement.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    fetch("/api/settings")
      .then((res) => (res.ok ? res.json() : null))
      .then((json) => {
        if (cancelled || !Array.isArray(json?.data)) return;
        const row = (json.data as { key?: string; value?: string }[]).find(
          (setting) => setting.key === "platform_announcement"
        );
        // Trimmed here rather than at render: whitespace-only is an empty
        // announcement, and a stray newline must not count as a new message and
        // resurrect a dismissed one.
        setMessage((row?.value ?? "").trim());
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = useCallback(() => {
    if (!message) return;
    try {
      window.sessionStorage.setItem(DISMISSED_KEY, message);
    } catch {
      // Best-effort. The in-memory state below still hides it for this page view.
    }
    setDismissedMessage(message);
  }, [message]);

  return {
    message,
    visible: Boolean(message) && dismissedMessage !== message,
    dismiss,
  };
}
