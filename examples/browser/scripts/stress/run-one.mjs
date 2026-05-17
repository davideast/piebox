/**
 * Run ONE stress-test template against the substrate. Usage:
 *
 *   node scripts/stress/run-one.mjs <test-name>
 *
 * Example:
 *
 *   node scripts/stress/run-one.mjs T2-tailwind3
 *
 * Driven by Playwright:
 *   1. Fresh page → fresh almostnode runtime (no VFS carry-over).
 *   2. Write template files into /work via __piebox.fs.
 *   3. npm install via __piebox.runtime.run({cwd: '/work'}).
 *   4. Fire-and-forget `node ./node_modules/vite/bin/vite.js` — server-ready
 *      lights up serverBridge.getServerPorts() when it binds.
 *   5. Mount an iframe to /__virtual__/<port>/. Wait for settle.
 *   6. Inspect iframe DOM + iframe console + parent-page errors.
 *   7. Print a structured summary block; exit non-zero on FAIL.
 *
 * The summary format is the same shape for every test so a runner-of-
 * runners can grep across them.
 */
import { chromium } from "playwright";
import { TESTS } from "./templates.mjs";

const NAME = process.argv[2];
if (!NAME) {
  console.error("usage: run-one.mjs <test-name>");
  process.exit(64);
}
const test = TESTS.find((t) => t.name === NAME);
if (!test) {
  console.error("unknown test: " + NAME + " (valid: " + TESTS.map((t) => t.name).join(", ") + ")");
  process.exit(64);
}

const URL = process.env.PROBE_URL ?? "http://localhost:5173/";
const NPM_TIMEOUT_MS = Number(process.env.NPM_TIMEOUT_MS ?? 120_000);
const VITE_BOOT_TIMEOUT_MS = Number(process.env.VITE_BOOT_TIMEOUT_MS ?? 60_000);
const SETTLE_MS = Number(process.env.SETTLE_MS ?? 5000);

function log(tag, ...args) {
  const s = args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" ");
  console.log(`[${tag}] ${s}`);
}

// Summary printer — same structure across all 10 tests so a parent
// process can grep `^## ` for headers.
function summary(name, summary, status, opts = {}) {
  const lines = [];
  lines.push("");
  lines.push(`## ${name} — ${status}`);
  lines.push(`> ${summary}`);
  lines.push("");
  if (opts.iframe) {
    lines.push(`**iframe**:  title=${JSON.stringify(opts.iframe.title)}  #root.children=${opts.iframe.rootChildren}  text=${JSON.stringify((opts.iframe.rootText || "").slice(0, 120))}`);
  }
  if (opts.errors?.length) {
    lines.push("");
    lines.push("**errors**:");
    for (const e of opts.errors) lines.push(`  - [${e.origin}] ${e.text.slice(0, 200)}`);
  }
  if (opts.checks) {
    lines.push("");
    lines.push("**checks**:");
    for (const [k, v] of Object.entries(opts.checks)) {
      lines.push(`  - ${v ? "✅" : "❌"} ${k}`);
    }
  }
  if (opts.failReasons?.length) {
    lines.push("");
    lines.push(`**fail reasons**: ${opts.failReasons.join(" · ")}`);
  }
  console.log(lines.join("\n"));
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();

const allConsole = [];
page.on("console", (m) => {
  const loc = m.location();
  const origin = loc.url?.includes("__virtual__") ? "iframe" : "page";
  if (m.type() === "error" || m.type() === "warning") {
    allConsole.push({ origin, level: m.type(), text: m.text(), url: loc.url });
  }
});
// Capture iframe network failures so 404s are attributable to a URL.
const iframeFailedRequests = [];
page.on("requestfailed", (r) => {
  iframeFailedRequests.push({ url: r.url(), err: r.failure()?.errorText ?? "" });
});
page.on("response", (r) => {
  if (r.status() >= 400 && r.url().includes("__virtual__")) {
    iframeFailedRequests.push({ url: r.url(), status: r.status() });
  }
});
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push({ origin: "pageerror", level: "error", text: e.message }));

try {
  log("phase", `navigating to ${URL}`);
  await page.goto(URL, { waitUntil: "networkidle", timeout: 15_000 });

  log("phase", `booting runtime + scaffolding ${test.name}`);
  await page.evaluate(async () => {
    const start = Date.now();
    while (!window.__piebox) {
      const tab = Array.from(document.querySelectorAll("button")).find(
        (b) => b.textContent?.trim() === "Preview"
      );
      if (tab) tab.click();
      await new Promise((r) => setTimeout(r, 100));
      if (Date.now() - start > 5000) throw new Error("runtime never booted");
    }
  });

  await page.evaluate(async (payload) => {
    const pb = window.__piebox;
    const fs = pb.fs;
    fs.mkdirSync("/work", { recursive: true });
    fs.writeFileSync("/work/package.json", JSON.stringify(payload.package, null, 2) + "\n");
    for (const [path, contents] of Object.entries(payload.files)) {
      const full = "/work/" + path;
      const dir = full.substring(0, full.lastIndexOf("/"));
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(full, contents);
    }
  }, { package: test.package, files: test.files });

  log("phase", `npm install (timeout=${NPM_TIMEOUT_MS}ms)`);
  const installRes = await page.evaluate(
    async (timeoutMs) => {
      const pb = window.__piebox;
      const t0 = Date.now();
      const r = await pb.runtime.run("npm install", { cwd: "/work" });
      return { exit: r.exitCode, ms: Date.now() - t0, stderr: r.stderr?.slice(0, 800) ?? "" };
    },
    NPM_TIMEOUT_MS
  );
  log("install", `exit=${installRes.exit} elapsed=${installRes.ms}ms`);
  if (installRes.exit !== 0) {
    summary(test.name, test.summary, "FAIL", {
      failReasons: [`npm install exit=${installRes.exit}`, installRes.stderr.replace(/\s+/g, " ").slice(0, 200)],
    });
    await browser.close();
    process.exit(1);
  }

  log("phase", `starting vite (timeout=${VITE_BOOT_TIMEOUT_MS}ms)`);
  await page.evaluate((timeoutMs) => {
    const pb = window.__piebox;
    pb.runtime
      .run("node ./node_modules/vite/bin/vite.js", { cwd: "/work" })
      .then(() => console.warn("[probe] vite exited unexpectedly"))
      .catch((e) => console.error("[probe] vite failed:", String(e)));
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      const tick = () => {
        const ports = pb.container?.serverBridge?.getServerPorts?.() ?? [];
        if (ports.length) return resolve(ports);
        if (Date.now() - t0 > timeoutMs) return reject(new Error(`no server-ready in ${timeoutMs}ms`));
        setTimeout(tick, 200);
      };
      tick();
    });
  }, VITE_BOOT_TIMEOUT_MS).catch((e) => {
    summary(test.name, test.summary, "FAIL", {
      failReasons: [`vite boot: ${e.message}`],
      errors: [...allConsole, ...pageErrors].slice(0, 10),
    });
    throw e;
  });

  const port = (await page.evaluate(() => window.__piebox.container.serverBridge.getServerPorts()))[0];
  log("phase", `vite bound on port ${port}; pre-warming dep optimizer`);

  // Warm Vite's dep-optimizer BEFORE the iframe loads. Without this,
  // there's a race: the iframe loads main.tsx, main.tsx imports
  // `node_modules/.vite/deps/react.js?v=<hashA>` (the hash baked into
  // the first transform), the optimizer re-runs to bundle the deps it
  // just discovered and bumps the version to <hashB> → the browser's
  // in-flight GET returns 504 "Outdated Optimize Dep". In real Vite,
  // the HMR WebSocket pushes a `full-reload` and the page restarts;
  // our bridge has no WS so the iframe stays stuck on the 504.
  //
  // Pre-warm by requesting the same path tree the iframe would: HTML,
  // then main.tsx (which triggers the optimizer to discover react etc.).
  // Then hold long enough for the optimizer to bake the FINAL hashes.
  // When the iframe loads, every dep URL is already stable.
  await page.evaluate(async (root) => {
    try { await fetch(root, { credentials: "same-origin" }); } catch {}
    try {
      const htmlR = await fetch(root, { credentials: "same-origin" });
      const html = await htmlR.text();
      // Find any /src/<file> script src in the HTML and fetch it too —
      // that triggers transform + optimizer for the entry.
      const re = /<script[^>]+src="([^"]+\.(?:tsx?|jsx?))"/g;
      const seen = new Set();
      let m;
      while ((m = re.exec(html))) {
        const src = m[1].startsWith("/") ? root.replace(/\/$/, "") + m[1] : m[1];
        if (seen.has(src)) continue;
        seen.add(src);
        try { await fetch(src, { credentials: "same-origin" }); } catch {}
      }
    } catch {}
  }, `/__virtual__/${port}/`);
  // Hold long enough for the optimizer to finalize all hashes after
  // discovering the entry's imports.
  await new Promise((r) => setTimeout(r, 4000));

  log("phase", `mounting iframe`);
  await page.evaluate((target) => {
    const old = document.getElementById("__probe_iframe__");
    if (old) old.remove();
    const f = document.createElement("iframe");
    f.id = "__probe_iframe__";
    f.src = target;
    f.style.cssText = "position:fixed;right:8px;bottom:8px;width:640px;height:480px;border:2px solid magenta;";
    document.body.appendChild(f);
  }, `/__virtual__/${port}/`);

  await page.waitForFunction(
    () => {
      const f = document.getElementById("__probe_iframe__");
      return f?.contentDocument?.readyState === "complete";
    },
    null,
    { timeout: 15_000 }
  );

  // Retry-reload loop. The dep-optimizer can bump hash versions
  // multiple times (once per "new dep discovered" wave); in real Vite
  // the HMR WebSocket pushes a full-reload that the browser picks up.
  // We don't have WS, so we manually reload the iframe and watch for
  // the 504 wave to stop. After up to N tries we accept whatever the
  // iframe holds and let the assertions decide PASS/FAIL.
  const MAX_RELOADS = 5;
  const RELOAD_DELAY_MS = 2500;
  for (let attempt = 1; attempt <= MAX_RELOADS; attempt++) {
    await new Promise((r) => setTimeout(r, RELOAD_DELAY_MS));
    const rendered = await page.evaluate(() => {
      const f = document.getElementById("__probe_iframe__");
      const root = f?.contentDocument?.getElementById("root");
      return (root?.children?.length ?? 0) > 0 || (root?.textContent ?? "").trim().length > 0;
    });
    if (rendered) {
      log("phase", `iframe rendered on attempt ${attempt}`);
      break;
    }
    if (attempt < MAX_RELOADS) {
      log("phase", `attempt ${attempt}: #root still empty, reloading iframe`);
      await page.evaluate(() => {
        const f = document.getElementById("__probe_iframe__");
        if (f) f.contentWindow?.location?.reload();
      });
      await page.waitForFunction(
        () => document.getElementById("__probe_iframe__")?.contentDocument?.readyState === "complete",
        null,
        { timeout: 10_000 }
      ).catch(() => {});
    }
  }
  log("phase", `holding ${SETTLE_MS}ms for final mount`);
  await new Promise((r) => setTimeout(r, SETTLE_MS));

  const inspection = await page.evaluate(() => {
    const f = document.getElementById("__probe_iframe__");
    const doc = f?.contentDocument;
    if (!doc) return { error: "no contentDocument" };
    const root = doc.getElementById("root");
    return {
      title: doc.title,
      rootChildren: root?.children?.length ?? 0,
      rootText: (root?.textContent ?? "").slice(0, 400),
      scripts: Array.from(doc.querySelectorAll("script[src]")).map((s) => s.getAttribute("src")),
    };
  });

  // Apply checks.
  const errors = [...allConsole.filter((c) => c.level === "error"), ...pageErrors];
  const rootRendered =
    (inspection.rootChildren ?? 0) > 0 ||
    (inspection.rootText ?? "").trim().length > 0;
  const matchesContains = (() => {
    if (!test.expect.rootContains) return true;
    const r = test.expect.rootContains;
    if (r instanceof RegExp) return r.test(inspection.rootText);
    return (inspection.rootText || "").includes(r);
  })();
  const customAssertions = test.expect.assertions ? test.expect.assertions(inspection) : [];
  // We treat the HMR WebSocket pageerror as advisory — it's a known
  // separate gap (Vite tries ws://localhost:undefined because the SW
  // bridge has no real port), doesn't block rendering. Same for the
  // related "WebSocket handshake 400" parent-page error.
  const ignorableNoise = (e) =>
    /WebSocket/.test(e.text) ||
    /HMR/.test(e.text) ||
    /handshake/.test(e.text);
  const fatalErrors = errors.filter((e) => !ignorableNoise(e));

  const checks = {
    "root rendered": rootRendered,
    "root content matches": matchesContains,
    "no fatal errors": fatalErrors.length === 0,
    "no custom assertion failures": customAssertions.length === 0,
  };
  const failReasons = [];
  if (!rootRendered) failReasons.push("#root is empty");
  if (!matchesContains)
    failReasons.push(`#root text didn't match expected: got ${JSON.stringify(inspection.rootText.slice(0, 80))}`);
  if (fatalErrors.length) failReasons.push(`${fatalErrors.length} fatal error(s)`);
  failReasons.push(...customAssertions);

  const status = failReasons.length === 0 ? "PASS" : "FAIL";
  // Include network failures in the report — they're often the smoking gun.
  const errorsWithNet = errors.slice(0, 10);
  if (iframeFailedRequests.length) {
    for (const f of iframeFailedRequests.slice(0, 8)) {
      errorsWithNet.push({
        origin: "net",
        level: "error",
        text: `${f.status ?? "ERR"} ${f.url}${f.err ? " (" + f.err + ")" : ""}`,
      });
    }
  }
  summary(test.name, test.summary, status, {
    iframe: inspection,
    errors: errorsWithNet,
    checks,
    failReasons,
  });

  await browser.close();
  process.exit(status === "PASS" ? 0 : 1);
} catch (e) {
  log("err", "script:", e.message);
  await browser.close();
  process.exit(2);
}
