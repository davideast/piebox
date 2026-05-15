# API Reference

All public exports from the `piebox` package. Types are sourced from TypeScript definitions; defaults are taken from implementation.

## Primary API

### `sandbox(options?)`

Creates a lightweight, in-memory execution environment composing a virtual filesystem, shell interpreter, and git utilities.

```ts
import { sandbox } from "piebox";

const sb = sandbox();
```

**Signature:**

```ts
function sandbox(options?: SandboxOptions): SandboxInstance
```

#### `SandboxOptions`

| Property | Type | Default | Description |
|---|---|---|---|
| `cwd` | `string` | `"/sandbox"` | Virtual working directory. All tool operations are scoped to this path. |
| `vfs` | `VirtualFileSystem` | `createVFS({ moduleHooks: false })` | Pre-configured VFS instance. When provided, the sandbox uses it instead of creating a new one. |
| `bashOptions` | `Omit<BashOptions, "fs" \| "cwd">` | `undefined` | Bash configuration (python, js, execution limits). The `fs` and `cwd` fields are managed by the sandbox. |

#### `SandboxInstance`

The object returned by `sandbox()`.

| Property | Type | Description |
|---|---|---|
| `fs` | `VirtualFileSystem` (readonly) | The in-memory filesystem. `node:fs`-compatible. |
| `shell` | `Bash` (readonly) | The shell interpreter. Operates on the same filesystem as `fs`. |
| `cwd` | `string` (readonly) | The virtual working directory. |
| `git` | `GitUtilities \| null` | Git utilities. `null` until `clone()` is called. |

##### `SandboxInstance.clone(options)`

Clones a git repository into the sandbox's filesystem. After cloning, `sandbox.git` is populated with bound utilities.

```ts
await sb.clone({ url: "https://github.com/user/repo" });
```

**Signature:**

```ts
clone(options: SandboxCloneOptions): Promise<void>
```

##### `SandboxInstance.createSession(options)`

Creates an agent session wired to this sandbox's filesystem and shell. Skills are auto-discovered from `{cwd}/.agents/skills/` in the VFS unless explicitly overridden via `options.skills`.

```ts
const session = await sb.createSession({ model });
await session.prompt("Explain this codebase.");
```

**Signature:**

```ts
createSession(options: SessionOptions): Promise<AgentSession>
```

---

### `SessionOptions`

Options for creating an agent session within a sandbox.

| Property | Type | Default | Description |
|---|---|---|---|
| `model` | `Model<any>` | — (required) | Model to use for the agent session. |
| `thinkingLevel` | `ThinkingLevel` | `undefined` | Thinking level for the model. |
| `systemPrompt` | `string[]` | `undefined` | Additional system prompt lines appended after the sandbox preamble. |
| `skills` | `Skill[]` | Auto-discovered from `{cwd}/.agents/skills/` | Skills to inject into the agent's system prompt. Pass `[]` to disable auto-discovery. |
| `additionalTools` | `ToolDefinition[]` | `undefined` | Additional custom tools registered alongside the sandboxed built-ins. These are **not** sandboxed. |
| `authStorage` | `AuthStorage` | `AuthStorage.create()` | Auth storage instance. |
| `modelRegistry` | `ModelRegistry` | `ModelRegistry.create(authStorage)` | Model registry instance. |

---

### `SandboxCloneOptions`

Clone options scoped to the sandbox. Equivalent to `Omit<CloneOptions, "dir" | "vfs">` — the sandbox manages `dir` and `vfs` internally.

| Property | Type | Default | Description |
|---|---|---|---|
| `url` | `string` | — (required) | The URL of the remote repository. |
| `ref` | `string` | Remote's default branch | Which branch to checkout. |
| `singleBranch` | `boolean` | `true` | Only fetch a single branch. Recommended for agent workloads. |
| `depth` | `number` | `1` | Shallow clone depth. `1` = only latest commit. |
| `noTags` | `boolean` | `true` | Disable tag fetching. |
| `noCheckout` | `boolean` | `false` | Skip checkout (only fetch `.git` objects). |
| `corsProxy` | `string` | `undefined` | CORS proxy URL (for browser environments). |
| `remote` | `string` | `"origin"` | Name for the remote. |
| `onProgress` | `ProgressCallback` | `undefined` | Optional progress callback. |
| `onAuth` | `AuthCallback` | `undefined` | Optional auth callback for private repos. |
| `httpClient` | `object` | isomorphic-git Node.js HTTP client | Custom HTTP client. |
| `headers` | `Record<string, string>` | `undefined` | Additional headers for HTTP requests (e.g., `{ Authorization: 'Bearer ghp_...' }`). |

---

## Git

### `GitUtilities`

Convenience git operations bound to a VFS + directory pair. Non-destructive query operations for inspecting what an agent changed.

| Method | Signature | Return Type | Description |
|---|---|---|---|
| `statusMatrix` | `statusMatrix()` | `Promise<(string \| number)[][]>` | Status matrix: HEAD vs workdir vs index. |
| `modifiedFiles` | `modifiedFiles()` | `Promise<string[]>` | Files where workdir differs from HEAD. |
| `currentBranch` | `currentBranch()` | `Promise<string \| undefined>` | Current branch name. |
| `log` | `log(depth?: number)` | `Promise<ReadCommitResult[]>` | Commit log. `depth` defaults to `10`. |
| `add` | `add(filepath: string)` | `Promise<void>` | Stage a file. |
| `addAll` | `addAll()` | `Promise<void>` | Stage all modified files. |
| `commit` | `commit(message: string, author?: { name: string; email: string })` | `Promise<string>` | Commit staged changes. Returns the commit SHA. Default author: `Sandbox Agent <agent@sandbox.local>`. |
| `listBranches` | `listBranches()` | `Promise<string[]>` | List all branches. |
| `branch` | `branch(name: string, checkout?: boolean)` | `Promise<void>` | Create a new branch. `checkout` defaults to `true`. |

### `CloneOptions`

Full clone options used by `cloneIntoSandbox`. `SandboxCloneOptions` is derived from this type by omitting `dir` and `vfs`.

| Property | Type | Default | Description |
|---|---|---|---|
| `url` | `string` | — (required) | The URL of the remote repository. |
| `dir` | `string` | `"/sandbox"` | The directory to clone into. |
| `vfs` | `VirtualFileSystem` | `createVFS({ moduleHooks: false })` | Pre-configured VFS instance. |
| `ref` | `string` | Remote's default branch | Branch to checkout. |
| `singleBranch` | `boolean` | `true` | Only fetch a single branch. |
| `depth` | `number` | `1` | Shallow clone depth. |
| `noTags` | `boolean` | `true` | Disable tag fetching. |
| `noCheckout` | `boolean` | `false` | Skip checkout. |
| `corsProxy` | `string` | `undefined` | CORS proxy URL. |
| `remote` | `string` | `"origin"` | Remote name. |
| `onProgress` | `ProgressCallback` | `undefined` | Progress callback. |
| `onAuth` | `AuthCallback` | `undefined` | Auth callback. |
| `httpClient` | `object` | isomorphic-git Node.js HTTP client | Custom HTTP client. |
| `headers` | `Record<string, string>` | `undefined` | Additional HTTP headers. |

### `CloneResult`

Returned by `cloneIntoSandbox`.

| Property | Type | Description |
|---|---|---|
| `vfs` | `VirtualFileSystem` | The primed VFS with the cloned repo. |
| `dir` | `string` | The directory the repo was cloned into. |
| `git` | `GitUtilities` | Utility to query git state after the agent runs. |

---

## Skills

### `loadSkillsFromVFS(options)`

Discovers and loads Agent Skills from a VFS directory. Mirrors the SDK's `loadSkillsFromDir` discovery rules but reads from `@platformatic/vfs` instead of `node:fs`.

**Signature:**

```ts
function loadSkillsFromVFS(options: LoadSkillsFromVFSOptions): Skill[]
```

**Discovery rules:**

1. Directory containing `SKILL.md` → skill root (no further recursion).
2. Otherwise, direct `.md` children are loaded as standalone skills.
3. Subdirectories are recursed to find `SKILL.md` files.

#### `LoadSkillsFromVFSOptions`

| Property | Type | Default | Description |
|---|---|---|---|
| `vfs` | `VirtualFileSystem` | — (required) | The VFS instance to read skill files from. |
| `dir` | `string` | — (required) | Directory in the VFS to scan (e.g., `/sandbox/.agents/skills`). |
| `source` | `string` | `"vfs"` | Source identifier for provenance tracking. |

### `Skill`

Re-exported from `@earendil-works/pi-coding-agent`.

### `createSyntheticSourceInfo`

Re-exported from `@earendil-works/pi-coding-agent`. Creates synthetic `SourceInfo` objects for programmatically constructed skills.

---

## Advanced API

Lower-level escape hatches for consumers who need direct control over session creation, tool wiring, or filesystem adapters.

### `createSandboxedSession(options)`

Creates a sandboxed Pi agent session directly, without the `sandbox()` wrapper. Provides more control over VFS, bash, seed files, and skill paths.

**Signature:**

```ts
function createSandboxedSession(
  options: SandboxSessionOptions,
): Promise<SandboxSessionResult>
```

```ts
import { createSandboxedSession } from "piebox";

const { session, vfs, bash } = await createSandboxedSession({
  model,
  seed: { "README.md": "# My Project" },
});
```

#### `SandboxSessionOptions`

| Property | Type | Default | Description |
|---|---|---|---|
| `model` | `Model<any>` | — (required) | Model to use. |
| `cwd` | `string` | `"/sandbox"` | Virtual working directory. |
| `vfs` | `VirtualFileSystem` | `createVFS({ moduleHooks: false })` | Pre-configured VFS instance. Seed files are applied on top. |
| `bash` | `Bash` | Created internally | Pre-configured Bash instance. When provided, `bashOptions` is ignored. |
| `seed` | `Record<string, string>` | `undefined` | Seed files as path→content. Paths resolve relative to `cwd`. |
| `bashOptions` | `Omit<BashOptions, "fs" \| "cwd">` | `undefined` | Bash options. Ignored when `bash` is provided. |
| `systemPrompt` | `string[]` | `undefined` | Additional system prompt lines. |
| `thinkingLevel` | `ThinkingLevel` | `undefined` | Thinking level for the model. |
| `authStorage` | `AuthStorage` | `AuthStorage.create()` | Auth storage. |
| `modelRegistry` | `ModelRegistry` | `ModelRegistry.create(authStorage)` | Model registry. |
| `additionalTools` | `ToolDefinition[]` | `undefined` | Additional custom tools (not sandboxed). |
| `skills` | `Skill[]` | `undefined` | Skills to inject into the system prompt. |
| `skillPaths` | `string[]` | `undefined` | Host filesystem directories to scan for `SKILL.md` files. |

#### `SandboxSessionResult`

| Property | Type | Description |
|---|---|---|
| `session` | `AgentSession` | The created agent session, ready for `.prompt()`. |
| `vfs` | `VirtualFileSystem` | The VFS instance (the filesystem foundation). |
| `bash` | `Bash` | The Bash instance for direct shell execution. |

### `cloneIntoSandbox(options)`

Clones a git repository into an in-memory VFS. Returns the primed VFS, directory, and bound `GitUtilities`.

**Signature:**

```ts
function cloneIntoSandbox(options: CloneOptions): Promise<CloneResult>
```

```ts
import { cloneIntoSandbox } from "piebox";

const { vfs, dir, git } = await cloneIntoSandbox({
  url: "https://github.com/user/repo",
});
```

### `createGitUtilities(vfs, dir)`

Creates bound git utility functions for a VFS + directory pair. For use when a VFS already contains a git repo without needing to clone.

**Signature:**

```ts
function createGitUtilities(
  vfs: VirtualFileSystem,
  dir: string,
): GitUtilities
```

### `createSandboxedTools(cwd, vfs, bash)`

Creates all SDK tool definitions bound to a VFS and Bash instance. Returns an array of `ToolDefinition` objects for the 7 built-in tools (bash, read, write, edit, grep, find, ls).

**Signature:**

```ts
function createSandboxedTools(
  cwd: string,
  vfs: VirtualFileSystem,
  bash: Bash,
): ToolDefinition[]
```

### `createBashFsAdapter`

Creates an `IFileSystem` adapter bridging `@platformatic/vfs` → `just-bash`.

**Signature:**

```ts
function createBashFsAdapter(vfs: VirtualFileSystem): IFileSystem
```

### `createGitFsAdapter`

Creates an `fs`-compatible adapter bridging `@platformatic/vfs` → `isomorphic-git`.

**Signature:**

```ts
function createGitFsAdapter(vfs: VirtualFileSystem): FsAdapter
```

---

## Re-exports

Primitives re-exported for convenience. Consumers can use these without adding direct dependencies.

| Export | Source Package | Description |
|---|---|---|
| `createVFS` | `@platformatic/vfs` | `create()` function — creates a new `VirtualFileSystem` instance. |
| `VirtualFileSystem` (type) | `@platformatic/vfs` | The in-memory filesystem interface. `node:fs`-compatible. |
| `VFSOptions` (type) | `@platformatic/vfs` | Options for `createVFS()`. |
| `Bash` | `just-bash` | Shell interpreter class. |
| `BashOptions` (type) | `just-bash` | Options for the `Bash` constructor. |
