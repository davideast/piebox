# piebox · browser playground

Smoke-test the piebox browser substrate (`createBrowserFs` + `createBrowserRuntime`)
against a real almostnode container in a real browser.

## Run

```sh
cd examples/browser
npm install
npm run dev
```

Open the printed `http://localhost:5173` URL.

## What it exercises

Six buttons, in increasing reliance on the substrate:

| # | Tests | Maps to prompt-sets.md |
|---|---|---|
| 1 | FS round-trip — write, read, `readdir({ withFileTypes: true })`, `appendFileSync`, ENOSYS on `symlinkSync` | substrate only |
| 2 | `isomorphic-git` init → add → commit → log → statusMatrix over the in-memory FS | Cat. 6 prerequisite |
| 3 | `runtime.run("node script.js")` | Cat. 1 (#2) |
| 4 | `runtime.run("npm install zod")` — real registry, real tarball into VFS | Cat. 2 (#6) |
| 5 | `runtime.run("node validate.js")` against the just-installed `zod` | Cat. 2 (#6) |
| 6 | `node:http` server + Service Worker bridge fetch | Cat. 3 (#15) |

If 6 fails, check the browser console for SW registration errors — service workers
require a secure context (`localhost` counts) and the page must be served from the
same origin. Vite's dev server is fine.

## Notes

- This uses almostnode's **trusted main-thread mode** (`createContainer()`). Agent
  code that you don't write yourself should NOT be run this way — switch to
  `createRuntime(vfs, { sandbox: "https://your-sandbox-origin/" })` and host
  almostnode's sandbox HTML at a separate origin. That's a deployment task, not
  a code change.
- `piebox/browser` is aliased via `vite.config.ts` to the worktree source, so
  edits to `src/fs/` and `src/runtime/` show up on Vite's HMR without a build.
- The `node:http` shim resolves to almostnode's in-VFS HTTP implementation, not
  to the real network. The Service Worker bridge intercepts `fetch()` calls to
  the registered virtual port and routes them back through the VFS.
- **Dev-only.** `npm run dev` works; `npm run build` currently fails because
  almostnode constructs its Worker from `new URL("/assets/runtime-worker-…", import.meta.url)`,
  which rollup tries to resolve at build time. Until almostnode ships a
  build-friendly entry, treat the playground as a dev-server tool. Not a
  problem for substrate verification — production bundling is a deployment
  concern.
