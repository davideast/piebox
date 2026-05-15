# Architecture

Piebox is a composition of three independent capabilities — a filesystem, a shell, and git — wired together through a shared, in-memory virtual filesystem. This document explains why the architecture takes the shape it does, what tradeoffs were considered, and how the design decisions connect to one another.

## The shared filesystem foundation

Every operation in piebox — writing a file, running a shell command, cloning a repository, checking a diff — ultimately reads from or writes to the same `@platformatic/vfs` instance. This is the single most important architectural decision in the system, and everything else follows from it.

The alternative would have been to give each subsystem its own storage and synchronize between them: the shell could maintain its own file state, git could write to a separate object store, and the agent tools could interact with yet another layer. But synchronization is where complexity hides. The moment two subsystems disagree about the contents of a file, the agent's world becomes inconsistent. An agent that writes a file via a tool call needs to immediately see that file when it runs `cat` through the shell, and git needs to detect that same write as a working-directory modification. A single, shared VFS eliminates the entire class of consistency problems that synchronization introduces.

Because `@platformatic/vfs` implements the `node:fs` interface, it already speaks the lingua franca of the Node.js ecosystem. Libraries that expect `node:fs` — including `isomorphic-git` and `just-bash` — can be pointed at it through thin adapters, rather than requiring purpose-built integrations. The filesystem is not a detail hidden behind the architecture; it *is* the architecture.

## The adapter pattern

VFS provides a `node:fs`-compatible interface, but "compatible" does not mean "identical." Both `isomorphic-git` and `just-bash` expect filesystem objects that conform to their own specific contracts, and those contracts diverge from what VFS provides out of the box. This is where the two adapters — `bash-fs-adapter` and `git-fs-adapter` — earn their place.

The `bash-fs-adapter` bridges VFS to `just-bash`'s `IFileSystem` interface. Bash needs methods like `readdirWithFileTypes`, `getAllPaths`, `readFileBuffer`, and `rm` with recursive semantics — none of which exist on a raw `node:fs` surface. The adapter wraps VFS's synchronous operations in async functions (because `just-bash` expects promises), fills in missing filesystem operations like recursive `rm` and `getAllPaths` traversal, and shapes return values into the `FsStat` / `DirentEntry` structures Bash expects.

The `git-fs-adapter` solves a more subtle problem. `isomorphic-git` accepts either a callback-style `fs` or an object with a `promises` property. VFS *does* expose a native `promises` getter, but that getter returns proxy objects whose methods don't survive `Function.prototype.bind()`. Because `isomorphic-git` internally calls `bindFs()` on the promise methods during initialization, passing VFS's native `promises` object triggers a crash. The git adapter sidesteps this entirely by constructing a fresh `promises` object from plain `async function` declarations that delegate to VFS's synchronous methods. These plain functions survive `bind()` without issue.

The adapters exist because real interoperability requires more than interface compatibility — it requires behavioral compatibility. Each library has unspoken assumptions about how its filesystem object will be used at runtime, and the adapters encode exactly those assumptions.

## Composition, not abstraction

When you access `sb.fs`, you get the VFS instance directly. When you access `sb.shell`, you get the `Bash` instance directly. There are no wrapper classes, no intermediate facades, no "sandbox filesystem" or "sandbox shell" types that mediate access. This is deliberate.

Wrapping each subsystem would create a maintenance surface that grows multiplicatively: every new VFS method would need a corresponding wrapper method, every new Bash feature would need to be re-exported. More importantly, wrapping would obscure the capabilities of the underlying libraries. A developer who knows `@platformatic/vfs` already knows how `sb.fs` works — there is nothing new to learn, no piebox-specific behavior to discover, and no risk that a wrapper silently changes semantics.

This pattern — what the codebase describes as "composition not abstraction" — means the sandbox's job is strictly *wiring*. It creates the VFS, creates the shell with the VFS adapter, and hands them to you. The factory function's value lies in ensuring these pieces share the same filesystem, not in adding behavior on top of them.

The one deliberate exception is `sb.git`, which exposes a `GitUtilities` interface rather than raw `isomorphic-git`. This is because `isomorphic-git`'s API is stateless — every call requires passing `fs`, `dir`, and often `http` — which makes it cumbersome for the most common use case: querying what an agent changed. `GitUtilities` pre-binds these arguments so the host can call `sb.git.modifiedFiles()` without repeating boilerplate. Even here, the utilities are thin sugar, not a replacement: each method is a single delegation to the underlying `isomorphic-git` function.

## Skills auto-discovery

When `createSession()` is called, piebox walks the VFS at `{cwd}/.agents/skills/` to discover skill definitions. This timing is significant: skills are loaded *after* the filesystem is populated, not when the sandbox is created.

The reason is the clone-then-augment workflow. In the typical flow, a developer creates a sandbox, clones a repository into it, and then creates a session. Because skills live inside the repository (in `.agents/skills/`), they only exist in the VFS after cloning completes. If skill discovery happened at `sandbox()` time, the VFS would be empty and no skills would be found. By deferring discovery to `createSession()` time, piebox naturally supports repositories that ship their own skill definitions — an agent working on a project automatically inherits that project's skills.

The explicit override — passing `skills: []` or a custom array — exists for the cases where auto-discovery is wrong: test environments that need deterministic skill sets, pipelines that inject skills from an external source, or situations where the cloned repository's skills should be supplemented rather than used as-is.

## `sandbox()` factory vs class

The sandbox is created by calling `sandbox()`, a plain function, rather than instantiating a class with `new Sandbox()`. This follows a deliberate pattern from modern TypeScript API design.

A class would imply that `SandboxInstance` carries internal state that could be subclassed, that its methods reference `this` in ways that matter for binding, and that the lifecycle involves construction, initialization, and teardown phases. None of these are true. The sandbox's state is minimal — a VFS, a shell, a cwd, and a nullable `git` reference — and it is fully initialized by the time the factory returns. There is no async setup step that a constructor couldn't perform (constructors can't be `async` in JavaScript), no cleanup that needs a `dispose()` method, and no inheritance hierarchy that would benefit from `extends`.

The factory function also makes the return type explicit. The caller receives a `SandboxInstance` — a plain interface — rather than a class instance. This means the internal representation can change freely across versions without breaking consumers. The sandbox could be backed by a closure (as it is today), a class, a proxy, or anything else, and the public contract remains the same.

This is the same pattern used by Vue's `createApp()`, Vite's `createServer()`, and many other modern TypeScript libraries. The function communicates that the object it returns is configured and ready to use, with no hidden lifecycle to manage.
