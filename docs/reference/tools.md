# Built-in Agent Tools

The sandbox provides 7 built-in tools to the agent. All tools operate on the in-memory `@platformatic/vfs` filesystem — no host filesystem access occurs. Tools are created by `createSandboxedTools()` and automatically registered when calling `sandbox.createSession()` or `createSandboxedSession()`.

## Overview

| Tool | Description | Backed By |
|---|---|---|
| `bash` | Shell command execution | `just-bash` (Bash interpreter over VFS) |
| `read` | Read file contents | `@platformatic/vfs` (direct) |
| `write` | Create or overwrite files | `@platformatic/vfs` (direct) |
| `edit` | Apply targeted edits to existing files | `@platformatic/vfs` (direct) |
| `grep` | Search file contents by pattern | `@platformatic/vfs` (direct) |
| `find` | Search for files by name or glob | `@platformatic/vfs` (direct) |
| `ls` | List directory contents | `@platformatic/vfs` (direct) |

All file paths are resolved relative to the sandbox's `cwd` (default: `/sandbox`).

---

## `bash`

Executes shell commands via the `just-bash` interpreter. The interpreter operates on the same in-memory VFS as all other tools. Supports full shell syntax: pipes, redirections, variables, loops, and 80+ built-in commands.

**Backed by:** `Bash.exec()` from `just-bash`, configured with an `IFileSystem` adapter over the VFS.

| Parameter | Type | Description |
|---|---|---|
| `command` | `string` | The shell command to execute. |

**Capabilities:**

- Pipes (`|`) and redirections (`>`, `>>`, `<`)
- Environment variables and shell expansion
- Loops (`for`, `while`), conditionals (`if`/`else`)
- 80+ built-in commands (`cat`, `echo`, `mkdir`, `cp`, `mv`, `rm`, `head`, `tail`, `wc`, `sort`, `uniq`, `tr`, `sed`, `awk`, etc.)

**Limitations:**

- No network access (no `curl`, `wget`)
- No process management (`ps`, `kill`)
- No system calls outside of filesystem operations

---

## `read`

Reads the contents of a file from the in-memory VFS.

**Backed by:** `VirtualFileSystem` read operations.

| Parameter | Type | Description |
|---|---|---|
| `file_path` | `string` | Path to the file to read. Relative to `cwd`. |
| `offset` | `number` | Optional. Starting line number (1-indexed). |
| `limit` | `number` | Optional. Maximum number of lines to return. |

Returns the file contents as a string. Line-based offset and limit allow partial reads of large files.

---

## `write`

Creates a new file or overwrites an existing file in the in-memory VFS. Parent directories are created automatically.

**Backed by:** `VirtualFileSystem` write operations.

| Parameter | Type | Description |
|---|---|---|
| `file_path` | `string` | Path to the file to write. Relative to `cwd`. |
| `content` | `string` | The content to write to the file. |

---

## `edit`

Applies targeted, search-and-replace edits to an existing file in the in-memory VFS. Designed for precise modifications without rewriting the entire file.

**Backed by:** `VirtualFileSystem` edit operations.

| Parameter | Type | Description |
|---|---|---|
| `file_path` | `string` | Path to the file to edit. Relative to `cwd`. |
| `old_string` | `string` | The exact string to find in the file. Must match uniquely. |
| `new_string` | `string` | The replacement string. |

The `old_string` must appear exactly once in the file. The tool replaces that occurrence with `new_string`.

---

## `grep`

Searches file contents for a pattern across the in-memory VFS. Returns matching lines with file paths and line numbers.

**Backed by:** `VirtualFileSystem` grep operations.

| Parameter | Type | Description |
|---|---|---|
| `pattern` | `string` | The search pattern (string or regex). |
| `path` | `string` | Optional. Directory or file to search within. Relative to `cwd`. Defaults to `cwd`. |
| `include` | `string` | Optional. Glob pattern to filter files (e.g., `*.ts`). |

---

## `find`

Searches for files and directories by name or glob pattern in the in-memory VFS.

**Backed by:** `VirtualFileSystem` find operations.

| Parameter | Type | Description |
|---|---|---|
| `pattern` | `string` | Glob pattern to match file names (e.g., `*.ts`, `README*`). |
| `path` | `string` | Optional. Directory to search within. Relative to `cwd`. Defaults to `cwd`. |

Returns a list of matching file and directory paths.

---

## `ls`

Lists the contents of a directory in the in-memory VFS.

**Backed by:** `VirtualFileSystem` list operations.

| Parameter | Type | Description |
|---|---|---|
| `path` | `string` | Optional. Directory to list. Relative to `cwd`. Defaults to `cwd`. |

Returns entries with names, types (file or directory), and sizes.

---

## Tool Creation

Tools are created internally by `createSandboxedTools()`, which wires each tool definition to the shared VFS and Bash instances:

```ts
function createSandboxedTools(
  cwd: string,
  vfs: VirtualFileSystem,
  bash: Bash,
): ToolDefinition[]
```

Each tool definition is created by a corresponding factory function from `@earendil-works/pi-coding-agent`:

| Factory Function | Tool |
|---|---|
| `createBashToolDefinition` | `bash` |
| `createReadToolDefinition` | `read` |
| `createWriteToolDefinition` | `write` |
| `createEditToolDefinition` | `edit` |
| `createGrepToolDefinition` | `grep` |
| `createFindToolDefinition` | `find` |
| `createLsToolDefinition` | `ls` |

Each factory receives the `cwd` and an `operations` object created by the corresponding operations factory (`createBashOperations`, `createReadOperations`, etc.) from `piebox`'s internal `operations/` module. The operations factories bind tool behavior to the VFS (or Bash instance for the bash tool).
