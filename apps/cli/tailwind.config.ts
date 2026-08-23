import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./src/**/*.{ts,tsx}",
    // The renderer components live in the workspace package — Tailwind must scan
    // their source to generate the utility classes they reference.
    "../../packages/renderer/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Driven by docs.json colors, injected as CSS variables (SPEC §5 theming).
        primary: {
          DEFAULT: "var(--color-primary)",
          light: "var(--color-primary-light)",
          dark: "var(--color-primary-dark)",
        },
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
