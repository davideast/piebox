/**
 * Drive the interactive Shell tab end-to-end. No Gemini calls — this
 * just exercises the substrate so we know the tab boots, accepts input,
 * forwards to runtime.run + isomorphic-git, and prints results back.
 *
 * Coverage:
 *   1. Shell tab renders and accepts focus.
 *   2. Builtins: pwd, cd, help.
 *   3. Forwarded commands: ls /work (almostnode just-bash).
 *   4. Git shim: git init, git status (empty), git status -s after
 *      writing a file via the VFS.
 *   5. History: typing a command then pressing up arrow recalls it.
 *   6. Ctrl+L clears.
 *
 * Usage:
 *   PROBE_URL=http://localhost:5175/ node scripts/probe-shell-tab.mjs
 */
import { chromium } from "playwright";

const URL = process.env.PROBE_URL ?? "http://localhost:5173/";
const failures = [];
function check(label, cond, detail) {
  if (cond) console.log(`  PASS  ${label}`);
  else {
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
    failures.push(label);
  }
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") console.log(`[console.error] ${m.text().slice(0, 300)}`);
});

try {
  console.log(`# probe-shell-tab → ${URL}`);
  await page.goto(URL, { waitUntil: "networkidle", timeout: 15_000 });
  // Test seam from main.tsx — used to wait for almostnode boot.
  await page.waitForFunction(() => !!window.__piebox_test, null, { timeout: 5_000 });

  // 1. Switch to the interactive Terminal tab (xterm.js). The
  // read-only log stream lives under the "Logs" tab now — see
  // PlaygroundPage.tsx rightTabs.
  await page.evaluate(() => {
    const btn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Terminal",
    );
    if (!btn) throw new Error("Terminal tab button missing");
    btn.click();
  });
  // xterm.js needs a frame to mount.
  await page.waitForSelector('[data-testid="shell-host"]', { timeout: 5_000 });
  await new Promise((r) => setTimeout(r, 500));

  // Boot almostnode by reading the runtime store (ShellSession calls
  // getRuntime() which is lazy). The shell mounts and triggers boot.
  // Allow up to ten seconds for the substrate to be ready.
  await page.waitForFunction(() => !!window.__piebox, null, { timeout: 15_000 });
  await new Promise((r) => setTimeout(r, 1500));
  check("Shell tab mounted and almostnode booted", true);

  // Helper: type a command into xterm and press enter. Simulates a
  // real-user interaction — click on the terminal area, then type.
  // No explicit textarea focus: if the wrapper's onMouseDown handler
  // and term.focus() on mount don't do their job, this probe catches
  // the regression.
  async function type(text) {
    await page.click('[data-testid="shell-host"]');
    const focused = await page.evaluate(() => document.activeElement?.tagName);
    if (focused !== "TEXTAREA") throw new Error(`expected TEXTAREA focused, got ${focused}`);
    await page.keyboard.type(text);
  }
  async function enter() {
    await page.keyboard.press("Enter");
  }
  async function ctrlL() {
    await page.keyboard.press("Control+L");
  }
  async function arrowUp() {
    await page.keyboard.press("ArrowUp");
  }

  // Snapshot the rendered terminal buffer text (concatenation of all
  // visible lines via xterm's Buffer API exposed on the DOM as text).
  async function shellText() {
    // xterm injects <style> rules into its host; reading host.textContent
    // pulls those rules in. Read only the rendered row divs, which live
    // under .xterm-rows.
    return await page.evaluate(() => {
      const rows = document.querySelector('[data-testid="shell-host"] .xterm-rows');
      if (!rows) return "";
      return Array.from(rows.children).map((r) => r.textContent ?? "").join("\n");
    });
  }

  // 2. Builtins — pwd.
  await type("pwd");
  await enter();
  await new Promise((r) => setTimeout(r, 200));
  let txt = await shellText();
  check("pwd prints /work", txt.includes("/work"), txt.slice(-120));

  // 2b. help — surfaces substrate notes.
  await type("help");
  await enter();
  await new Promise((r) => setTimeout(r, 200));
  txt = await shellText();
  check("help mentions substrate", txt.includes("Substrate notes"), txt.slice(-200));

  // 3. Forwarded command — ls. Almostnode boots an empty /work; this
  // mostly proves the round-trip works without crashing.
  await type("ls");
  await enter();
  await new Promise((r) => setTimeout(r, 1500));
  txt = await shellText();
  check("ls command returns to prompt", /\$\s*$/.test(txt) || txt.includes("/work"), txt.slice(-200));

  // 4. Git shim — init + status -s.
  await type("git init");
  await enter();
  await new Promise((r) => setTimeout(r, 1500));
  txt = await shellText();
  check("git init prints initialized message", /Initialized.*Git repository/i.test(txt), txt.slice(-200));

  // Drop a tracked file via the test seam so status has something to
  // report. ShellSession's cwd state is private; the VFS write is fine
  // because we just need *some* dirty-tree signal.
  await page.evaluate(() => {
    window.__piebox.fs.writeFileSync("/work/hello.txt", "hi");
  });
  await type("git status -s");
  await enter();
  await new Promise((r) => setTimeout(r, 1500));
  txt = await shellText();
  check("git status -s shows untracked hello.txt", /\?\?\s+hello\.txt/.test(txt), txt.slice(-200));

  // 5. History recall.
  await type("pwd");
  await enter();
  await new Promise((r) => setTimeout(r, 200));
  await arrowUp();
  await new Promise((r) => setTimeout(r, 100));
  txt = await shellText();
  // After up-arrow, the buffer should contain "pwd" again (visible
  // after the most recent prompt). Looser check: the live line ends
  // with "pwd".
  check("up arrow recalls last command", /\$\s+pwd\s*$/.test(txt.trimEnd()), txt.slice(-200));

  // 6. Ctrl+L clears.
  await ctrlL();
  await new Promise((r) => setTimeout(r, 200));
  const clearedRows = await page.evaluate(() => {
    const rows = document.querySelector('[data-testid="shell-host"] .xterm-rows');
    if (!rows) return 9999;
    // Count rows with any non-whitespace content. After Ctrl+L only
    // the active prompt line should have visible chars.
    return Array.from(rows.children).filter((r) => (r.textContent ?? "").trim().length > 0).length;
  });
  check("Ctrl+L clears most of the screen", clearedRows <= 1, `non-empty rows=${clearedRows}`);

  // 7. Shell-driven FS mutations bump the VFS revision counter so
  //    EditorPane's file tree re-walks without a manual refresh click.
  //    Prior steps left a recalled "pwd" in the buffer (from the up-
  //    arrow test); Ctrl+C clears it before we type the next command.
  await page.keyboard.press("Control+C");
  await new Promise((r) => setTimeout(r, 100));

  const startTick = await page.evaluate(() => window.__piebox_test.stores.vfs?.getState().revision ?? null);
  if (startTick !== null) {
    await type("mkdir notebook");
    await enter();
    await new Promise((r) => setTimeout(r, 800));
    const endTick = await page.evaluate(() => window.__piebox_test.stores.vfs.getState().revision);
    check("VFS revision bumped after `mkdir notebook`", endTick > startTick, `start=${startTick} end=${endTick}`);

    const dirExists = await page.evaluate(() =>
      window.__piebox.fs.existsSync("/work/notebook"),
    );
    check("/work/notebook actually created by shell", dirExists === true);
  } else {
    check("VFS revision store exposed via test seam", false, "stores.vfs is undefined");
  }

  console.log("");
  if (failures.length === 0) {
    console.log("## probe-shell-tab — PASS");
    await browser.close();
    process.exit(0);
  } else {
    console.log(`## probe-shell-tab — FAIL (${failures.length})`);
    for (const f of failures) console.log(`  - ${f}`);
    await browser.close();
    process.exit(1);
  }
} catch (e) {
  console.log("[err]", e.message);
  await browser.close();
  process.exit(2);
}
