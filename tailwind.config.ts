import type { Config } from "tailwindcss";

/**
 * `darkMode: "class"` — the theme is an explicit class on <html>, not the
 * `prefers-color-scheme` media query. Two reasons:
 *
 *   1. A user who prefers dark in their OS should still be able to pick light
 *      for this app (and toggling is the whole point of the feature).
 *   2. The class is set by an inline script before first paint, so there is no
 *      flash of the wrong theme. A media query cannot be overridden per-user.
 */
const config: Config = {
  darkMode: "class",
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        /**
         * Theme-aware roles. Each is an RGB triplet in `globals.css` (light in
         * `:root`, dark in `.dark`) wrapped with <alpha-value> so Tailwind's
         * opacity modifiers keep working — `border-ink/8` and `text-ink/65` are
         * used in hundreds of places and must not need rewriting to go dark.
         *
         * These used to be hardcoded hex, which is exactly why the UI could not
         * be themed before: every one of those ~560 call sites was pinned to
         * `#10264A`.
         */
        ink: "rgb(var(--spark-ink) / <alpha-value>)",
        canvas: "rgb(var(--spark-canvas) / <alpha-value>)",
        /** Card / sheet / popover surface. Replaces hardcoded `bg-white`. */
        surface: "rgb(var(--spark-surface) / <alpha-value>)",
        /** Secondary text. Replaces hardcoded `text-slate-500/600`. */
        muted: "rgb(var(--spark-muted) / <alpha-value>)",
        /** Structural hairline. Replaces hardcoded `border-slate-200/100`. */
        line: "rgb(var(--spark-line) / <alpha-value>)",
        /** Subtle neutral fill: hover states, progress tracks, skeletons. */
        soft: "rgb(var(--spark-soft) / <alpha-value>)",

        /**
         * Colour used AS TEXT. `brand-600` doubles as a button fill (where it
         * must stay a dark blue under white text) and as body text (where it
         * must lighten on a dark canvas). Those are two different roles sharing
         * one value, so text uses its own token.
         */
        "brand-ink": "rgb(var(--spark-brand-ink) / <alpha-value>)",
        "signal-ink": "rgb(var(--spark-signal-ink) / <alpha-value>)",
        "alert-ink": "rgb(var(--spark-alert-ink) / <alpha-value>)",
        "accent-ink": "rgb(var(--spark-accent-ink) / <alpha-value>)",
        "warn-ink": "rgb(var(--spark-warn-ink) / <alpha-value>)",

        /**
         * Tonal BACKGROUNDS. The `-50` shades are near-white tints; dropped
         * straight onto a dark canvas they read as glaring light patches, so
         * each gets a dark, desaturated counterpart.
         */
        "brand-soft": "rgb(var(--spark-brand-soft) / <alpha-value>)",
        "signal-soft": "rgb(var(--spark-signal-soft) / <alpha-value>)",
        "alert-soft": "rgb(var(--spark-alert-soft) / <alpha-value>)",
        "accent-soft": "rgb(var(--spark-accent-soft) / <alpha-value>)",
        "warn-soft": "rgb(var(--spark-warn-soft) / <alpha-value>)",

        mist: "rgb(var(--spark-soft) / <alpha-value>)",
        navy: {
          900: "#0E172A",
          800: "#152238",
          700: "#1E2F4B",
        },
        brand: {
          50: "#EEF5FF",
          100: "#DCEBFF",
          200: "#BBD6FF",
          300: "#78A9FF",
          400: "#397BEE",
          500: "#1255C7",
          600: "#0E429F",
          700: "#0B347E",
          800: "#082A67",
          900: "#061D48",
        },
        spark: {
          50: "#EEF5FF",
          100: "#DCEBFF",
          300: "#78A9FF",
          400: "#397BEE",
          500: "#1255C7",
          600: "#0E429F",
        },
        signal: { 50: "#EAFBF3", 500: "#1FAE69", 600: "#138A4D" },
        alert: { 50: "#FFF1F2", 500: "#E24A4A", 600: "#B93939" },
        // Urgent-action accent. Reserved for the single most important CTA on a
        // screen (start a request, confirm completion, pay) so it keeps its
        // meaning — never use it for decoration or secondary buttons.
        accent: {
          50: "#FFF4ED",
          100: "#FFE6D5",
          200: "#FED7AA",
          500: "#EA580C",
          600: "#C2410C",
          700: "#9A3412",
        },
      },
      fontFamily: {
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        sans: ["var(--font-body)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        card: "0.85rem",
      },
      boxShadow: {
        card: "0 16px 34px rgba(16, 38, 74, 0.09)",
        soft: "0 10px 24px rgba(18, 85, 199, 0.18)",
      },
    },
  },
  plugins: [],
};
export default config;
