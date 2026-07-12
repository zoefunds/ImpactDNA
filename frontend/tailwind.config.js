/** "Synthetic Integrity" design system — see docs/DESIGN.md */
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "#0f1117",
        surface: "#111319",
        "surface-low": "#191b22",
        "surface-container": "#1e1f26",
        "surface-high": "#282a30",
        "surface-highest": "#33343b",
        "surface-lowest": "#0c0e14",
        "on-surface": "#e2e2eb",
        "on-variant": "#cec2d7",
        outline: "#978da0",
        "outline-variant": "#4c4355",
        primary: "#d8b9ff",
        "on-primary": "#450086",
        "primary-container": "#ae72ff",
        cyan: { DEFAULT: "#00eefc", dim: "#00dbe9", fixed: "#7df4ff" },
        green: { DEFAULT: "#00e475", fixed: "#62ff96" },
        danger: "#ffb4ab",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "Inter", "sans-serif"],
        mono: ["var(--font-jetbrains)", "JetBrains Mono", "monospace"],
      },
      maxWidth: { container: "1280px" },
      letterSpacing: { caps: "0.1em" },
    },
  },
  plugins: [],
};
