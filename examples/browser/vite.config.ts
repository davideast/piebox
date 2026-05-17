import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { almostnodePlugin } from "almostnode/vite";

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Alias `piebox/browser` to the worktree source so changes to piebox are
 * visible without a build step. The example never imports the main `piebox`
 * entry, which would pull `@platformatic/vfs` into the bundle.
 *
 * `almostnodePlugin()` is required to serve almostnode's Service Worker
 * (`/__sw__.js`) and copy its prebuilt worker assets — without it the
 * runtime cannot construct its Worker.
 */
export default defineConfig({
  plugins: [almostnodePlugin()],
  resolve: {
    alias: {
      "piebox/browser": path.resolve(here, "../../src/browser.ts"),
    },
  },
});
