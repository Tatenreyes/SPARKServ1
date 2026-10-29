"use client";

import { useEffect, useRef, useState } from "react";
import { Bell, X } from "lucide-react";

/**
 * How fast the announcement travels, in pixels per second. Fast enough to cross
 * a 1800px strip without dragging, slow enough that a date or a phone number can
 * be read as it passes.
 */
const TICKER_PIXELS_PER_SECOND = 70;

/** Fallback duration before the first measurement lands (one cycle, seconds). */
const TICKER_FALLBACK_SECONDS = 24;

/**
 * The platform-wide announcement, as a scrolling strip inside the dashboard
 * topbar.
 *
 * A strip in the shell rather than a banner in a page: the announcement is
 * platform-wide, so it belongs to the chrome all four workspaces share. A
 * customer reading their bookings and an admin working the payments queue both
 * need to see it, and neither should have to scroll back to the top of a page to
 * find it.
 *
 * The message travels right-to-left and loops. Two identical groups sit in one
 * clipping row and both translate by exactly `-100%`, so group two lands where
 * group one began and the wrap point is invisible — see `.spark-ticker` in
 * `globals.css` for why each group is at least a strip wide.
 *
 * The duration is measured, not guessed: one cycle travels a group's width,
 * which is mostly the strip's own width, and the message alone cannot tell us
 * what that is. Measuring keeps a phone and an ultra-wide monitor scrolling at
 * the same readable speed instead of one crawling and the other sprinting.
 *
 * The marquee is `aria-hidden` and the sentence is carried once by an `sr-only`
 * paragraph: a screen reader should hear the announcement once, not twice, and
 * not as a moving target.
 *
 * Motion is controllable, which is what WCAG 2.2.2 asks of anything that moves on
 * its own: the dismiss button stops it for the session, hovering pauses it, and
 * the global `prefers-reduced-motion` rule in `globals.css` halts it outright —
 * the strip then reads as a plain line of text.
 */
export default function PlatformAnnouncementTicker({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  const groupRef = useRef<HTMLDivElement>(null);
  const [durationSeconds, setDurationSeconds] = useState(TICKER_FALLBACK_SECONDS);

  // Re-measured on resize (and on rotation, which ResizeObserver reports as one),
  // so the speed survives the window changing shape under a running animation.
  useEffect(() => {
    function measure() {
      const group = groupRef.current;
      if (!group) return;
      const width = group.getBoundingClientRect().width;
      if (width <= 0) return;
      setDurationSeconds(
        Math.min(60, Math.max(12, Math.round(width / TICKER_PIXELS_PER_SECOND)))
      );
    }

    measure();

    const group = groupRef.current;
    if (!group || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(measure);
    observer.observe(group);
    return () => observer.disconnect();
  }, [message]);

  const animationStyle = { animationDuration: `${durationSeconds}s` };

  return (
    <div className="border-t border-white/10">
      <div className="mx-auto flex h-8 w-full max-w-[1800px] items-center gap-3 px-4 sm:px-6 lg:px-8">
        <p className="sr-only">Platform announcement: {message}</p>

        <span className="hidden shrink-0 items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-ink sm:inline-flex">
          <Bell className="h-3.5 w-3.5" aria-hidden="true" />
          Platform announcement
        </span>

        <div className="spark-ticker min-w-0 flex-1" aria-hidden="true">
          {/* Copy one carries the ref: both copies are identical, and a cycle
              travels exactly one copy's width. */}
          <div ref={groupRef} className="spark-ticker-group" style={animationStyle}>
            <span className="spark-ticker-item text-xs text-white/85">{message}</span>
          </div>
          <div className="spark-ticker-group" style={animationStyle}>
            <span className="spark-ticker-item text-xs text-white/85">{message}</span>
          </div>
        </div>

        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss platform announcement"
          title="Dismiss"
          className="inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-lg text-white/55 transition hover:bg-white/10 hover:text-white"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

