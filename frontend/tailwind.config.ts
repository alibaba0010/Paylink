import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "#0A0F1E",
        primary: "#00C896",
        secondary: "#0D1B35",
        muted: "#8896B3",
        accent: "#FFD166"
      },
    },
  },
  plugins: [],
};
export default config;
