/**
 * piebox browser playground.
 *
 * Six demos that exercise the substrate end-to-end in a real browser:
 *   1. FS round-trip through the piebox interface (write/read/readdir+dirents)
 *   2. isomorphic-git init/add/commit/log over the same in-memory FS
 *   3. node script execution via the runtime hook
 *   4. real npm install against the registry
 *   5. running a script that imports the just-installed package
 *   6. http server + Service Worker bridge fetch
 */

import { createContainer } from "almostnode";
import git from "isomorphic-git";
import { createBrowserFs, createBrowserRuntime } from "piebox/browser";
import { buildAgent, getStoredApiKey, storeApiKey, clearApiKey } from "./agent.js";
import { HTMLStreamAdapter } from "./html-adapter.js";
import { SessionEventTranslator } from "./session-to-stream.js";
import { TracePanel, createUiTracer } from "./tracer.js";
import { PreviewController } from "./preview.js";

const logEl = document.getElementById("log") as HTMLPreElement;
const statusEl = document.getElementById("status") as HTMLParagraphElement;

function log(...args: unknown[]): void {
  const line = args
    .map((a) =>
      typeof a === "string"
        ? a
        : a instanceof Error
          ? `${a.name}: ${a.message}\n${a.stack ?? ""}`
          : JSON.stringify(a, null, 2),
    )
    .join(" ");
  logEl.textContent += line + "\n";
  logEl.scrollTop = logEl.scrollHeight;
}

function setStatus(s: string): void {
  statusEl.textContent = s;
}

function section(label: string): void {
  log("");
  log(`── ${label} ──`);
}

// ── Boot ──────────────────────────────────────────────────────────────────
setStatus("constructing almostnode container…");
const container = createContainer({
  onConsole: (level, ...args) => log(`[console:${level}]`, ...args),
});
const fs = createBrowserFs({ source: container.vfs });
const runtime = createBrowserRuntime({ container });

// Preview controller — surfaces in-sandbox HTTP servers as an iframe.
const preview = new PreviewController({
  panel: document.getElementById("preview-panel") as HTMLElement,
  iframe: document.getElementById("preview-frame") as HTMLIFrameElement,
  tabs: document.getElementById("preview-tabs") as HTMLElement,
  meta: document.getElementById("preview-meta") as HTMLElement,
  empty: document.getElementById("preview-empty") as HTMLElement,
});
container.on("server-ready", (...args: unknown[]) => {
  const port = args[0] as number;
  const url = args[1] as string;
  preview.onServerReady(port, url);
});

// Initialise the Service Worker bridge once at boot. Required for any
// in-sandbox http.createServer() to actually be reachable via fetch / iframe.
// `initServiceWorker` is idempotent — safe to call once at startup; the
// bridge then auto-routes future server registrations through it.
(async () => {
  try {
    const bridge = (container as { serverBridge?: { initServiceWorker?: () => Promise<void> } }).serverBridge;
    if (bridge?.initServiceWorker) {
      await bridge.initServiceWorker();
    }
  } catch (e) {
    log("SW init at boot failed (preview may not work):", String(e));
  }
})();

setStatus("ready · main-thread / trusted mode");
log("piebox browser playground ready.");
log("almostnode container constructed; FS + runtime wired.");

// ── Helpers ───────────────────────────────────────────────────────────────
function btn(id: string, fn: () => void | Promise<void>): void {
  const el = document.getElementById(id) as HTMLButtonElement | null;
  if (!el) return;
  el.addEventListener("click", async () => {
    el.disabled = true;
    try {
      await fn();
    } catch (e) {
      log("✗", e);
    } finally {
      el.disabled = false;
    }
  });
}

function ensureWorkDir(): void {
  try {
    fs.mkdirSync("/work", { recursive: true });
  } catch {
    /* already exists */
  }
}

// ── 1 · FS round-trip ─────────────────────────────────────────────────────
btn("fs", () => {
  section("1 · FS round-trip");
  ensureWorkDir();
  fs.writeFileSync("/work/hello.txt", "hi from piebox\n");
  fs.mkdirSync("/work/sub", { recursive: true });
  fs.writeFileSync("/work/sub/nested.json", JSON.stringify({ ok: true }));

  log("readFileSync utf-8 →", fs.readFileSync("/work/hello.txt", "utf-8").trim());
  log(
    "readFileSync options →",
    fs.readFileSync("/work/sub/nested.json", { encoding: "utf-8" }),
  );

  const dirents = fs.readdirSync("/work", { withFileTypes: true });
  log(
    "readdir withFileTypes →",
    dirents.map((d) => ({
      name: d.name,
      isFile: d.isFile(),
      isDirectory: d.isDirectory(),
    })),
  );

  // Appendsync via the adapter (read+concat+write under the hood)
  fs.appendFileSync?.("/work/hello.txt", "appended line\n");
  log("after append →", fs.readFileSync("/work/hello.txt", "utf-8"));

  // ENOSYS surfaces cleanly
  try {
    fs.symlinkSync?.("/work/hello.txt", "/work/link");
  } catch (e) {
    log("symlinkSync (expected ENOSYS) →", String(e));
  }
});

// ── 2 · isomorphic-git over the in-memory FS ─────────────────────────────
btn("git", async () => {
  section("2 · isomorphic-git in-memory");
  // almostnode installs its own Buffer polyfill on globalThis.Buffer, and
  // isomorphic-git's BufferCursor picks it up via the global. The two
  // polyfills disagree on .set() bounds semantics, so the standard `buffer`
  // package (a faithful Node implementation) is swapped in around the git
  // ops and restored afterwards.
  const { Buffer: StdBuffer } = await import("buffer");
  const savedBuffer = (globalThis as any).Buffer;
  (globalThis as any).Buffer = StdBuffer;
  try {
    await runIsomorphicGit();
  } finally {
    (globalThis as any).Buffer = savedBuffer;
  }
});

async function runIsomorphicGit(): Promise<void> {
  // Build a minimal FsClient on top of PieboxFS the same way piebox's
  // git-fs-adapter does. This is reproduced inline to avoid pulling the
  // Node-only piebox main entry into the bundle.
  // Defensively copy Uint8Arrays on the read/write boundary. isomorphic-git
  // wraps read results as Buffers via `Buffer.from(arr.buffer, arr.byteOffset,
  // arr.byteLength)`; if the stored bytes are a subarray view into a larger
  // ArrayBuffer, that wrap throws "offset is out of bounds". Copying on the
  // way in and out gives isomorphic-git a clean buffer to own.
  const promises = {
    readFile: async (p: string, opts?: any) => {
      const data = opts?.encoding
        ? fs.readFileSync(p, opts.encoding)
        : fs.readFileSync(p);
      return data instanceof Uint8Array ? new Uint8Array(data) : data;
    },
    writeFile: async (p: string, data: any) =>
      fs.writeFileSync(p, data instanceof Uint8Array ? new Uint8Array(data) : data),
    unlink: async (p: string) => fs.unlinkSync(p),
    readdir: async (p: string) => fs.readdirSync(p),
    mkdir: async (p: string, _opts?: any) =>
      fs.mkdirSync(p, { recursive: true }),
    rmdir: async (p: string) => fs.rmdirSync(p),
    stat: async (p: string) => fs.statSync(p),
    lstat: async (p: string) => fs.lstatSync(p),
    readlink: async (p: string) => {
      if (!fs.readlinkSync) throw Object.assign(new Error("ENOSYS"), { code: "ENOSYS" });
      return fs.readlinkSync(p);
    },
    symlink: async (_t: string, p: string) => {
      if (!fs.symlinkSync) throw Object.assign(new Error("ENOSYS"), { code: "ENOSYS" });
      fs.symlinkSync(_t, p);
    },
    chmod: async () => {},
  };
  const gitFs = { promises };

  const dir = "/repo";
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {}

  await git.init({ fs: gitFs as any, dir, defaultBranch: "main" });
  fs.writeFileSync(`${dir}/README.md`, "# in-browser repo\n");
  await git.add({ fs: gitFs as any, dir, filepath: "README.md" });

  const sha = await git.commit({
    fs: gitFs as any,
    dir,
    message: "initial",
    author: { name: "playground", email: "play@piebox.local" },
  });
  log("committed", sha);

  const logEntries = await git.log({ fs: gitFs as any, dir, depth: 1 });
  log("latest commit message →", logEntries[0]?.commit.message.trim());

  fs.writeFileSync(`${dir}/README.md`, "# in-browser repo (edited)\n");
  const matrix = await git.statusMatrix({ fs: gitFs as any, dir });
  const modified = matrix
    .filter(([, head, work]) => head !== work)
    .map(([p]) => p);
  log("modified after edit →", modified);
}

// ── 3 · node script ───────────────────────────────────────────────────────
btn("run", async () => {
  section("3 · node script");
  ensureWorkDir();
  fs.writeFileSync(
    "/work/script.js",
    `console.log("hello from node@browser:", 2 + 2);`,
  );
  const r = await runtime.run("node script.js", { cwd: "/work" });
  log(`exit=${r.exitCode}`);
  if (r.stdout) log("stdout:", r.stdout);
  if (r.stderr) log("stderr:", r.stderr);
});

// ── 4 · npm install zod ───────────────────────────────────────────────────
btn("install", async () => {
  section("4 · npm install zod");
  ensureWorkDir();
  fs.writeFileSync(
    "/work/package.json",
    JSON.stringify({ name: "demo", version: "0.0.0", type: "module" }, null, 2),
  );
  log("running `npm install zod` in /work …");
  const r = await runtime.run("npm install zod", {
    cwd: "/work",
    onStdout: (s) => log("·", s.trim()),
    onStderr: (s) => log("·err", s.trim()),
  });
  log(`exit=${r.exitCode}`);
  // Show what landed in node_modules
  try {
    const top = fs.readdirSync("/work/node_modules") as string[];
    log("node_modules top-level →", top);
  } catch (e) {
    log("no node_modules:", String(e));
  }
});

// ── 5 · use installed zod ─────────────────────────────────────────────────
btn("use-zod", async () => {
  section("5 · use installed zod");
  ensureWorkDir();
  fs.writeFileSync(
    "/work/validate.js",
    `import { z } from "zod";
const Schema = z.object({ name: z.string(), age: z.number().int().nonnegative() });
const result = Schema.safeParse({ name: "ada", age: 36 });
console.log("ok:", result.success, "data:", result.success ? result.data : result.error.message);
const bad = Schema.safeParse({ name: "ada", age: -1 });
console.log("rejected:", !bad.success, "issue:", !bad.success ? bad.error.issues[0].message : "");`,
  );
  const r = await runtime.run("node validate.js", { cwd: "/work" });
  log(`exit=${r.exitCode}`);
  if (r.stdout) log("stdout:", r.stdout);
  if (r.stderr) log("stderr:", r.stderr);
});

// ── 6 · http server + bridge fetch ────────────────────────────────────────
btn("server", async () => {
  section("6 · http server + bridge fetch");
  ensureWorkDir();

  // Make sure the SW bridge is registered (no-op if already done).
  const bridge = (container as any).serverBridge;
  if (bridge?.initServiceWorker) {
    try {
      await bridge.initServiceWorker();
      log("service worker bridge ready");
    } catch (e) {
      log("SW init failed (some browsers/contexts block SW):", String(e));
    }
  }

  fs.writeFileSync(
    "/work/server.js",
    `const http = require("node:http");
const srv = http.createServer((req, res) => {
  res.writeHead(200, { "content-type": "text/plain" });
  res.end("pong " + req.url + "\\n");
});
srv.listen(3000, () => console.log("listening on 3000"));`,
  );

  // Start the server; the promise resolves only when the process exits.
  // Track it so we can report on shutdown.
  runtime
    .run("node server.js", { cwd: "/work" })
    .then((r) => log("server exited", r));

  // Give the listen callback + bridge registration a tick.
  await new Promise((r) => setTimeout(r, 500));

  const url = runtime.getServerUrl?.(3000);
  log("bridged URL →", url ?? "(not registered)");
  if (url) {
    try {
      const res = await fetch(`${url}/ping`);
      log(`fetch status=${res.status}`);
      log("body:", (await res.text()).trim());
    } catch (e) {
      log("fetch failed:", String(e));
    }
  }
});

document.getElementById("clear")?.addEventListener("click", () => {
  logEl.textContent = "";
});

// ── Prompt + agent + HTML streaming ───────────────────────────────────────

const keyInput = document.getElementById("key-input") as HTMLInputElement;
const keyStatus = document.getElementById("key-status") as HTMLElement;
const promptInput = document.getElementById("prompt-input") as HTMLTextAreaElement;
const promptStatus = document.getElementById("prompt-status") as HTMLElement;
const feedEl = document.getElementById("feed") as HTMLElement;
const tracesEl = document.getElementById("traces") as HTMLElement;
const tracePanel = new TracePanel(tracesEl);
const tracer = createUiTracer(tracePanel);

function refreshKeyStatus(): void {
  const k = getStoredApiKey();
  keyStatus.textContent = k
    ? `key set (…${k.slice(-4)})`
    : "(none — paste a Google API key and click save)";
}
refreshKeyStatus();

document.getElementById("key-save")?.addEventListener("click", () => {
  const v = keyInput.value.trim();
  if (!v) return;
  storeApiKey(v);
  keyInput.value = "";
  refreshKeyStatus();
});
document.getElementById("key-clear")?.addEventListener("click", () => {
  clearApiKey();
  refreshKeyStatus();
});
document.getElementById("feed-clear")?.addEventListener("click", () => {
  feedEl.textContent = "";
  tracePanel.clear();
});

// Walk /work and collect path → size+mtime. Skip node_modules — it bloats
// the diff and the agent never edits it directly.
function snapshotFiles(root: string): Map<string, string> {
  const out = new Map<string, string>();
  const walk = (dir: string): void => {
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const p = dir.endsWith("/") ? dir + e.name : `${dir}/${e.name}`;
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) {
        try {
          const st = fs.statSync(p);
          out.set(p, `${st.size}:${st.mtime.getTime()}`);
        } catch {
          out.set(p, "");
        }
      }
    }
  };
  walk(root);
  return out;
}

function diffSnapshots(
  before: Map<string, string>,
  after: Map<string, string>,
): { newFiles: string[]; modifiedFiles: string[]; unchangedCount: number } {
  const newFiles: string[] = [];
  const modifiedFiles: string[] = [];
  let unchangedCount = 0;
  for (const [path, fp] of after) {
    if (!before.has(path)) newFiles.push(path);
    else if (before.get(path) !== fp) modifiedFiles.push(path);
    else unchangedCount++;
  }
  return { newFiles, modifiedFiles, unchangedCount };
}

const promptBtn = document.getElementById("prompt-run") as HTMLButtonElement;
promptBtn.addEventListener("click", async () => {
  const text = promptInput.value.trim();
  if (!text) return;
  const apiKey = getStoredApiKey();
  if (!apiKey) {
    promptStatus.textContent = "no API key — paste one above and save";
    return;
  }

  promptBtn.disabled = true;
  promptStatus.textContent = "building agent…";
  ensureWorkDir();

  const adapter = new HTMLStreamAdapter({ container: feedEl });
  const translator = new SessionEventTranslator();
  const abort = new AbortController();
  let toolCalls = 0;
  const failedToolCalls: Array<{ name: string; summary: string }> = [];
  const toolNameByCallId = new Map<string, string>();
  const before = snapshotFiles("/work");

  try {
    const { session, modelId } = buildAgent({
      fs,
      runtime,
      cwd: "/work",
      apiKey,
      tracer,
    });

    await adapter.start?.();
    adapter.write({
      type: "session_start",
      model: modelId,
      sandbox: "/work",
      prompt: text,
      timestamp: Date.now(),
    });

    const t0 = performance.now();
    promptStatus.textContent = "running…";

    for await (const ev of session.submit(text, abort.signal)) {
      if (ev.kind === "tool_started") {
        toolCalls += 1;
        toolNameByCallId.set(ev.callId, ev.name);
      }
      if (ev.kind === "tool_finished" && !ev.result.ok) {
        failedToolCalls.push({
          name: toolNameByCallId.get(ev.callId) ?? "?",
          summary: ev.result.summary ?? "(no summary)",
        });
      }
      const mapped = translator.translate(ev);
      for (const m of mapped) {
        try {
          adapter.write(m);
        } catch (err) {
          log("adapter error:", err);
        }
      }
      if (ev.kind === "completed") break;
    }

    const after = snapshotFiles("/work");
    const { newFiles, modifiedFiles, unchangedCount } = diffSnapshots(before, after);
    adapter.write({
      type: "session_end",
      durationMs: performance.now() - t0,
      newFiles,
      modifiedFiles,
      unchangedCount,
      toolCalls,
      fileTree: [],
    });
    // Deterministic integrity check: if the agent declared completion but
    // any tool call failed along the way, the agent might be fabricating
    // success. Surface that to the user as a warning card.
    if (failedToolCalls.length > 0) {
      const summary = failedToolCalls
        .map((f) => `  • ${f.name}: ${f.summary}`)
        .join("\n");
      adapter.write({
        type: "error",
        code: "FAILED_TOOL_CALLS",
        message:
          `${failedToolCalls.length} tool call(s) failed during this session. ` +
          `If the agent claimed success, verify against the cards above:\n${summary}`,
      } as any);
    }
    await adapter.end?.();
    promptStatus.textContent =
      failedToolCalls.length > 0
        ? `done with ${failedToolCalls.length} failed tool call(s)`
        : "done";
  } catch (e) {
    promptStatus.textContent = "error";
    adapter.write({
      type: "error",
      code: "AGENT_ERROR",
      message: e instanceof Error ? `${e.message}\n${e.stack ?? ""}` : String(e),
    } as any);
    await adapter.end?.();
    log("agent error:", e);
  } finally {
    promptBtn.disabled = false;
  }
});

// ── Preview panel manual triggers ────────────────────────────────────────
// "Run dev server in /work" — auto-detect package.json scripts.dev and run
// it (most commonly `vite`). Falls back to `node ./node_modules/.bin/vite`
// equivalents that work without npx.
document.getElementById("preview-run-dev")?.addEventListener("click", async () => {
  const btn = document.getElementById("preview-run-dev") as HTMLButtonElement;
  btn.disabled = true;
  try {
    if (!fs.existsSync("/work/package.json")) {
      log("preview-run-dev: /work/package.json not found — install something first");
      return;
    }
    const pkg = JSON.parse(fs.readFileSync("/work/package.json", "utf-8") as string) as {
      scripts?: Record<string, string>;
    };
    const devScript = pkg.scripts?.dev ?? pkg.scripts?.start;
    if (!devScript) {
      log("preview-run-dev: no scripts.dev or scripts.start in package.json");
      return;
    }
    // Translate the most common chain forms to direct binary invocation.
    // `vite` → node ./node_modules/vite/bin/vite.js
    // `next dev` → node ./node_modules/next/dist/bin/next dev
    let cmd: string;
    if (/^vite\b/.test(devScript)) {
      cmd = devScript.replace(/^vite\b/, "node ./node_modules/vite/bin/vite.js");
    } else if (/^next\b/.test(devScript)) {
      cmd = devScript.replace(/^next\b/, "node ./node_modules/next/dist/bin/next");
    } else {
      // Best-effort: try npm run; will fail on chained binaries but worth a shot.
      cmd = `npm run ${pkg.scripts?.dev ? "dev" : "start"}`;
    }
    log(`preview-run-dev: starting "${cmd}" in /work …`);
    log("(server runs in the background; this promise resolves on exit)");
    runtime.run(cmd, { cwd: "/work" }).then((r) => {
      log(`dev server exited: exit=${r.exitCode}`);
      if (r.stderr) log("stderr:", r.stderr.slice(0, 800));
    });
  } catch (e) {
    log("preview-run-dev failed:", e);
  } finally {
    setTimeout(() => { btn.disabled = false; }, 1000);
  }
});

// "Quick test: static server" — spin up a tiny node:http server that serves
// /work so you can verify the preview iframe is wired correctly even when no
// real dev server is around.
document.getElementById("preview-run-probe")?.addEventListener("click", async () => {
  const btn = document.getElementById("preview-run-probe") as HTMLButtonElement;
  btn.disabled = true;
  try {
    ensureWorkDir();
    if (!fs.existsSync("/work/index.html")) {
      fs.writeFileSync(
        "/work/index.html",
        "<!doctype html><html><body style=\"background:#131317;color:#e4e1e7;font-family:monospace;padding:2rem\"><h1>piebox preview probe</h1><p>If you can read this, the Service Worker bridge is working.</p></body></html>",
      );
    }
    fs.writeFileSync(
      "/work/__preview-probe.js",
      `const http = require("node:http");
const fs = require("node:fs");
const srv = http.createServer((req, res) => {
  // Strip query string before path lookup — the preview iframe's reload
  // button appends ?_=<ts> for cache-busting and we don't want to 404 on it.
  const clean = (req.url || "/").split("?")[0];
  const url = clean === "/" ? "/index.html" : clean;
  try {
    const body = fs.readFileSync("/work" + url, "utf-8");
    const type = url.endsWith(".html") ? "text/html"
               : url.endsWith(".css")  ? "text/css"
               : url.endsWith(".js")   ? "text/javascript"
               : "text/plain";
    res.writeHead(200, { "content-type": type });
    res.end(body);
  } catch {
    res.writeHead(404); res.end("not found: " + url);
  }
});
srv.listen(4173, () => console.log("preview-probe listening on 4173"));`,
    );
    log("preview-run-probe: starting static server on :4173 …");
    runtime.run("node __preview-probe.js", { cwd: "/work" }).then((r) => {
      log(`preview-probe exited: exit=${r.exitCode}`);
    });
  } catch (e) {
    log("preview-run-probe failed:", e);
  } finally {
    setTimeout(() => { btn.disabled = false; }, 1000);
  }
});
