import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: ["class"],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ["var(--font-orbitron)", "sans-serif"],
        body: ["var(--font-rajdhani)", "sans-serif"]
      },
      colors: {
        vx: {
          bg: "#05070a",
          panel: "#0d1117",
          panelAlt: "#0f172a"
        }
      },
      boxShadow: {
        vx: "0 30px 120px rgba(0, 0, 0, 0.65)"
      },
      keyframes: {
        "pulse-soft": {
          "0%, 100%": { opacity: "0.5" },
          "50%": { opacity: "1" }
        }
      },
      animation: {
        "pulse-soft": "pulse-soft 2.2s ease-in-out infinite"
      }
    }
  },
  plugins: []
};

export default config;
