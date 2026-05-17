/**
 * Assertive iframe-render probe.
 *
 * The old version of this script reported SERVED if `/__virtual__/<port>/src/main.tsx`
 * came back as JS containing the literal "react". That's necessary but
 * nowhere near sufficient — main.tsx can transform cleanly and the React
 * app inside the iframe can still fail to mount because of:
 *   - dep-optimizer errors ("entry point cannot be marked as external")
 *   - postcss / tailwind config resolution errors
 *   - `/@vite/client` ESM-CJS interop errors
 *   - module specifier mismatches
 * none of which the old "main.tsx came back" check could see.
 *
 * This version is actually assertive:
 *
 *   1. Connect to the running playground at PROBE_URL.
 *   2. Read `window.__piebox.container.serverBridge.getServerPorts()` to find
 *      what in-VFS HTTP servers are registered. If none, exit 2 — the probe
 *      requires an existing session (agent already started a dev server).
 *   3. Inject an iframe pointing at `/__virtual__/<port>/` and wait for it to
 *      load + the React mount to settle.
 *   4. Inspect the iframe's actual document — title, #root.textContent,
 *      script tags it pulled — and the iframe's OWN console (not the parent
 *      page's; this is critical, the iframe is where the real errors fire).
 *   5. Declare SERVED only if:
 *        - iframe document has a non-default title
 *        - #root.textContent (or #root.children.length) is non-empty
 *        - zero error-level console messages from the iframe's context
 *      Otherwise NOT_SERVED with a structured report of what was wrong.
 *
 * Output tags:
 *   [phase]    high-level markers
 *   [bridge]   server-bridge state
 *   [iframe]   iframe state (title, doc readyState, root content)
 *   [con-err]  iframe console errors (the real diagnostic surface)
 *   [done]     SERVED | NOT_SERVED with one-line verdict
 *
 * Exit codes:
 *   0  iframe rendered something
 *   1  iframe loaded but render asserted as broken
 *   2  no in-VFS server registered (no session to probe)
 *   3  script error / can't reach playground
 */

import { chromium } from "playwright";

const URL = process.env.PROBE_URL ?? "http://localhost:5173/";
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 4000);
const PORT_PREF = process.env.PROBE_PORT ? Number(process.env.PROBE_PORT) : null;

// --bootstrap: drive a clean scaffold + npm install + vite start through
// the exposed __piebox.runtime, instead of requiring the user to have
// kicked off a session manually. Slower (60s+ for npm install + dep
// optimizer warmup) but lets the probe be self-contained — important for
// chasing bugs that need a fresh in-VFS state each run.
const BOOTSTRAP = process.argv.includes("--bootstrap");
const BOOTSTRAP_TIMEOUT_MS = Number(process.env.BOOTSTRAP_TIMEOUT_MS ?? 180_000);

function log(tag, ...args) {
  const msg = args
    .map((a) => (typeof a === "string" ? a : JSON.stringify(a)))
    .join(" ");
  console.log(`[${tag}] ${msg}`);
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();

// Capture console messages from BOTH the iframe AND the parent page. We
// need parent-page coverage too because:
//   - the in-VFS Vite runs inside the parent page (almostnode container)
//   - its stdout/stderr (dep-optimizer warnings, postcss errors, etc.)
//     route through onConsole back to the parent page console
//   - those errors don't appear in the iframe context but ARE the most
//     diagnostic surface for "Vite is broken upstream of the iframe"
// Tag each one so verdict logic and reports can distinguish.
const allConsole = [];
page.on("console", (m) => {
  const loc = m.location();
  const origin = loc.url?.includes("__virtual__") ? "iframe" : "page";
  if (m.type() === "error" || m.type() === "warning") {
    allConsole.push({ origin, level: m.type(), text: m.text(), url: loc.url });
  }
});
// pageerror = uncaught exception in the page's JS (includes iframe pageerrors
// in Chromium). These are ALWAYS bad — count as errors.
const pageErrors = [];
page.on("pageerror", (e) => {
  pageErrors.push(e.message);
  log("err", "pageerror:", e.message.slice(0, 300));
});

try {
  log("phase", "navigating to", URL);
  await page.goto(URL, { waitUntil: "networkidle", timeout: 15_000 });

  if (BOOTSTRAP) {
    log("phase", "bootstrap: scaffolding template + npm install + vite start");
    // Touch runtime to force lazy boot (and exposure of window.__piebox).
    await page.evaluate(async () => {
      // The runtime store's getRuntime() builds the bundle on first call;
      // accessing it via any state read forces it. Easiest: the PreviewPane
      // calls it on mount, but we don't want to depend on tab switching —
      // just call it directly through the global wired in store/runtime.ts.
      // The global is set after buildBundle() finishes, so we wait for it.
      const start = Date.now();
      while (!window.__piebox) {
        // Trigger by importing a module that touches getRuntime. The
        // simplest path: the runtime store auto-exposes __piebox INSIDE
        // buildBundle, which runs on first PreviewPane mount. Click the
        // Preview tab to force it.
        const previewTab = Array.from(document.querySelectorAll("button")).find(
          (b) => b.textContent?.trim() === "Preview"
        );
        if (previewTab) previewTab.click();
        await new Promise((r) => setTimeout(r, 100));
        if (Date.now() - start > 5_000) throw new Error("runtime never booted (no Preview tab?)");
      }
    });

    // Scaffold + install + start vite. Done through pb.runtime.run; vite
    // is fire-and-forget (it never exits). We check server-ready via the
    // bridge afterwards.
    await page.evaluate(async (timeoutMs) => {
      const pb = window.__piebox;
      const fs = pb.fs;

      // Minimal Vite + React TS app — same shape as the playground's
      // bundled template, trimmed to the necessary files.
      fs.mkdirSync("/work", { recursive: true });
      fs.mkdirSync("/work/src", { recursive: true });
      fs.writeFileSync(
        "/work/package.json",
        JSON.stringify(
          {
            name: "probe-app",
            private: true,
            version: "0.0.0",
            type: "module",
            scripts: { dev: "vite" },
            dependencies: {
              react: "^18.3.1",
              "react-dom": "^18.3.1",
              "react-refresh": "^0.14.2",
              vite: "^5.4.8",
              "@vitejs/plugin-react": "^4.3.2",
            },
          },
          null,
          2
        ) + "\n"
      );
      fs.writeFileSync(
        "/work/vite.config.ts",
        `import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({ plugins: [react()], server: { allowedHosts: true } });
`
      );
      fs.writeFileSync(
        "/work/index.html",
        `<!doctype html><html><head><title>PROBE_APP</title></head><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>
`
      );
      fs.writeFileSync(
        "/work/src/main.tsx",
        `import React from "react";
import ReactDOM from "react-dom/client";
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode><h1 data-testid="probe-rendered">probe rendered</h1></React.StrictMode>
);
`
      );

      // npm install — blocking; this is what eats most of the bootstrap time.
      // cwd: '/work' so npm finds the package.json we just wrote there
      // (the runtime's default cwd may differ).
      const install = await pb.runtime.run("npm install", { cwd: "/work" });
      if (install.exitCode !== 0) {
        throw new Error("npm install failed: exit=" + install.exitCode + "\n" + (install.stderr || ""));
      }

      // Start vite — fire-and-forget. The server keeps the runtime alive.
      // We don't await; we check serverBridge.getServerPorts() in the next
      // poll loop. The deadline is enforced outside.
      pb.runtime
        .run("node ./node_modules/vite/bin/vite.js", { cwd: "/work" })
        .then(() => console.warn("[probe-bootstrap] vite exited unexpectedly"))
        .catch((e) => console.error("[probe-bootstrap] vite failed:", String(e)));

      // Wait until the bridge sees a registered port. With Vite this
      // happens after esbuild-wasm initializes + config bundles, so it's
      // not instant. Cap with the parent-provided timeout.
      const start = Date.now();
      while (Date.now() - start < timeoutMs) {
        const ports = pb.container?.serverBridge?.getServerPorts?.() ?? [];
        if (ports.length > 0) return { ports };
        await new Promise((r) => setTimeout(r, 250));
      }
      throw new Error("bootstrap: no server-ready within " + timeoutMs + "ms");
    }, BOOTSTRAP_TIMEOUT_MS);
    log("phase", "bootstrap: vite registered with bridge");
  }

  // Find in-VFS HTTP servers via the exposed bridge. The runtime store
  // populates window.__piebox lazily; if it's missing, the runtime hasn't
  // booted yet — boot it and re-check.
  log("phase", "reading bridge state");
  const ports = await page.evaluate(() => {
    const pb = window.__piebox;
    if (!pb) return { error: "window.__piebox not set (runtime not booted)" };
    const bridge = pb.container?.serverBridge;
    if (!bridge || typeof bridge.getServerPorts !== "function") {
      return { error: "serverBridge.getServerPorts not exposed" };
    }
    return { ports: bridge.getServerPorts() };
  });

  if (ports.error) {
    log("bridge", "no bridge:", ports.error);
    log("done", "NOT_PROBABLE · " + ports.error);
    await browser.close();
    process.exit(2);
  }
  if (!ports.ports || ports.ports.length === 0) {
    log("bridge", "no in-VFS servers registered");
    log("done", "NOT_PROBABLE · run the agent (or a dev server) before probing");
    await browser.close();
    process.exit(2);
  }
  log("bridge", `registered ports: ${ports.ports.join(", ")}`);

  const port = PORT_PREF ?? ports.ports[ports.ports.length - 1];
  if (PORT_PREF && !ports.ports.includes(port)) {
    log("done", `NOT_PROBABLE · PROBE_PORT=${port} not in registered ports`);
    await browser.close();
    process.exit(2);
  }
  log("phase", `targeting in-VFS server on port ${port}`);

  // Inject an iframe; wait for its document to be available and reasonably
  // settled. We watch the iframe's network-idle via load events plus a fixed
  // settle window — Vite's dep optimizer often fires a wave of requests
  // *after* main.tsx parses, and the React app only mounts after they
  // resolve.
  log("phase", "creating iframe + waiting for settle");
  await page.evaluate((target) => {
    let existing = document.getElementById("__probe_iframe__");
    if (existing) existing.remove();
    const f = document.createElement("iframe");
    f.id = "__probe_iframe__";
    f.src = target;
    f.style.cssText =
      "position:fixed;right:8px;bottom:8px;width:640px;height:480px;border:2px solid magenta;z-index:99999;background:white;";
    document.body.appendChild(f);
  }, `/__virtual__/${port}/`);

  // Wait for the iframe to actually finish navigating.
  await page.waitForFunction(
    () => {
      const f = document.getElementById("__probe_iframe__");
      const doc = f?.contentDocument;
      return doc && doc.readyState === "complete";
    },
    null,
    { timeout: 15_000 }
  );
  log("phase", `iframe document ready; holding ${SETTLE_MS}ms for transforms + mount`);
  await new Promise((r) => setTimeout(r, SETTLE_MS));

  // Inspect what actually landed.
  const inspection = await page.evaluate(() => {
    const f = document.getElementById("__probe_iframe__");
    const doc = f?.contentDocument;
    if (!doc) return { error: "no contentDocument (cross-origin?)" };
    const root = doc.getElementById("root");
    return {
      title: doc.title,
      readyState: doc.readyState,
      bodyChildren: doc.body?.children?.length ?? 0,
      rootExists: !!root,
      rootChildren: root?.children?.length ?? 0,
      rootText: (root?.textContent ?? "").slice(0, 300),
      scriptSrcs: Array.from(doc.querySelectorAll("script[src]")).map((s) => s.getAttribute("src")),
      moduleScripts: Array.from(
        doc.querySelectorAll('script[type="module"]')
      ).map((s) => s.getAttribute("src") ?? "[inline]"),
    };
  });

  log("iframe", "title:", inspection.title);
  log("iframe", "readyState:", inspection.readyState);
  log("iframe", "body children:", inspection.bodyChildren);
  log("iframe", "#root exists:", inspection.rootExists, "children:", inspection.rootChildren);
  log("iframe", "#root text (first 300):", inspection.rootText.replace(/\s+/g, " ").trim() || "(empty)");
  log("iframe", "scripts:", inspection.scriptSrcs.join(" | "));

  // Report console + page errors, split by origin so the report is
  // diagnostic at a glance.
  const iframeErrors = allConsole.filter((c) => c.origin === "iframe" && c.level === "error");
  const pageConsoleErrors = allConsole.filter((c) => c.origin === "page" && c.level === "error");
  if (iframeErrors.length) {
    log("phase", `${iframeErrors.length} iframe console error(s)`);
    for (const e of iframeErrors) log("con-err", "iframe", e.text.slice(0, 600));
  }
  if (pageConsoleErrors.length) {
    log("phase", `${pageConsoleErrors.length} parent-page console error(s)`);
    for (const e of pageConsoleErrors) log("con-err", "page", e.text.slice(0, 600));
  }
  if (pageErrors.length) {
    log("phase", `${pageErrors.length} pageerror(s) (uncaught exceptions)`);
    for (const e of pageErrors) log("con-err", "pageerror", e.slice(0, 600));
  }
  if (!iframeErrors.length && !pageConsoleErrors.length && !pageErrors.length) {
    log("phase", "no console errors anywhere");
  }

  // Verdict — three independent assertions; ALL must pass for SERVED.
  // We count iframe errors AND pageerrors as render-blocking, but treat
  // parent-page console errors (in-VFS Vite warnings) as advisory: they
  // print but don't gate the verdict, so a Vite quirk that doesn't
  // actually prevent the app from rendering won't fail us. The render
  // assertion (#root has content) is the real backstop — if Vite is
  // broken enough to break rendering, #root will be empty.
  const rootRenderedSomething =
    inspection.rootExists && (inspection.rootChildren > 0 || inspection.rootText.trim().length > 0);
  const titleLooksReal =
    inspection.title &&
    inspection.title.toLowerCase() !== "vite app" &&
    inspection.title.length > 0;
  const noFatalRuntimeErrors = iframeErrors.length === 0 && pageErrors.length === 0;

  const checks = {
    "title-non-default": titleLooksReal,
    "root-rendered": rootRenderedSomething,
    "no-fatal-runtime-errors": noFatalRuntimeErrors,
  };
  for (const [k, v] of Object.entries(checks)) {
    log("check", (v ? "PASS" : "FAIL") + " " + k);
  }
  const allPassed = Object.values(checks).every(Boolean);

  if (allPassed) {
    log("done", `SERVED · iframe rendered, no fatal runtime errors`);
    if (pageConsoleErrors.length) {
      log("note", `${pageConsoleErrors.length} parent-page advisory error(s) — see above; not render-blocking but worth investigating`);
    }
    await browser.close();
    process.exit(0);
  } else {
    const reasons = Object.entries(checks)
      .filter(([, v]) => !v)
      .map(([k]) => k)
      .join(", ");
    log("done", `NOT_SERVED · failed checks: ${reasons}`);
    await browser.close();
    process.exit(1);
  }
} catch (e) {
  log("err", "script:", e.message);
  await browser.close();
  process.exit(3);
}
