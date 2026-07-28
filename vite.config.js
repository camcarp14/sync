import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev talks to api.anthropic.com straight from the browser with the local key.
// Production prefers the serverless proxy (netlify/functions/claude.js) so the
// key never has to live in a bundle — see src/agent/transport.js for the
// resolution order. Nothing here needs to know about either.
export default defineConfig({
  plugins: [react()],
  server: { host: true, port: 5173 },
  build: {
    target: "es2020",
    // One vendor chunk keeps the first paint honest: the shell and the design
    // system land in the entry, React lands next to it, and nothing else is
    // heavy enough to be worth splitting.
    rollupOptions: {
      output: {
        manualChunks: { react: ["react", "react-dom"] },
      },
    },
  },
});
