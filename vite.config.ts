import { defineConfig } from "vite";

// base: './' makes the built site fully relocatable (works on GitHub Pages under
// any /<user>/<repo>/ prefix and from any local static server or file://).
export default defineConfig({
  base: "./",
  build: {
    // Keep the classic hashed chunk names; no splitting needed for this size.
    target: "es2020",
    assetsInlineLimit: 0,
  },
  server: {
    port: 5173,
  },
});
