# almostnode investigation — findings for piebox Scenario A

**Date:** 2026-05-16 · **almostnode version:** 0.2.14 · **License:** MIT
**Sources:** [npm](https://www.npmjs.com/package/almostnode), [github.com/macaly/almostnode](https://github.com/macaly/almostnode), [almostnode.dev/docs](https://almostnode.dev/docs/)

This document records the actual published API of almostnode against the assumptions
in the Scenario A task brief. It is intentionally short — only the pieces piebox needs
to make a `createVFS()` browser backend, re-point `isomorphic-git`, and dispatch
`node` / `npm` from the agent tool layer.

## 1. Constructing the in-memory environment

The top-level factory is `createContainer(options?)`:

```ts
import { createContainer } from "almostnode";

const { vfs, runtime, npm, serverBridge, execute, runFile, run, createREPL, on }
  = createContainer({ onConsole, baseUrl, onServerReady });
```

What it returns:

| Field | Type | Notes |
|---|---|---|
| `vfs` | `VirtualFS` | The in-memory filesystem (the part piebox cares about). |
| `runtime` | `Runtime` | Sync, main-thread JS/TS executor. `runtime.execute(code)`, `runtime.runFile(path)`. |
| `npm` | `PackageManager` | `install(spec, opts)`, `installFromPackageJson(opts)`, `list()`. |
| `serverBridge` | `ServerBridge` | `initServiceWorker()`, `registerServer()`, `getServerUrl(port)`. |
| `execute` / `runFile` | functions | Shortcuts onto `runtime`. |
| `run(cmd, opts?)` | `Promise<{stdout,stderr,exitCode}>` | **Bash command dispatch.** This is how `npm` and `node` get invoked from outside. |
| `createREPL` | function | Not relevant to piebox. |
| `on(event, listener)` | function | Re-exposes `serverBridge` events. |

The pieces can also be constructed individually: `new VirtualFS()`, `new Runtime(vfs, opts)`,
`new PackageManager(vfs, opts)`, `getServerBridge(opts)`. piebox should prefer
`createContainer` so all four share the same VFS instance.

## 2. VirtualFS surface vs. what piebox uses

piebox calls the following on its current `@platformatic/vfs` instance (from a project-wide grep):

```
accessSync   appendFileSync   copyFileSync   existsSync   lstatSync
mkdirSync    readFileSync     readdirSync    readlinkSync realpathSync
renameSync   rmdirSync        statSync       symlinkSync  unlinkSync
writeFileSync
```

Plus, in adapters and tools, the **options-object** forms:
`readFileSync(path, "utf-8")`, `readFileSync(path, { encoding })`,
`readdirSync(path, { withFileTypes: true })`,
`writeFileSync(path, data, { encoding })`,
`mkdirSync(path, { recursive: true, mode })`.

What almostnode `VirtualFS` provides today (read off `src/virtual-fs.ts`):

| Method | Present? | Caveat |
|---|---|---|
| `existsSync` | yes | — |
| `statSync` / `lstatSync` | yes | `lstatSync === statSync`. `Stats` has `isFile()`, `isDirectory()`, `isSymbolicLink()` (always `false`), and the usual fields. ✓ piebox's adapters rely on these methods, so they work. |
| `readFileSync` | yes | Signature is `(path)` → `Uint8Array` or `(path, 'utf8' \| 'utf-8')` → `string`. **Does NOT accept an options object** (`{ encoding }`) and **does NOT accept the `"utf-8"` form** in older parsers — only `'utf8' \| 'utf-8'` literal. piebox calls both forms today, so the adapter must normalize. |
| `writeFileSync` | yes | Signature is `(path, string \| Uint8Array)`. **No options/encoding parameter.** Auto-creates parents. piebox passes `{ encoding }` and `Buffer`s — adapter must normalize Buffer→Uint8Array and ignore encoding (UTF-8 is the only behavior). |
| `mkdirSync` | yes | Accepts `{ recursive?: boolean }`. **No `mode`.** Without `recursive`, throws `EEXIST` if it already exists. |
| `readdirSync` | yes | Returns `string[]` only. **No `{ withFileTypes: true }` support.** piebox uses `withFileTypes` in `skills.ts`, `bash-fs-adapter.ts`, `sandbox.ts` (snapshot + export), and `find.ts`. The adapter must synthesize `Dirent`-like entries by `statSync`-ing each name. |
| `unlinkSync` / `rmdirSync` / `renameSync` / `copyFileSync` / `realpathSync` / `accessSync` | yes | Straightforward. `accessSync` ignores `mode`. `realpathSync` just normalizes (no symlink resolution because there are no symlinks). |
| `appendFileSync` | **no** | Missing. piebox's `bash-fs-adapter` uses it. Adapter must implement as read+concat+write. |
| `symlinkSync` / `readlinkSync` | **no** | Missing. Already no-op or copy in the current bash-fs-adapter, so an adapter can keep the same fallback behavior. |
| `chmod` / `utimes` | **no** | Already no-op in piebox's adapters. Not a blocker. |
| `rmSync` (Node 16+) | **no** | piebox doesn't call it. Not a blocker. |
| `promises` API | **no** | `VirtualFS` has no `.promises` namespace. There ARE callback-style async methods (`readFile`, `stat`, `readdir`, `realpath`, `access`) but no `.promises.*`. `isomorphic-git` wants a `.promises` object — piebox's existing `createGitFsAdapter` already synthesizes one from sync calls, so this is already handled. |
| `watch(path, listener)` | yes | Returns an `FSWatcher`. Not used by piebox today. |
| `toSnapshot()` / `static fromSnapshot()` | yes | Native serialization (base64 for binary). piebox already has its own `VFSSnapshot` format that differs — keep piebox's, ignore almostnode's. |
| Events `vfs.on('change' \| 'delete', cb)` | yes | For worker sync; not piebox's concern. |

**Verdict on the FS interface (step 2 of the task).** The intersection of what piebox
uses and what almostnode provides is large enough that a single small adapter can bridge
them. The interface piebox depends on should be roughly the union of the methods listed
above, expressed as a thin sync `node:fs`-like surface — see "FS interface shape" below.

## 3. `isomorphic-git` consumability

`isomorphic-git` accepts `fs` two ways: a callback-style `node:fs` shape, or a `.promises`
object exposing `readFile, writeFile, unlink, readdir, mkdir, rmdir, stat, lstat, readlink,
symlink, chmod`. piebox already uses the Promises path via
`src/adapters/git-fs-adapter.ts`, which synthesizes the promise wrapper from a sync VFS.

That adapter will work on almostnode's `VirtualFS` with **two trivial changes**:

1. Replace the `import type { VirtualFileSystem } from "@platformatic/vfs"` type with the
   piebox FS interface so it accepts either backend.
2. The current `readdir` passthrough forwards options to `vfs.readdirSync` — almostnode's
   `readdirSync` ignores extra args, so this still returns `string[]` (which is what
   isomorphic-git wants for `readdir`). No change in behavior.

`readlinkSync` / `symlinkSync` calls will throw on almostnode (methods don't exist). That
is fine for the browser path because no symlinks ever exist in this VFS — isomorphic-git
will only encounter them in repos that contain symlinked workdir entries, which the
Scenario A prompt set does not exercise. We can either no-op them in the adapter or let
them throw with a clear message.

## 4. Running `node` and `npm`

There are two layers:

**Programmatic (preferred for substrate wiring):**

```ts
await npm.install("zod");                       // single package
await npm.installFromPackageJson();             // resolve from package.json
runtime.runFile("/sandbox/script.js");          // execute a script in VFS
```

`runtime` is synchronous and main-thread. `PackageManager.install` accepts
`{ save?, saveDev?, includeDev?, includeOptional?, onProgress?, transform? }`. It does
real registry fetch + tarball extraction into VFS `node_modules`. Bin entries from
package.json are wired into `/node_modules/.bin`.

**Shell-style (what the agent will actually want to drive):**

```ts
const { stdout, stderr, exitCode } = await container.run("npm install zod", { cwd });
await container.run("node script.js");
```

`container.run` is the only dispatch needed for piebox's "runtime hook" (step 5).
Internally, almostnode mounts a `just-bash` instance with two custom commands —
**`node`** and **`npm`** — over the same VFS. (See `src/shims/child_process.ts`.) So:

> **Important finding:** almostnode is **not** "no just-bash". It bundles `just-bash` as a
> direct dependency and uses it as its internal shell. What it does *not* expose is the
> rich just-bash surface piebox uses today (`Bash` class, `IFileSystem`, network policy,
> JavaScript bootstrap, etc.). Scenario A as defined still holds — piebox should not
> import `just-bash` directly in the browser build — but the line between A and B is
> blurrier than the brief implies. The B-vs-A decision is really "do we hand the agent
> almostnode's restricted `npm`+`node` only, or do we wire piebox's existing
> just-bash with the full command set?"

### Supported `npm` subcommands (the open question from prompt-sets.md)

From `src/shims/child_process.ts`, the `npm` custom-command switch covers exactly:

| Subcommand | Aliases | Implemented |
|---|---|---|
| `install` | `i`, `add` | ✓ (incl. `--save-dev` flags) |
| `run` / `run-script` | — | ✓ (with `pre`/`post` hooks) |
| `start` | — | ✓ (= `npm run start`) |
| `test` | `t`, `tst` | ✓ (= `npm run test`) |
| `ls` | `list` | ✓ |
| Anything else | — | **Unknown command** → `exitCode 1` |

Notably absent and **will not work** in Scenario A:
`npm init`, `npm uninstall`, `npm update`, `npm version`, `npm outdated`, `npm audit`,
`npm publish`, `npm view`, `npm prune`.

This directly answers prompt-set categories 4 and 8:
- **#16, #18, #19, #20, #21** in `prompt-sets.md` (FIDELITY, npm subcommands) will need the
  agent to fall back to manual `package.json` editing. Worth surfacing in the agent
  system prompt.
- **#41** (BOUNDARY, `npm audit`) will return `exitCode 1` with the message
  `npm ERR! Unknown command: "audit"` — that's a clean graceful failure. ✓

### Supported `node` invocation

The `node` custom command supports the standard forms (`node file.js`, `node -e "code"`,
inline TS via the transformer). It uses `runtime.runFile`/`runtime.execute` underneath
and pipes stdout/stderr back through the bash result. No `--test` flag was visible in
the brief read of the relevant section — that will need verification for prompt-set #1
(`node --test`). I marked this as an open question rather than coding around it; if it's
missing, the agent will fall back to running the test file directly, which works.

## 5. Trusted vs. sandboxed-iframe modes

`createRuntime(vfs, opts)` (separate from `createContainer`) gates execution explicitly:

```ts
// 1. Cross-origin sandboxed iframe (recommended for untrusted/agent code):
const rt = await createRuntime(vfs, { sandbox: "https://sandbox.example.com" });

// 2. Same-origin Worker (trusted):
const rt = await createRuntime(vfs, { dangerouslyAllowSameOrigin: true, useWorker: true });

// 3. Same-origin main thread (least secure, demos):
const rt = await createRuntime(vfs, { dangerouslyAllowSameOrigin: true });
```

Without either flag, `createRuntime` **throws**. The three concrete classes are
`SandboxRuntime`, `WorkerRuntime`, and main-thread `Runtime` (wrapped in
`AsyncRuntimeWrapper`).

`createContainer()` is the shortcut for case 3 (main thread); it does not enforce the
security gate. For a real piebox browser build that runs agent-emitted code, the demo
should use `createRuntime(vfs, { sandbox: url })` — but that requires hosting a sandbox
HTML at a separate origin (`generateSandboxFiles()` / `getSandboxHtml()` from almostnode
ship the assets to do this). **Out of scope for the present task**, but worth recording
because the Scenario A demo plan needs to budget for it.

## 6. Service Worker HTTP bridge (Hono / Category 3)

`serverBridge.initServiceWorker()` registers the SW. `serverBridge.registerServer(server,
port, hostname?)` is called automatically when in-VFS code does `http.createServer(...).
listen(port)` — the `node:http` shim invokes `setServerListenCallback`. Once registered,
`serverBridge.getServerUrl(port)` returns a real, fetchable URL that proxies into the
virtual server. This is what makes prompt-set #11 (the headline Hono prompt) viable.

No piebox wiring needed in this milestone — the bridge is "just there" once a container
exists. Step 5's runtime hook just needs to expose `getServerUrl` so the agent's
verification step (e.g. a curl/fetch tool) can resolve `localhost:3000` to the bridged URL.

## 7. Gaps that could block headline prompts

| Risk | Severity | Plan |
|---|---|---|
| `readdirSync(path, { withFileTypes: true })` not supported. | Medium. piebox's `skills.ts`, `bash-fs-adapter.ts`, snapshot, and export all use it. | Synthesize `Dirent`-like in the FS adapter (one extra `statSync` per entry — fine for the small VFS sizes we'll see in a sandbox). |
| `appendFileSync` missing. | Low. Only `bash-fs-adapter` calls it, and only the bash adapter is *Scenario B*. For Scenario A we won't ship `bash-fs-adapter`. | No action needed for this task; flag if Scenario B happens. |
| `readFileSync` doesn't accept `{ encoding }` options object. | Low. | Adapter normalizes: `opts.encoding === 'utf-8' \| 'utf8'` → string, else Uint8Array. |
| `writeFileSync` doesn't accept encoding option. | Low. | Adapter just ignores it (UTF-8 is the only behavior). |
| `Buffer` doesn't exist in pure browser context. piebox's adapters and tools cast results to `Buffer`. | Medium. | The FS interface should type the read result as `Uint8Array \| string`, not `Buffer`. Callers that need `Buffer` semantics get a polyfill (`buffer` package) or stay Node-only. |
| `node --test` may not be implemented by almostnode's `node` shim. | Low. | Document; if missing, the agent can use a workaround (Vitest, plain assert). Verify empirically when running prompt-set Category 1. |
| `npm uninstall` / `init` / `version` / `outdated` / `audit` unimplemented. | Expected (per brief). | Surface in system prompt; document; matches prompt-set tags. |
| `createRuntime` requires either a cross-origin sandbox URL or an explicit dangerously-flag. | Expected; the demo needs hosting setup. | Out of scope for this task. |
| `isomorphic-git` interacts with almostnode VFS only via piebox's existing adapter — no symlinks, no chmod issues observed. | Low. | Keep the adapter; route it through the new FS interface. |

**No hard blockers found for the substrate work in steps 2–5.** Every gap is something
piebox already papers over in its current adapters, or can paper over with the same
patterns.

## 8. Recommended FS interface shape (for step 2)

Concretely, the interface piebox internals should depend on:

```ts
interface PieboxFS {
  // Reads
  existsSync(path: string): boolean;
  statSync(path: string): FsStats;
  lstatSync(path: string): FsStats;
  readFileSync(path: string): Uint8Array;
  readFileSync(path: string, encoding: "utf-8" | "utf8"): string;
  readFileSync(path: string, options: { encoding: "utf-8" | "utf8" }): string;
  readdirSync(path: string): string[];
  readdirSync(path: string, options: { withFileTypes: true }): FsDirent[];
  realpathSync(path: string): string;
  accessSync(path: string, mode?: number): void;
  readlinkSync?(path: string): string;          // optional; throws in browser
  // Writes
  writeFileSync(path: string, data: string | Uint8Array, options?: { encoding?: string }): void;
  appendFileSync?(path: string, data: string | Uint8Array, options?: { encoding?: string }): void;
  mkdirSync(path: string, options?: { recursive?: boolean; mode?: number }): void;
  unlinkSync(path: string): void;
  rmdirSync(path: string): void;
  renameSync(from: string, to: string): void;
  copyFileSync(src: string, dest: string): void;
  symlinkSync?(target: string, path: string): void; // optional; throws in browser
}

interface FsStats {
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  size: number; mode: number; mtime: Date;
}

interface FsDirent { name: string; isFile(): boolean; isDirectory(): boolean; isSymbolicLink(): boolean; }
```

This is deliberately a strict subset of `node:fs` so the Node backend
(`@platformatic/vfs`) maps to it without a wrapper, and the browser backend
(`almostnode.VirtualFS`) gets a thin adapter that:

1. Normalizes the `readFileSync`/`writeFileSync` encoding-as-object form.
2. Synthesizes `withFileTypes` from `readdirSync` + `statSync`.
3. Implements `appendFileSync` via read+concat+write (only used by Scenario B).
4. Throws clean `ENOSYS`-style errors for `symlinkSync` / `readlinkSync`.

## 9. Runtime hook shape (for step 5)

A minimal abstraction for the agent tool layer:

```ts
interface PieboxRuntime {
  /** Dispatch a shell-style command. Browser backend: almostnode container.run. Node backend: no-op for now / future just-bash. */
  run(cmd: string, opts?: { cwd?: string; signal?: AbortSignal;
                            onStdout?: (s: string) => void;
                            onStderr?: (s: string) => void }):
    Promise<{ stdout: string; stderr: string; exitCode: number }>;

  /** Get a fetchable URL for an in-sandbox server on this port (browser only). */
  getServerUrl?(port: number): string | null;
}
```

The browser implementation wraps `createContainer().run` and `serverBridge.getServerUrl`.
The Node implementation can return a stub (or wrap piebox's existing `Bash`/`just-bash`)
when called; for this task we only need the interface and the browser implementation —
the agent tools that consume `run` are a later wiring task.

## 10. Open questions (verify when running the prompt set)

1. Does almostnode's `node` shim support `node --test`? (Prompt #1.) — needs empirical check.
2. Does the Service Worker bridge correctly survive top-frame navigation in the demo
   environment we'll host on? — demo-task concern.
3. CORS git proxy for `isomorphic-git` browser clone (prompt #28) — known requirement,
   out of scope for substrate but a near-future task.
4. Peer-dependency depth in `PackageManager.install` (prompts #24, #25) — empirical.
5. Whether almostnode bundles `node:test`, `esbuild-wasm` (TS transform), `acorn`,
   `pako`, `brotli-wasm` in a tree-shakeable way — bundle-size concern for the demo,
   not for this task.

---

## 11. Empirical findings from the browser playground (post-substrate)

Updates collected while driving the playground through real agent workflows
(Vite/React scaffolding, fib + node:test, etc.). Each gap is tracked as a
piebox issue with the upstream almostnode issue referenced.

| Gap | Triggered by | Behaviour | Workaround | Issues |
|---|---|---|---|---|
| `node --test <file>` not supported | "write fib.ts + node:test test, then run them" | almostnode's `node` shim treats `--test` as the script path → `Cannot find module '/work/--test'` | Prompt the agent to write a verify-script using `node:assert` directly (`node verify.ts`). | piebox#3, [macaly/almostnode#18](https://github.com/macaly/almostnode/issues/18) |
| `node -e "<code>"` not supported | Agent debug pattern, `node -e "console.log(...)"` | Same root cause as `--test` — flags eaten as script paths | **Translated by piebox**: `examples/browser/src/agent.ts` writes a tempfile, runs it, deletes it. `[piebox]` notice in output explains the swap. | piebox#3 |
| `node:util.styleText` missing | `npm create vite@latest` (and any Node 21+ tool that uses it) | `TypeError: (0 , import_node_util.styleText) is not a function` at module load — package fails to even import | Polyfill needed in piebox's boot path. Not yet shipped. | piebox#1, [macaly/almostnode#16](https://github.com/macaly/almostnode/issues/16) |
| `npm install` (no args) silently skips `devDependencies` | Any scaffolded project with framework in devDeps | Runtime deps install; build tools don't. `node ./node_modules/<framework>/bin/...` fails with `Cannot find module`. Agent loops trying to diagnose. | **Prompt rule shipped**: agent is told to put ALL deps (including build tools, types) into `dependencies`. Treats `devDependencies` as if it doesn't exist for sandbox projects. Wrapper-based backstop is piebox#2. | piebox#2, [macaly/almostnode#17](https://github.com/macaly/almostnode/issues/17) |
| `npm create` / `npm init <pkg>` not implemented | Any canonical scaffolding pattern (`npm create vite`, `npm create next-app`, etc.) | `npm ERR! Unknown command: "create"` | **Translated by piebox**: bash tool intercepts the canonical syntax and runs `npm install create-<name>` + `node ./node_modules/create-<name>/<bin>`. Same algorithm as real npm minus TTY/env-vars/cache. | piebox (no issue — implemented in agent.ts) |
| `npm uninstall`, `npm version`, `npm outdated`, `npm audit` unimplemented | (expected; per the original brief) | `npm ERR! Unknown command` | Prompt tells agent to edit `package.json` directly and re-run `npm install`. | — |

### What this implies about Scenario A's headline prompts today

| Headline prompt | Status today | Blocker(s) |
|---|---|---|
| Cat 1: write fib + node:test + run | **Works** with verify-script workaround | none |
| Cat 2: install zod, use it | **Works end-to-end** | none |
| Cat 3: Hono GET / server | **Works** (plain `node:http` server bridges via SW) | none |
| Cat 4: `npm run` chains like `tsc && vite build` | Partially — needs decomposition (skip `tsc`, run `vite` directly via bin path) | prompt-only fix; works once agent knows the pattern |
| Cat 5: Vite + React full scaffold + dev server | **Blocked** | piebox#1 (`styleText`) AND piebox#2 (`devDeps`) compound. The styleText fix alone isn't enough; without devDeps, `vite` never installs even when scaffolding works. |
| Cat 6: clone repo, edit, diff | **Works** (isomorphic-git in-browser, proven) | none |
| Cat 7: shell-idiom prompts (`grep -r`, `sed`) | Degrades gracefully — agent uses read+scan instead | none |
| Cat 8: BOUNDARY (native addons, raw TCP) | Fails cleanly with `Unknown command` / install errors | as expected per brief |

The blocking gap for the Vite headline prompt is **the combination of styleText + devDeps**. Either alone is paperable; together they create a multi-turn loop the agent can't reason out of.

---

**Bottom line for the next step:** no blockers. Proceed with steps 2–5. The FS interface
shape in §8 and the runtime hook shape in §9 are the concrete contracts to land.
