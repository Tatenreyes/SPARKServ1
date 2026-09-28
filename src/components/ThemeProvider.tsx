"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { STORAGE_KEY, type Theme } from "@/lib/theme";

export type { Theme } from "@/lib/theme";

type ThemeContextValue = {
  /** The user's explicit choice, or `null` before mount / before any choice. */
  theme: Theme | null;
  /** What is actually painted right now. Safe to render with on the server. */
  resolved: Theme;
  toggle: () => void;
  setTheme: (theme: Theme) => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  theme: null,
  resolved: "light",
  toggle: () => {},
  setTheme: () => {},
});

/**
 * Read the theme the pre-paint script wrote onto `<html>`. Client only: touching
 * `document` during render throws `ReferenceError: document is not defined` in
 * the server render pass, which is why this is only ever called from an effect
 * or an event handler.
 */
function readLiveTheme(): Theme {
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

function readStoredTheme(): Theme | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    // Private mode / blocked storage: fall back to the class already applied.
    return null;
  }
}

function applyTheme(next: Theme) {
  document.documentElement.classList.toggle("dark", next === "dark");
  document.documentElement.style.colorScheme = next;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Starts `null` on purpose. Every server render and the first client render
  // must agree, so nothing browser-only is read while rendering.
  const [theme, setThemeState] = useState<Theme | null>(null);

  useEffect(() => {
    // Stored choice wins; with no stored choice the pre-paint script already
    // picked from the OS preference, so adopt whatever is on the document.
    setThemeState(readStoredTheme() ?? readLiveTheme());
  }, []);

  const resolved: Theme = theme ?? "light";

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    applyTheme(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Storage can be unavailable; the live class is already correct.
    }
  }, []);

  const toggle = useCallback(() => {
    const current = theme ?? readLiveTheme();
    setTheme(current === "dark" ? "light" : "dark");
  }, [theme, setTheme]);

  const value = useMemo(
    () => ({ theme, resolved, toggle, setTheme }),
    [theme, resolved, toggle, setTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
