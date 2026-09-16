import type { Metadata } from "next";
export const dynamic = "force-dynamic";
import { Space_Grotesk, Plus_Jakarta_Sans, JetBrains_Mono } from "next/font/google"; 
import Navbar from "@/components/Navbar";
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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body className="bg-canvas font-sans text-ink antialiased">
        <Navbar />
        <main>{children}</main>
      </body>
    </html>
  );
}
