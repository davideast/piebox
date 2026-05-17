/**
 * Probe the multi-turn chat surface without spending a Gemini call.
 *
 *   1. Render the page.
 *   2. Confirm the "New chat" button is in the DOM.
 *   3. Drive the chat store directly to simulate a completed turn that
 *      includes tool calls + results.
 *   4. Validate `toSdkHistory()` returns a shape the SDK can replay —
 *      user message → assistant message with argsJson + resultJson on
 *      each toolCall. This is the bit that makes multi-turn actually
 *      *remember* what the agent did in earlier turns (the SDK's
 *      session.js drops tool calls when it appends the assistant
 *      message to its internal history, so we thread our own).
 *   5. Click "New chat" and confirm chat + terminal + session counters
 *      all reset to empty.
 *
 * Exits 0 on PASS, 1 on any failure. Usage:
 *   PROBE_URL=http://localhost:5174/ node scripts/probe-multi-turn.mjs
 */
import { chromium } from "playwright";

const URL = process.env.PROBE_URL ?? "http://localhost:5173/";

const failures = [];
function check(label, cond, detail) {
  if (cond) {
    console.log(`  PASS  ${label}`);
  } else {
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
    failures.push(label);
  }
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log(`[pageerror] ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") console.log(`[console.error] ${m.text().slice(0, 200)}`);
});

try {
  console.log(`# probe-multi-turn → ${URL}`);
  await page.goto(URL, { waitUntil: "networkidle", timeout: 15_000 });

  // The test seam is mounted synchronously in main.tsx, so this should
  // be set before the page goes idle.
  await page.waitForFunction(() => !!window.__piebox_test, null, { timeout: 5_000 });

  // 1. New-chat button present.
  const btnPresent = await page.evaluate(() =>
    !!document.querySelector('[data-testid="new-chat"]')
  );
  check("new-chat button rendered in TopBar", btnPresent);

  // 2. Seed the chat store with a fake completed turn: user prompt +
  // assistant reply + a successful bash tool call.
  await page.evaluate(() => {
    const chat = window.__piebox_test.stores.chat.getState();
    const term = window.__piebox_test.stores.terminal.getState();
    const sess = window.__piebox_test.stores.session.getState();
    chat.reset();
    term.clear();
    sess.reset();
    chat.append({
      id: "u-1",
      role: "user",
      text: "Write /work/note.txt with content 'banana'",
      createdAt: 1_000_000,
    });
    chat.append({
      id: "a-1",
      role: "assistant",
      text: "Done. I wrote the file.",
      createdAt: 1_000_001,
    });
    chat.upsertToolCall("a-1", {
      id: "call-1",
      name: "write",
      args: { path: "/work/note.txt", content: "banana" },
      status: "ok",
      summary: "wrote /work/note.txt (6 bytes)",
      result: { ok: true },
    });
    chat.setMetrics("a-1", { tokensIn: 42, tokensOut: 18 });
  });

  // 3. Convert + validate the SDK shape.
  const history = await page.evaluate(() => {
    const messages = window.__piebox_test.stores.chat.getState().messages;
    return window.__piebox_test.toSdkHistory(messages);
  });
  check("history has 2 entries (user + assistant)", history.length === 2, `got ${history.length}`);
  check("history[0] is user", history[0]?.role === "user", `got ${history[0]?.role}`);
  check(
    "history[0].text preserved",
    history[0]?.text === "Write /work/note.txt with content 'banana'",
    JSON.stringify(history[0]?.text)?.slice(0, 80),
  );
  check("history[1] is assistant", history[1]?.role === "assistant");
  check(
    "history[1] has one toolCall",
    Array.isArray(history[1]?.toolCalls) && history[1].toolCalls.length === 1,
    `got ${history[1]?.toolCalls?.length}`,
  );
  const tc = history[1]?.toolCalls?.[0];
  check("toolCall.name is 'write'", tc?.name === "write");
  check("toolCall.argsJson is a JSON string", typeof tc?.argsJson === "string");
  let parsedArgs;
  try { parsedArgs = JSON.parse(tc?.argsJson ?? ""); } catch {}
  check(
    "toolCall.argsJson encodes path + content",
    parsedArgs?.path === "/work/note.txt" && parsedArgs?.content === "banana",
    `parsedArgs=${JSON.stringify(parsedArgs)?.slice(0, 120)}`,
  );
  check("toolCall.resultJson present", typeof tc?.resultJson === "string");
  let parsedResult;
  try { parsedResult = JSON.parse(tc?.resultJson ?? ""); } catch {}
  check(
    "toolCall.resultJson encodes ok + summary (so model recalls outcome)",
    parsedResult?.ok === true && /wrote/.test(parsedResult?.summary ?? ""),
    JSON.stringify(parsedResult)?.slice(0, 160),
  );
  check("toolCall.ok mirrors success", tc?.ok === true);

  // 4. Activity tab renders the seeded turn (chat store -> UI).
  await page.evaluate(() => {
    // Switch to Activity tab to be safe (it's the default; harmless).
    const btn = Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Activity",
    );
    if (btn) btn.click();
  });
  const visiblePrompt = await page.evaluate(
    () => document.body.textContent?.includes("Write /work/note.txt with content"),
  );
  check("Activity tab shows the seeded user prompt", visiblePrompt === true);

  // 5. Click "New chat" and confirm state cleared.
  await page.click('[data-testid="new-chat"]');
  const afterReset = await page.evaluate(() => {
    const messages = window.__piebox_test.stores.chat.getState().messages;
    const lines = window.__piebox_test.stores.terminal.getState().lines;
    const sess = window.__piebox_test.stores.session.getState();
    return {
      messages: messages.length,
      lines: lines.length,
      turns: sess.turns,
      tokensTotal: sess.tokensTotal,
      error: sess.error,
    };
  });
  check("chat cleared", afterReset.messages === 0, `got ${afterReset.messages}`);
  check("terminal cleared", afterReset.lines === 0, `got ${afterReset.lines}`);
  check("session counters reset", afterReset.turns === 0 && afterReset.tokensTotal === 0);
  check("error cleared", afterReset.error === null);

  // 6. Empty-state visible in Activity tab.
  await new Promise((r) => setTimeout(r, 200));
  const emptyState = await page.evaluate(
    () => document.body.textContent?.includes("No actions yet"),
  );
  check("Activity tab falls back to EmptyState", emptyState === true);

  // 7. Compose-bar phase behavior: Stop button only shows during LLM
  //    phase. During tool phase, a quieter "Running tool…" pill takes
  //    its place. Drive the session store directly to simulate each
  //    phase without spending an LLM call.
  await page.evaluate(() => {
    const sess = window.__piebox_test.stores.session.getState();
    sess.setSending(true);
    sess.setPhase("llm");
  });
  await new Promise((r) => setTimeout(r, 100));
  const stopVisibleLlm = await page.evaluate(
    () => !!document.querySelector('[data-testid="stop-button"]'),
  );
  const toolBusyHiddenLlm = await page.evaluate(
    () => !document.querySelector('[data-testid="tool-busy"]'),
  );
  check("phase=llm shows Stop button", stopVisibleLlm);
  check("phase=llm hides 'Running tool…' pill", toolBusyHiddenLlm);

  await page.evaluate(() => {
    window.__piebox_test.stores.session.getState().setPhase("tool");
  });
  await new Promise((r) => setTimeout(r, 100));
  const stopHiddenTool = await page.evaluate(
    () => !document.querySelector('[data-testid="stop-button"]'),
  );
  const toolBusyVisibleTool = await page.evaluate(
    () => !!document.querySelector('[data-testid="tool-busy"]'),
  );
  check("phase=tool hides Stop button (Stop is LLM-only)", stopHiddenTool);
  check("phase=tool shows 'Running tool…' pill", toolBusyVisibleTool);

  await page.evaluate(() => {
    const sess = window.__piebox_test.stores.session.getState();
    sess.setSending(false);
    sess.setPhase("idle");
  });
  await new Promise((r) => setTimeout(r, 100));
  const stopHiddenIdle = await page.evaluate(
    () => !document.querySelector('[data-testid="stop-button"]'),
  );
  const toolBusyHiddenIdle = await page.evaluate(
    () => !document.querySelector('[data-testid="tool-busy"]'),
  );
  check("phase=idle hides both Stop and tool-busy", stopHiddenIdle && toolBusyHiddenIdle);

  console.log("");
  if (failures.length === 0) {
    console.log("## probe-multi-turn — PASS");
    await browser.close();
    process.exit(0);
  } else {
    console.log(`## probe-multi-turn — FAIL (${failures.length})`);
    for (const f of failures) console.log(`  - ${f}`);
    await browser.close();
    process.exit(1);
  }
} catch (e) {
  console.log("[err]", e.message);
  await browser.close();
  process.exit(2);
}
