import type { Variants } from "motion/react";

/** Whole-page fade in + slight upward motion on load */
export const pageVariants: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" } },
};

/** Stagger wrapper for a group of children (hero text, card grids, etc.) */
export const staggerContainer = (stagger = 0.12, delayChildren = 0): Variants => ({
  hidden: {},
  show: {
    transition: { staggerChildren: stagger, delayChildren },
  },
});

/** Fade in + slide up — used for hero lines and section headings */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" } },
};

/** Fade in + slide up — used for service/feature cards, slightly faster */
export const cardFadeUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" } },
};

/** Slide in from the left — odd-numbered "how it works" steps */
export const slideInLeft: Variants = {
  hidden: { opacity: 0, x: -40 },
  show: { opacity: 1, x: 0, transition: { duration: 0.6, ease: "easeOut" } },
};

/** Slide in from the right — even-numbered "how it works" steps */
export const slideInRight: Variants = {
  hidden: { opacity: 0, x: 40 },
  show: { opacity: 1, x: 0, transition: { duration: 0.6, ease: "easeOut" } },
};

/** Pop in with a gentle scale — used for the "why choose us" style cards */
export const popScale: Variants = {
  hidden: { opacity: 0, scale: 0.85 },
  show: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }, // slight overshoot, not a full bounce
  },
};

/** Standard "animate once when scrolled into view" viewport config */
export const viewportOnce = { once: true, amount: 0.3 } as const;
