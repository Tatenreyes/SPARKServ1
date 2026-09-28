/**
 * Theme constants shared by the server render and the client provider.
 *
 * This deliberately lives in its own module with no `"use client"` directive.
 * `src/app/layout.tsx` (a Server Component) interpolates `STORAGE_KEY` into the
 * pre-paint script, and when a Server Component imports a *value* out of a
 * client module it receives the client-reference wrapper instead of the value —
 * the interpolation then renders `var key = "[object Object]"` and the stored
 * choice is read back from a junk key, silently disabling persisted dark mode.
 */
export type Theme = "light" | "dark";

/** localStorage key for the explicit user choice. */
export const STORAGE_KEY = "sparkserv-theme";
