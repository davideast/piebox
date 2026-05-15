# piebox

Lightweight in-memory sandbox environment for agent execution.

```ts
import { sandbox } from "piebox";
import { getModel } from "@earendil-works/pi-ai";

const sb = sandbox();
await sb.clone({ url: "https://github.com/user/repo" });

const session = await sb.createSession({
  model: getModel("google", "gemini-3-flash-preview"),
});

await session.prompt("Add error handling to src/");

const changed = await sb.git.modifiedFiles();
console.log("Agent modified:", changed);
```

## Install

```bash
npm install piebox
```

> Requires Node.js >= 22 (`@platformatic/vfs` uses `node:sqlite`).

## API

### `sandbox(options?)`

Creates a sandbox — a composable, in-memory execution environment.

```ts
const sb = sandbox();
```

Returns a `SandboxInstance` with:

| Property | Type | Description |
|---|---|---|
| `sb.fs` | `VirtualFileSystem` | node:fs-compatible in-memory filesystem |
| `sb.shell` | `Bash` | Shell interpreter (same filesystem) |
| `sb.git` | `GitUtilities \| null` | Git utilities (populated after `clone()`) |
| `sb.cwd` | `string` | Virtual working directory (default: `/sandbox`) |
| `sb.clone(opts)` | `Promise<void>` | Clone a git repo into the sandbox |
| `sb.createSession(opts)` | `Promise<AgentSession>` | Create an agent session |

### Options

```ts
sandbox({
  cwd: "/workspace",        // default: "/sandbox"
  vfs: myPreConfiguredVFS,  // default: new VFS
  bashOptions: {            // just-bash options
    python: true,
    executionLimits: { maxCommandCount: 200 },
  },
});
```

## Usage

### Clone a repo, run an agent, inspect changes

```ts
const sb = sandbox();
await sb.clone({ url: "https://github.com/user/repo" });

const session = await sb.createSession({ model });
await session.prompt("Fix the bug in src/utils.ts");

const modified = await sb.git.modifiedFiles();
const branch = await sb.git.currentBranch();
```

### Seed files manually

```ts
const sb = sandbox();
sb.fs.writeFileSync("/sandbox/README.md", "# My Project\n");
sb.fs.mkdirSync("/sandbox/src", { recursive: true });
sb.fs.writeFileSync("/sandbox/src/index.ts", code);

const session = await sb.createSession({ model });
```

### Clone, then augment

```ts
const sb = sandbox();
await sb.clone({ url: "https://github.com/user/repo" });

// Add extra context for the agent
sb.fs.writeFileSync("/sandbox/INSTRUCTIONS.md", "Focus on error handling.");

const session = await sb.createSession({ model });
```

### Skills

Skills are auto-discovered from `{cwd}/.agents/skills/` in the VFS at `createSession()` time.

```ts
// If the cloned repo has .agents/skills/*, they're auto-discovered
const session = await sb.createSession({ model });

// Explicit skills override auto-discovery
const session = await sb.createSession({ model, skills: mySkills });

// Disable skills
const session = await sb.createSession({ model, skills: [] });
```

### Git operations (after clone)

```ts
await sb.git.modifiedFiles()       // files the agent changed
await sb.git.statusMatrix()        // full HEAD vs workdir vs index
await sb.git.currentBranch()       // current branch name
await sb.git.log(5)                // last 5 commits
await sb.git.add("src/index.ts")   // stage a file
await sb.git.addAll()              // stage all modified files
await sb.git.commit("fix: msg")    // commit staged changes
await sb.git.branch("feat/x")     // create and checkout a branch
await sb.git.listBranches()        // list all branches
```

## CLI

A command-line interface for running agents in sandboxes without writing code.

```bash
npx piebox run "Add error handling to src/" --url https://github.com/user/repo
```

### Commands

| Command | Description |
|---|---|
| `piebox run "<prompt>"` | Run a prompt in a sandbox |
| `piebox clone <url>` | Clone a repo into a sandbox |
| `piebox commit -s <name>` | Commit changes in the sandbox |
| `piebox export -s <name> --out ./dir` | Write sandbox files to disk |
| `piebox diff -s <name>` | Show what changed |
| `piebox sandbox list` | List all sandboxes |
| `piebox sandbox destroy <name>` | Destroy a sandbox |

### `piebox run`

The primary command. Creates a sandbox, runs an agent, and reports what changed.

```bash
# Basic usage
piebox run "Create a fibonacci function in fib.ts"

# Clone a repo first, then prompt
piebox run "Fix the bug in utils.ts" --url https://github.com/user/repo

# Seed from a local directory
piebox run "Add tests" --dir ./my-project

# Use a specific model
piebox run "Refactor auth" -m gemini-3-flash-preview

# Name the sandbox for later
piebox run "Add validation" -s my-sandbox

# Continue working on an existing sandbox
piebox run "Now add tests for the validation" -s my-sandbox
```

### Streaming output

Every run streams activity to the terminal and writes a markdown session log.

**Default** — file mutations only:

```
🤖 Prompting gemini-3-flash-preview...
  + fib.ts
  + fib.test.ts

────────────────────────────────────────
✓ 4.4s · 2 new · 0 modified · 2 tool calls
```

**Verbose** (`-v`) — includes bash commands, thinking, file listings:

```
🤖 Prompting gemini-3-flash-preview...
  💭 I'll create a fibonacci function and comprehensive tests
  + fib.ts
  $ node --test fib.test.ts
  ~ fib.ts
  + fib.test.ts

────────────────────────────────────────
✓ 12.3s · 2 new · 1 modified · 5 tool calls
```

### Session logs

Every run produces a markdown session log alongside the raw JSONL event log:

```
logs/
├── my-sandbox.jsonl    ← raw SDK events
└── my-sandbox.md       ← human-readable session log
```

The markdown file is a complete, valid document at every point during execution — you can read it while the agent is still running.

```markdown
# Agent Session

| | |
|---|---|
| **Model** | gemini-3-flash-preview |
| **Sandbox** | my-sandbox |
| **Started** | 2026-05-15T09:31:53.900Z |

## Activity

- ✅ Created `fib.ts`
- ✅ Created `fib.test.ts`
- 🖥️ `node --test fib.test.ts`

## Summary

| | |
|---|---|
| **Duration** | 4.4s |
| **Tool calls** | 3 |
| **New files** | 2 |
```

### Output pipeline

The streaming output uses an adapter pattern. The same normalized event stream powers both terminal and markdown output, and can be extended to new formats:

```ts
import { normalize, NormalizerState, MultiAdapter, TTYAdapter, MarkdownAdapter } from "piebox/cli/streaming";

const adapter = new MultiAdapter([
  new TTYAdapter(verbose),
  new MarkdownAdapter("session.md"),
]);

await adapter.start();
adapter.write({ type: "file_create", path: "fib.ts" });
await adapter.end();
```

Available adapters: `TTYAdapter`, `MarkdownAdapter`. The `StreamAdapter` interface is three methods: `start()`, `write(event)`, `end()`.

## Architecture

```
sandbox()
  ├── .fs     → @platformatic/vfs  (node:fs-compatible, in-memory)
  ├── .shell  → just-bash          (shell interpreter, same fs)
  └── .git    → isomorphic-git     (git operations, same fs)
```

All three share the same in-memory filesystem. When the agent writes a file via its tools, `sb.fs.readFileSync()` sees it. When you write a file via `sb.fs`, the agent's tools see it.

## License

MIT
