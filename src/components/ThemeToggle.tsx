"use client";

import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/components/ThemeProvider";

export default function ThemeToggle({ className = "" }: { className?: string }) {
  const { resolved, toggle } = useTheme();

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={resolved === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      aria-pressed={resolved === "dark"}
      title={resolved === "dark" ? "Light mode" : "Dark mode"}
      className={`inline-flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border border-line text-muted transition-colors duration-200 hover:border-brand-300 hover:bg-soft hover:text-brand-ink ${className}`}
    >
      {/* Server HTML always says "light" (the provider cannot know the theme
          while rendering). The pre-paint script has already repainted the page,
          so this icon may flip one frame after hydration — cheaper than an
          SSR-visible wrong icon or a hydration mismatch. */}
      {resolved === "dark" ? <Sun key="sun" className="h-4 w-4" /> : <Moon key="moon" className="h-4 w-4" />}
    </button>
  );
}
