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

const logEl = document.getElementById("log") as HTMLPreElement;
const statusEl = document.getElementById("status") as HTMLParagraphElement;

function log(...args: unknown[]): void {
  const line = args
    .map((a) =>
      typeof a === "string"
        ? a
        : a instanceof Error
          ? `${a.name}: ${a.message}`
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
  // Build a minimal FsClient on top of PieboxFS the same way piebox's
  // git-fs-adapter does. This is reproduced inline to avoid pulling the
  // Node-only piebox main entry into the bundle.
  const promises = {
    readFile: async (p: string, opts?: any) =>
      opts?.encoding ? fs.readFileSync(p, opts.encoding) : fs.readFileSync(p),
    writeFile: async (p: string, data: any) => fs.writeFileSync(p, data),
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
});

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
