import { defineConfig } from "vite";

// base: './' makes the built site fully relocatable (works on GitHub Pages under
// any /<user>/<repo>/ prefix and from any local static server or file://).
export default defineConfig({
  base: "./",
  build: {
    target: "es2020",
    assetsInlineLimit: 0,
    // Stable, unhashed entry filename. GitHub Pages serves index.html with a
    // fixed Cache-Control: max-age=600 and allows no custom headers, so after
    // a deploy a visitor's cached index.html keeps pointing at the OLD
    // content-hashed bundle until the 10-minute TTL lapses — which now 404s
    // (the old hash is gone from the fresh dist), leaving a blank screen until
    // a hard refresh. With a stable name, the stale index.html loads the
    // previous fully-consistent build instead of failing. All game assets
    // already ship from public/assets/ with stable names, so the entry is the
    // only hashed file that matters.
    rollupOptions: {
      output: {
        entryFileNames: "assets/index.js",
      },
    },
  },
  server: {
    port: 5173,
  },
});
