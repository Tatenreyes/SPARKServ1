"use client";

import { MotionConfig } from "motion/react";

/**
 * One place that decides how every `motion` animation in the workspace behaves.
 *
 * `reducedMotion="user"` is the whole reason this exists. The global
 * `prefers-reduced-motion` rule in `globals.css` only shortens CSS transitions
 * and keyframes — it has no effect on Motion, which drives values from
 * JavaScript and writes them to the element's own style. Without this config a
 * motion-sensitive user gets a still page everywhere except the one part built
 * with Motion, which is exactly the part most likely to make them ill.
 *
 * `"user"` (rather than `"always"`/`"never"`) means Motion reads the OS setting
 * for us: when it is on, transform and layout animations are dropped while
 * opacity/colour still animate, so a state change still reads as a change
 * instead of the interface snapping. When it is off, nothing is affected.
 *
 * Mounted inside `DashboardShell` rather than the root layout on purpose: the
 * marketing pages already import Motion themselves, and putting the provider in
 * the root would add the Motion runtime to every route that does not animate —
 * a real cost in First Load JS for no behaviour at all.
 */
export default function MotionProvider({ children }: { children: React.ReactNode }) {
  return <MotionConfig reducedMotion="user">{children}</MotionConfig>;
}
