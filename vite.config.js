import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Dev talks to api.anthropic.com straight from the browser with the local key.
// Production prefers the serverless proxy (netlify/functions/claude.js) so the
// key never has to live in a bundle — see src/agent/transport.js for the
// resolution order. Nothing here needs to know about either.
export default defineConfig({
  plugins: [react()],
  // Relative asset URLs, so one build runs anywhere: a domain root on Netlify,
  // a project subpath on GitHub Pages, or a file:// preview. Everything the
  // app references either comes through the bundler (fonts, JS, CSS) or is
  // written relative in index.html — nothing is hardcoded to "/".
  base: "./",
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
