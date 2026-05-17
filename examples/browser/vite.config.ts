import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { almostnodePlugin } from "almostnode/vite";

const here = path.dirname(fileURLToPath(import.meta.url));

// Where the @pyric/* packages live on this machine.
// (They use workspace:* refs, so we resolve directly into their dist dirs
// rather than going through npm install.)
const PYRIC_ROOT = "/Users/davideast/Code/firebase-agent-sdk/packages";

/**
 * Alias `piebox/browser` to the worktree source so changes to piebox are
 * visible without a build step. The example never imports the main `piebox`
 * entry, which would pull `@platformatic/vfs` into the bundle.
 *
 * The @pyric/* packages are aliased to their local dist outputs so we can
 * use them without npm install (their package.json declares workspace:* deps
 * that don't resolve outside the monorepo). Only the browser-safe surfaces
 * are referenced — the main entry of @pyric/agents and the gemini provider
 * subpath of @pyric/llm-relay.
 *
 * `almostnodePlugin()` serves almostnode's Service Worker and prebuilt
 * worker assets.
 */
export default defineConfig({
  plugins: [almostnodePlugin()],
  resolve: {
    alias: {
      "piebox/browser": path.resolve(here, "../../src/browser.ts"),
      "@pyric/agents": path.resolve(PYRIC_ROOT, "agent/dist/index.js"),
      "@pyric/llm-relay/providers/gemini": path.resolve(
        PYRIC_ROOT,
        "llm-relay/dist/providers/gemini.js",
      ),
    },
  },
});
