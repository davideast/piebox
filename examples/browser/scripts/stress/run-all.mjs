/**
 * Drive T2..T10 (T1 already validated). For each test:
 *   - shell out to run-one.mjs
 *   - capture its full stdout
 *   - print the summary block (already structured by run-one)
 *   - track pass/fail totals
 *
 * On exit prints a tabular summary across all tests. Doesn't auto-fix
 * (Gap fixes go through the fork's branch convention by hand) — its
 * purpose is to surface failures in a form that's easy to triage.
 */
import { spawnSync } from "node:child_process";

const TESTS = [
  "T1-vanilla",
  "T2-tailwind3",
  "T3-cssmodules",
  "T4-router-lazy",
  "T5-asset-queries",
  "T6-lucide",
  "T7-zustand",
  "T8-ts-aliases",
  "T9-tailwind-extended",
  "T10-glob-json",
];

const ONLY = process.argv.slice(2);
const toRun = ONLY.length > 0 ? TESTS.filter((t) => ONLY.includes(t)) : TESTS;

const results = [];
for (const name of toRun) {
  process.stdout.write(`\n══════════════════════════════════════════════════════════\n`);
  process.stdout.write(`▶  ${name}\n`);
  process.stdout.write(`══════════════════════════════════════════════════════════\n`);
  const t0 = Date.now();
  const r = spawnSync("node", ["scripts/stress/run-one.mjs", name], {
    encoding: "utf8",
    timeout: 8 * 60_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const elapsed = Date.now() - t0;
  const stdout = r.stdout ?? "";
  const stderr = r.stderr ?? "";
  process.stdout.write(stdout);
  if (stderr) process.stdout.write(stderr);

  // The summary block from run-one starts with `## <name> — `. Extract it.
  const summaryMatch = stdout.match(/## .+/);
  const summaryLine = summaryMatch ? summaryMatch[0] : "(no summary block)";
  const status = stdout.includes(" — PASS") ? "PASS" : stdout.includes(" — FAIL") ? "FAIL" : "ERR";
  results.push({ name, status, summary: summaryLine, elapsedMs: elapsed, exit: r.status ?? -1 });
}

process.stdout.write("\n\n══════════════════════════════════════════════════════════\n");
process.stdout.write("FINAL TALLY\n");
process.stdout.write("══════════════════════════════════════════════════════════\n");
for (const r of results) {
  const icon = r.status === "PASS" ? "✅" : r.status === "FAIL" ? "❌" : "💥";
  process.stdout.write(`${icon} ${r.name.padEnd(22)} ${r.status.padEnd(5)} ${(r.elapsedMs / 1000).toFixed(1)}s  (exit=${r.exit})\n`);
}
const pass = results.filter((r) => r.status === "PASS").length;
process.stdout.write(`\n${pass}/${results.length} passed\n`);
process.exit(pass === results.length ? 0 : 1);
