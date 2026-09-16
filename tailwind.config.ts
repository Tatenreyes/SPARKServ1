import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#10264A",
        canvas: "#F5F7FB",
        mist: "#EEF5FF",
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
