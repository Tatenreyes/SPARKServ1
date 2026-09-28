import type { Metadata } from "next";
export const dynamic = "force-dynamic";
import { Space_Grotesk, Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google"; 
import Navbar from "@/components/Navbar";
import { STORAGE_KEY } from "@/lib/theme";
import { ThemeProvider } from "@/components/ThemeProvider";
import "./globals.css";

const display = Space_Grotesk({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
});

const body = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-body",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "SPARKServ — Appliance Repair Management System",
  description: "Connecting customers with trusted appliance repair technicians.",
  icons: {
    icon: "/images/Logo.PNG",
    apple: "/images/Logo.PNG",
  },
};

/**
 * Theme pre-paint script. A plain inline `<script>` as the first body child runs
 * before React hydrates and before the first paint: the stored choice wins,
 * otherwise the OS preference. Without it a dark-mode visitor gets a white
 * flash, and `suppressHydrationWarning` on `<html>` would only hide the React
 * warning, not fix the flash. It writes the same `dark` class, `color-scheme`
 * and storage key `ThemeProvider` reads — `STORAGE_KEY` comes from
 * `src/lib/theme.ts`, a plain module, because importing the value out of the
 * client `ThemeProvider` here would interpolate a client reference object and
 * render `var key = "[object Object]"`. It lives in the body rather than a
 * `<head>` element so the App Router leaves it exactly here instead of hoisting
 * and re-parenting it.
 */
const THEME_PRE_PAINT = `
(function () {
  try {
    var key = "${STORAGE_KEY}";
    var stored = null;
    try { stored = localStorage.getItem(key); } catch (e) {}
    var prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    var dark = stored === "dark" || (!stored && prefersDark);
    var el = document.documentElement;
    el.classList.toggle("dark", dark);
    el.style.colorScheme = dark ? "dark" : "light";
  } catch (e) {}
})();
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`} suppressHydrationWarning>
      <body className="bg-canvas font-sans text-ink antialiased">
        <script dangerouslySetInnerHTML={{ __html: THEME_PRE_PAINT }} />
        <ThemeProvider>
          <Navbar />
          <main>{children}</main>
        </ThemeProvider>
      </body>
    </html>
  );
}
