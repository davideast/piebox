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
