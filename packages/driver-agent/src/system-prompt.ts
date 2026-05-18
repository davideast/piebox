/**
 * Default system-prompt builder.
 *
 * Templates the seven `RuntimeCapabilities` fields into prose the LLM
 * can act on. Callers can replace the whole thing via
 * `AgentDriverOptions.systemPromptBuilder`, or — more commonly —
 * append substrate-specific addenda (e.g. the playground's
 * almostnode quirks) by composing the default's output with their own.
 *
 * Kept ~30 lines on purpose: every line earns its place by templating
 * a single capability or restating a non-negotiable behavior rule. The
 * substrate-specific surface area (translators, devDeps backstop,
 * specific binary advice) belongs in a *second* prompt segment owned
 * by whoever knows the substrate — not in the driver core.
 */

import type { RuntimeCapabilities } from "piebox/layer2";

export function defaultSystemPromptBuilder(caps: RuntimeCapabilities): string {
  const bins =
    caps.availableBinaries.length > 0
      ? caps.availableBinaries.join(", ")
      : "(none — only sandbox shims)";

  const shimGuidance =
    caps.processModel === "shim"
      ? [
          "Process model: SHIM. `bash` runs through a bundled mini-shell.",
          "- `node -e '<code>'` is translated: code is written to a tempfile and executed.",
          "- `npm create <name>` / `npm init <name>` are translated to install + run-bin.",
          "- `npm install` only honors `dependencies` (NOT `devDependencies`). Put everything in `dependencies`.",
          "- No `npx`, no `git` binary (use git_* tools if available), no `python`, no `make`, no `curl`.",
        ].join("\n")
      : [
          "Process model: REAL. `bash` spawns host OS processes.",
          "- Real PATH lookup, real fork/exec. npm/node/git behave as on a developer machine.",
        ].join("\n");

  const netLine = caps.realNetwork
    ? "Network: real TCP/UDP available. `fetch`, custom protocols, raw sockets all work."
    : "Network: NO raw sockets. Only `fetch()` over the host bridge. No postgres/redis/mongo clients.";

  const persistLine =
    caps.persistence === "durable"
      ? "Filesystem persists across restarts."
      : "Filesystem is session-scoped — state is lost on tab close / process exit.";

  return [
    "You are a coding agent operating inside a piebox sandbox.",
    `Filesystem: ${caps.fileSystem === "vfs" ? "in-memory virtual" : "real host disk"}. ${persistLine}`,
    shimGuidance,
    netLine,
    `Native addons: ${caps.nativeAddons ? "available" : "NOT available — use pure-JS alternatives"}.`,
    `Interactive TTY: ${caps.interactiveTty ? "emulated (vim/top/REPLs work)" : "not emulated — programs needing a TTY will fail"}.`,
    `Available host binaries: ${bins}.`,
    "",
    "Use the provided tools. One tool call per turn until you've seen the result.",
    "After every bash call, READ the result. Non-zero exit, 'Error:', 'command not found',",
    "'Cannot find module', 'SyntaxError', 'AssertionError' all mean FAILURE — do not declare success.",
    "Never fabricate tool output. The host UI shows real outputs side-by-side with your claims.",
  ].join("\n");
}
