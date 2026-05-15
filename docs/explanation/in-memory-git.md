# In-Memory Git

Piebox runs git entirely in memory — cloning, checking out, diffing, committing — without touching the host filesystem. This document explains why that matters, how `isomorphic-git` and VFS fit together, what compatibility problems the git adapter solves, and why the default clone settings are tuned the way they are.

## Why in-memory git matters

An agent that modifies code is only useful if its changes can be reviewed, accepted, or discarded without risk. If the agent operates on a real git checkout — on the host's actual filesystem — then every write is immediately real. A buggy refactor corrupts the working tree. An aggressive deletion removes files that matter. The host must either sandbox the filesystem at the OS level (containers, chroot) or accept the risk of damage.

In-memory git eliminates this problem entirely. Because the cloned repository lives in a `@platformatic/vfs` instance, nothing persists to disk. The agent can write, delete, rename, and restructure freely, and the host inspects the results after the fact — calling `modifiedFiles()` to see what changed, reading individual files from the VFS to review them, and choosing whether to extract those changes to a real repository. If the agent's work is unacceptable, the VFS is simply discarded. There is no rollback, no `git checkout -- .`, no cleanup. The disposable filesystem *is* the undo mechanism.

This also means multiple sandboxes can run in parallel against the same repository without coordination. Each sandbox gets its own VFS, its own clone, its own git state. There are no lock files, no shared `.git/index`, no concerns about concurrent writes to the same working tree.

## isomorphic-git and VFS

`isomorphic-git` was designed from the ground up to work with pluggable filesystem backends. Unlike the canonical `git` binary, which is hardwired to POSIX filesystem syscalls, `isomorphic-git` accepts an `fs` parameter on every operation — clone, checkout, status, commit — and delegates all file I/O through that parameter. This is what makes in-memory git possible at all: by passing a VFS-backed `fs` object, every git operation reads from and writes to the same in-memory tree that the shell and agent tools use.

The fit between `isomorphic-git` and `@platformatic/vfs` is natural because both speak the `node:fs` interface. VFS implements `readFileSync`, `writeFileSync`, `mkdirSync`, `statSync`, and the rest of the synchronous `node:fs` API. `isomorphic-git` can consume either callback-style `fs` methods or a `promises` property with async equivalents. Because VFS's operations are synchronous (they operate on in-memory data structures, so there is no I/O to await), the adapter wraps each synchronous call in an `async function` that returns immediately. The result is a `promises` object that satisfies `isomorphic-git`'s contract while delegating to VFS's fast, synchronous internals.

This pluggable design also means that piebox is not locked to `@platformatic/vfs`. Any filesystem implementation that conforms to `node:fs` could be substituted — a `memfs` instance, an `fs`-in-browser polyfill, or a custom implementation — as long as the git adapter can bridge the interface gap.

## The git adapter and the `bindFs()` problem

The `git-fs-adapter` exists to solve a specific runtime failure, not a type-level incompatibility. At the TypeScript level, VFS's native `promises` getter appears to satisfy `isomorphic-git`'s `FsClient` interface. The types align. But at runtime, `isomorphic-git` calls an internal `bindFs()` function during initialization, which iterates over the methods of the `promises` object and calls `.bind()` on each one to pin their `this` context.

VFS's native `promises` getter returns a proxy-like object whose methods are dynamically generated. These methods do not survive `Function.prototype.bind()` — calling `.bind()` on them produces functions that throw or behave incorrectly. The result is a crash deep inside `isomorphic-git`'s initialization, with no clear error message pointing to the cause.

The adapter sidesteps this entirely. Instead of passing VFS's native `promises` object, it constructs a new object with plain `async function` declarations: `async readFile(...)`, `async writeFile(...)`, `async stat(...)`, and so on. Plain functions are ordinary JavaScript function objects that `.bind()` handles correctly. Each function delegates to the corresponding VFS synchronous method, and because VFS operations are in-memory, the `async` wrapper adds negligible overhead.

This is a pattern that appears whenever two libraries with compatible *interfaces* have incompatible *runtime assumptions*. The adapter's value is not in translating between different APIs — the method signatures are nearly identical — but in insulating one library's calling conventions from another library's implementation details.

## GitUtilities and `modifiedFiles()`

`isomorphic-git` exposes a powerful but low-level `statusMatrix()` function that returns a matrix of `[filepath, HEAD, WORKDIR, STAGE]` tuples, where each numeric value encodes a file's state relative to the HEAD commit, the working directory, and the staging area. This matrix can express every possible combination of added, modified, deleted, staged, and unstaged states.

For agent workflows, however, the question is almost always simpler: "what files did the agent change?" The `modifiedFiles()` method in `GitUtilities` exists as deliberate sugar over `statusMatrix()` to answer exactly that question. It filters the matrix for rows where `HEAD !== WORKDIR` — meaning the working directory differs from the last commit — and returns just the filepaths. This covers both modified existing files and newly created files.

The rest of `GitUtilities` follows the same philosophy: `currentBranch()`, `log()`, `add()`, `addAll()`, `commit()`, and `branch()` are all single-delegation wrappers around `isomorphic-git` functions with `fs` and `dir` pre-bound. They exist because `isomorphic-git`'s stateless API — where every call requires `{ fs, dir }` — is correct for a library but tedious for an application. By binding these arguments once at clone time, `GitUtilities` trades generality for ergonomics in the context where it matters most: the host code that inspects an agent's work after execution.

## Shallow clones and the performance defaults

Piebox defaults to `depth: 1` and `singleBranch: true` when cloning. These defaults are not accidental — they reflect the reality of what agents need from a clone.

An agent that refactors code, adds error handling, or writes documentation needs the *current state of the files*. It does not need the full commit history, it does not need other branches, and it does not need tags. A shallow clone with `depth: 1` fetches only the latest commit — the minimum amount of git data that produces a valid working tree. For a large repository, the difference between a full clone and a shallow clone can be orders of magnitude in both time and memory. Because piebox operates entirely in memory, every byte of git history occupies RAM, making shallow clones not just faster but materially cheaper.

`singleBranch: true` restricts the fetch to the target branch only (defaulting to the remote's HEAD). This avoids fetching refs for branches the agent will never check out. Combined with `noTags: true` — which is also defaulted — the clone fetches the absolute minimum: one commit's worth of objects on one branch, with no tag refs.

These defaults can all be overridden. A workflow that needs commit history for blame analysis can pass `depth: 100`. A workflow that needs to compare branches can pass `singleBranch: false`. The defaults optimize for the common case — agents that work on the latest code — while leaving the escape hatches explicit and visible.

## The User-Agent header

Piebox injects a `User-Agent: git/isomorphic-git` header on every HTTP request to the remote. This is a workaround for a specific behavior in GitHub's API: requests without a `User-Agent` header receive a `403` or `401` response, regardless of whether the repository is public.

This is not a bug in `isomorphic-git` or in piebox. GitHub's git endpoint enforces a `User-Agent` requirement as part of its abuse-prevention infrastructure. The canonical `git` binary always sends a `User-Agent` header (e.g., `git/2.43.0`), so the requirement is invisible in normal usage. But `isomorphic-git`'s Node.js HTTP client does not set a `User-Agent` by default, which means raw `isomorphic-git` clones against GitHub will fail silently with an authentication error — even for public repositories with no auth required.

Piebox sets this header unconditionally, in the `headers` spread of the `clone()` call, so that it applies to all HTTP requests. User-supplied headers (for authentication tokens, custom proxies, etc.) are spread *after* the default, allowing them to override the `User-Agent` if needed.
