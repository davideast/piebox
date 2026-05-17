import { chromium } from "playwright";
const b = await chromium.launch({ headless: true });
const ctx = await b.newContext();
const p = await ctx.newPage();

const cons = [];
p.on("console", (m) => cons.push(`[${m.type()}] ${m.text().slice(0, 300)}`));
p.on("pageerror", (e) => cons.push(`[pageerror] ${e.message}`));

await p.goto("http://localhost:5173/", { waitUntil: "networkidle", timeout: 15_000 });

// Probe state via the exposed __piebox global
const state = await p.evaluate(async () => {
  const pb = window.__piebox;
  const out = { hasPiebox: !!pb };
  // SW registration check
  if (navigator.serviceWorker) {
    const regs = await navigator.serviceWorker.getRegistrations();
    out.swRegistrations = regs.map((r) => ({
      scope: r.scope,
      active: !!r.active,
      activeUrl: r.active?.scriptURL,
      controllerActive: !!navigator.serviceWorker.controller,
      controllerUrl: navigator.serviceWorker.controller?.scriptURL,
    }));
  }
  // Try fetching __virtual__ URL from the page context (so SW would intercept if active)
  try {
    const r = await fetch("/__virtual__/5173/", { redirect: "follow" });
    out.virtualFetch = {
      status: r.status,
      ctype: r.headers.get("content-type"),
      first200: (await r.text()).slice(0, 200),
    };
  } catch (e) {
    out.virtualFetchError = String(e);
  }
  return out;
});
console.log(JSON.stringify(state, null, 2));
console.log("---console---");
for (const c of cons) console.log(c);
await b.close();
