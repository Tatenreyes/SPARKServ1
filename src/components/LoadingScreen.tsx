"use client";

import { motion, useReducedMotion } from "motion/react";
import { Refrigerator, WashingMachine, Wind } from "lucide-react";

interface LoadingScreenProps {
  message?: string;
}

/**
 * The full-screen "something is happening" overlay — sign-in, sign-out, account
 * creation.
 *
 * Three concentric layers: a static ring, a sweeping arc on top of it, and the
 * brand badge in the middle carrying the three appliance marks. The sizes below
 * are a set, not independent choices, because the badge has to hold the icon row
 * without any of it escaping:
 *
 *   icon row = 3 × 28px + 2 × 4px gap = 92px → badge is w-28 (112px), 10px of
 *   slack each side
 *   badge    = 112 × 80px                    → ring is h-32 w-32 (128px), 8px of
 *   clearance each side
 *
 * It used to be 36 + 36 + 32 + 12px of gaps = 116px of icons inside an 80px
 * badge and a 112px ring — so the appliances hung over the edge of the badge and
 * past the spinner, which read as a rendering bug rather than a logo. If these
 * icons change again, keep the row narrower than the badge.
 *
 * Every loop is decorative, so with reduced motion on it is dropped (not
 * slowed): the badge sits still instead of wobbling while the person waits.
 *
 * The live region wraps the message as well as the dots. It used to sit on the
 * dots alone, so "Signing you out..." — the only part that carries information —
 * was never announced, and an empty progress bar was all a screen reader got.
 */
export default function LoadingScreen({ message = "Please wait..." }: LoadingScreenProps) {
  const reduceMotion = useReducedMotion();

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-brand-900/95 px-6 text-white backdrop-blur-sm">
      <div className="flex flex-col items-center text-center">
        <div className="relative flex h-32 w-32 items-center justify-center">
          {/* Static track the arc sweeps over. */}
          <div aria-hidden="true" className="absolute inset-0 rounded-full border-2 border-brand-300/25" />

          {/* Only two of the four borders are painted, so the circle reads as a
              180° comet rather than a full outline. */}
          <motion.div
            aria-hidden="true"
            className="absolute inset-0 rounded-full border-2 border-transparent border-t-spark-300 border-r-spark-300"
            animate={reduceMotion ? undefined : { rotate: 360 }}
            transition={
              reduceMotion
                ? undefined
                : { duration: 1.2, repeat: Infinity, ease: "linear" }
            }
          />

          {/* The badge: one step wider than tall, sized to the icon row. */}
          <motion.div
            className="relative flex h-20 w-28 items-center justify-center rounded-2xl bg-spark-400 text-navy-900 shadow-lg"
            animate={reduceMotion ? undefined : { scale: [1, 1.04, 1] }}
            transition={
              reduceMotion
                ? undefined
                : { duration: 1.1, repeat: Infinity, ease: "easeInOut" }
            }
          >
            <motion.div
              className="flex items-center gap-1"
              animate={reduceMotion ? undefined : { x: [-2, 2, -2] }}
              transition={
                reduceMotion
                  ? undefined
                  : { duration: 1.4, repeat: Infinity, ease: "easeInOut" }
              }
            >
              <motion.span
                className="block"
                animate={reduceMotion ? undefined : { y: [0, -3, 0], rotate: [-4, 4, -4] }}
                transition={
                  reduceMotion
                    ? undefined
                    : { duration: 1.1, repeat: Infinity, ease: "easeInOut" }
                }
              >
                <Refrigerator className="h-7 w-7" strokeWidth={2.5} aria-hidden="true" />
              </motion.span>

              <motion.span
                className="block"
                animate={reduceMotion ? undefined : { y: [-2, 2, -2], rotate: [3, -3, 3] }}
                transition={
                  reduceMotion
                    ? undefined
                    : { duration: 1.25, repeat: Infinity, ease: "easeInOut" }
                }
              >
                <WashingMachine className="h-7 w-7" strokeWidth={2.5} aria-hidden="true" />
              </motion.span>

              <motion.span
                className="block"
                animate={reduceMotion ? undefined : { y: [0, -3, 0] }}
                transition={
                  reduceMotion
                    ? undefined
                    : { duration: 1, repeat: Infinity, ease: "easeInOut" }
                }
              >
                <Wind className="h-7 w-7" strokeWidth={2.5} aria-hidden="true" />
              </motion.span>
            </motion.div>
          </motion.div>
        </div>

        {/* One live region covering both the dots and the message, so the text is
            announced once rather than the dots announcing nothing. */}
        <div role="status" aria-live="polite" aria-busy="true" className="mt-6">
          <div aria-hidden="true" className="flex items-center justify-center gap-1.5">
            <span className="h-1.5 w-8 overflow-hidden rounded-full bg-white/20">
              <span className="block h-full w-1/2 animate-pulse rounded-full bg-spark-300" />
            </span>
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-spark-300 [animation-delay:150ms]" />
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-spark-300 [animation-delay:300ms]" />
          </div>
          <p className="mt-4 text-sm font-medium text-white/80">{message}</p>
        </div>
      </div>
    </div>
  );
}
