/**
 * Vitest config — aliases the local piebox package + subpaths to the
 * in-repo source so tests across the workspace (including
 * `@piebox/driver-agent`'s session tests) resolve `piebox`,
 * `piebox/layer2`, and `piebox/operations` to this repo's TypeScript
 * sources rather than the published `piebox` on npm.
 *
 * Added during Step 5 of the composable-sandbox migration plan
 * (`docs/investigations/G-migration.md`). Without these aliases, an
 * `npm install` brings the previously-published piebox into
 * `node_modules/piebox`, which lacks the `./layer2` and
 * `./operations` sub-paths the driver-agent imports.
 */
import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "piebox/layer2": `${root}src/layer2/index.ts`,
      "piebox/operations": `${root}src/operations/index.ts`,
      piebox: `${root}src/index.ts`,
    },
  },
  test: {
    // Pick up tests in src/ (piebox core) and across packages/*.
    // Without an explicit include, vitest's default scans relative
    // to whichever cwd it autodetects per workspace.
    include: [
      "src/**/*.{test,spec}.?(c|m)[jt]s?(x)",
      "packages/*/test/**/*.{test,spec}.?(c|m)[jt]s?(x)",
      "packages/*/src/**/*.{test,spec}.?(c|m)[jt]s?(x)",
    ],
  },
});
