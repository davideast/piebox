/**
 * `git` argv shim — routes user-typed `git <subcommand>` commands into
 * isomorphic-git over the same PieboxFS the agent uses.
 *
 * Almostnode does not ship a `git` binary, so without this shim the
 * Shell tab's user would hit "git: command not found" for the most
 * common operations even though piebox already has isomorphic-git
 * wired up.
 *
 * Supported subset (MVP):
 *   init [-b <branch>] [--initial-branch=<branch>]
 *   status [-s|--short]
 *   add <pathspec...> | -A | --all | .
 *   commit -m "<message>"
 *   log [--oneline] [-n <count> | --max-count=<count> | -<count>]
 *   branch [<name>] [-a] [--show-current]
 *   checkout <branch> | -b <branch>
 *
 * Out of scope: diff, remote, push, pull, clone, merge, rebase, tag,
 * config, stash, reset, restore, blame. Anything not recognized falls
 * through to a "(piebox git shim) subcommand not supported" stderr line
 * so the user knows it wasn't silently ignored.
 */

import {
  gitInit,
  gitStatus,
  gitAdd,
  gitAddAll,
  gitCommit,
  gitLog,
  gitBranch,
  gitListBranches,
  gitCurrentBranch,
  makeGitFs,
  withBufferSwap,
} from "../git.js";
import isoGit from "isomorphic-git";
import type { RunCtx, RunResult } from "./translators.js";

/** Parse a command line into argv. Handles double- and single-quoted
 *  segments (so `commit -m "hello world"` parses cleanly). Backslash
 *  escapes are intentionally NOT supported — keep it simple, the agent
 *  and the user are both well-served by quoting. */
export function tokenize(cmd: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < cmd.length) {
    while (i < cmd.length && /\s/.test(cmd[i]!)) i++;
    if (i >= cmd.length) break;
    let token = "";
    while (i < cmd.length && !/\s/.test(cmd[i]!)) {
      const c = cmd[i]!;
      if (c === '"' || c === "'") {
        const quote = c;
        i++;
        while (i < cmd.length && cmd[i] !== quote) {
          token += cmd[i]!;
          i++;
        }
        i++; // closing quote
      } else {
        token += c;
        i++;
      }
    }
    out.push(token);
  }
  return out;
}

/** Returns a RunResult if the command was a recognized git subcommand,
 *  null otherwise. */
export async function tryGitArgv(cmd: string, ctx: RunCtx): Promise<RunResult | null> {
  const argv = tokenize(cmd.trim());
  if (argv.length === 0 || argv[0] !== "git") return null;
  if (argv.length === 1) {
    return { stdout: "", stderr: "(piebox git shim) usage: git <subcommand> [args]\n", exitCode: 129 };
  }

  const sub = argv[1]!;
  const rest = argv.slice(2);
  const gitCtx = { fs: ctx.fs, dir: ctx.cwd };

  try {
    switch (sub) {
      case "init": {
        let branch = "main";
        for (let i = 0; i < rest.length; i++) {
          if (rest[i] === "-b" && rest[i + 1]) {
            branch = rest[i + 1]!;
            i++;
          } else if (rest[i]!.startsWith("--initial-branch=")) {
            branch = rest[i]!.slice("--initial-branch=".length);
          }
        }
        await gitInit(gitCtx, branch);
        return ok(`Initialized empty Git repository in ${ctx.cwd}/.git/ (branch ${branch})`, ctx);
      }

      case "status": {
        const short = rest.includes("-s") || rest.includes("--short");
        const changes = await gitStatus(gitCtx);
        const current = await gitCurrentBranch(gitCtx);
        if (short) {
          if (changes.length === 0) return ok("", ctx);
          const out = changes
            .map((c) => `${shortCode(c.status)} ${c.path}`)
            .join("\n");
          return ok(out + "\n", ctx);
        }
        const lines: string[] = [];
        lines.push(`On branch ${current ?? "(detached)"}`);
        if (changes.length === 0) {
          lines.push("nothing to commit, working tree clean");
        } else {
          const staged = changes.filter((c) => /staged|added/.test(c.status));
          const unstaged = changes.filter((c) => !/staged|added/.test(c.status));
          if (staged.length) {
            lines.push("Changes to be committed:");
            for (const c of staged) lines.push(`  ${c.status}:\t${c.path}`);
          }
          if (unstaged.length) {
            lines.push("Changes not staged for commit:");
            for (const c of unstaged) lines.push(`  ${c.status}:\t${c.path}`);
          }
        }
        return ok(lines.join("\n") + "\n", ctx);
      }

      case "add": {
        if (rest.length === 0) {
          return fail("Nothing specified, nothing added.\nhint: Maybe you wanted to say 'git add .'?\n", ctx, 1);
        }
        if (rest.includes("-A") || rest.includes("--all") || rest.includes(".")) {
          const touched = await gitAddAll(gitCtx);
          return ok(touched.length === 0 ? "" : `(piebox git shim) staged ${touched.length} file(s)\n`, ctx);
        }
        for (const path of rest) {
          const rel = path.startsWith(ctx.cwd + "/") ? path.slice(ctx.cwd.length + 1) : path;
          await gitAdd(gitCtx, rel);
        }
        return ok("", ctx);
      }

      case "commit": {
        let message: string | null = null;
        for (let i = 0; i < rest.length; i++) {
          if (rest[i] === "-m" && rest[i + 1]) {
            message = rest[i + 1]!;
            i++;
          } else if (rest[i]!.startsWith("--message=")) {
            message = rest[i]!.slice("--message=".length);
          }
        }
        if (!message) {
          return fail(
            '(piebox git shim) git commit requires -m "<message>" — interactive editor not supported in the sandbox\n',
            ctx,
            129,
          );
        }
        const sha = await gitCommit(gitCtx, message);
        const branch = await gitCurrentBranch(gitCtx);
        return ok(`[${branch ?? "(detached)"} ${sha.slice(0, 7)}] ${message}\n`, ctx);
      }

      case "log": {
        const oneline = rest.includes("--oneline");
        let depth = 10;
        for (let i = 0; i < rest.length; i++) {
          const a = rest[i]!;
          if (a === "-n" && rest[i + 1]) {
            depth = Number(rest[i + 1]) || 10;
            i++;
          } else if (a.startsWith("--max-count=")) {
            depth = Number(a.slice("--max-count=".length)) || 10;
          } else if (/^-\d+$/.test(a)) {
            depth = Number(a.slice(1));
          }
        }
        const entries = await gitLog(gitCtx, depth);
        if (entries.length === 0) return ok("(no commits yet)\n", ctx);
        if (oneline) {
          return ok(entries.map((e) => `${e.oid.slice(0, 7)} ${e.message}`).join("\n") + "\n", ctx);
        }
        const out = entries
          .map((e) => `commit ${e.oid}\nAuthor: ${e.author}\n\n    ${e.message}\n`)
          .join("\n");
        return ok(out, ctx);
      }

      case "branch": {
        if (rest.includes("--show-current")) {
          const b = await gitCurrentBranch(gitCtx);
          return ok((b ?? "") + "\n", ctx);
        }
        if (rest.length === 0 || (rest.length === 1 && (rest[0] === "-a" || rest[0] === "--list"))) {
          const list = await gitListBranches(gitCtx);
          const current = await gitCurrentBranch(gitCtx);
          const out = list.map((b) => `${b === current ? "* " : "  "}${b}`).join("\n");
          return ok(out + "\n", ctx);
        }
        // Otherwise treat the first non-flag arg as the new branch name.
        const name = rest.find((a) => !a.startsWith("-"));
        if (!name) return fail("(piebox git shim) git branch: missing branch name\n", ctx, 129);
        await gitBranch(gitCtx, name, false);
        return ok("", ctx);
      }

      case "checkout": {
        // `git checkout -b <name>` → create + switch.
        const bIdx = rest.indexOf("-b");
        if (bIdx >= 0 && rest[bIdx + 1]) {
          const name = rest[bIdx + 1]!;
          await gitBranch(gitCtx, name, true);
          return ok(`Switched to a new branch '${name}'\n`, ctx);
        }
        const target = rest[0];
        if (!target) return fail("(piebox git shim) git checkout: missing branch name\n", ctx, 129);
        // Use isomorphic-git directly for checkout — git.ts doesn't expose it.
        const gitFs = makeGitFs(ctx.fs);
        await withBufferSwap(() =>
          isoGit.checkout({ fs: gitFs as unknown as any, dir: ctx.cwd, ref: target }),
        );
        return ok(`Switched to branch '${target}'\n`, ctx);
      }

      default:
        return fail(
          `(piebox git shim) subcommand '${sub}' not supported. Supported: init, status, add, commit, log, branch, checkout.\n`,
          ctx,
          129,
        );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return fail(`(piebox git shim) ${sub} failed: ${msg}\n`, ctx, 1);
  }
}

function ok(text: string, ctx: RunCtx): RunResult {
  if (text) ctx.onStdout?.(text);
  return { stdout: text, stderr: "", exitCode: 0 };
}

function fail(text: string, ctx: RunCtx, exitCode: number): RunResult {
  if (text) ctx.onStderr?.(text);
  return { stdout: "", stderr: text, exitCode };
}

/** Map our internal status names to short porcelain codes. */
function shortCode(status: string): string {
  if (status === "untracked") return "??";
  if (status === "added") return "A ";
  if (status === "deleted") return " D";
  if (status === "modified (staged)") return "M ";
  if (status === "modified") return " M";
  return "  ";
}
