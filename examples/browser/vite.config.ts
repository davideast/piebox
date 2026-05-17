import { defineConfig } from "vite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { almostnodePlugin } from "almostnode/vite";

const here = path.dirname(fileURLToPath(import.meta.url));

// @inbrowser/agent and @inbrowser/relay are now real npm packages
// (published 0.1.0 — see package.json deps). The previous alias-into-
// firebase-agent-sdk wiring is gone; resolution flows through node_modules
// like any other dependency.
//
// @pyric/ui is still vendored locally at vendor/pyric-ui/ because that
// surface hasn't been published yet. Two subpaths are exposed via alias
// so consumers' import sites read normally (`from '@pyric/ui/agents'`)
// rather than reaching into the vendor directory directly.

// Local almostnode fork with all the TLA / esbuild / process / ESM-CJS-interop
// fixes (piebox#4 and friends). Aliasing the runtime entry so the SW served
// at /__sw__.js comes from the fork's dist (which the fork's
// `npm run build:lib` writes). `almostnode/vite` (the plugin import above)
// still resolves to node_modules/almostnode because the plugin runs in the
// host Node context and doesn't need the fork's runtime tweaks.
const ALMOSTNODE_FORK = "/Users/davideast/Code/almostnode/dist";

export default defineConfig({
  plugins: [react(), almostnodePlugin()],
  resolve: {
    alias: {
      "piebox/browser": path.resolve(here, "../../src/browser.ts"),
      "@pyric/ui/agents": path.resolve(here, "vendor/pyric-ui/agents/index.ts"),
      "@pyric/ui/primitives": path.resolve(here, "vendor/pyric-ui/primitives/index.ts"),
      // Fork override — runtime entry only. Must come last so it wins over
      // the bare-name resolution to node_modules/almostnode.
      "almostnode": path.resolve(ALMOSTNODE_FORK, "index.mjs"),
    },
  },
});
