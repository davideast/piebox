# Piebox Portability Review

A narration-friendly walkthrough of the server-side and browser-side substrates in piebox, and what it would take to unify them on a single portable runtime contract.

## Part One. Two Corrections to the Starting Model

Before going further, two pieces of the working mental model need adjustment.

The first concerns the JavaScript engine. The earlier description named QuickJS as part of the server stack. In practice, neither piebox nor almostnode depends on QuickJS. The phrase "QuickJS-based JS runtime" survives only in docstrings, where it describes the internal JavaScript interpreter inside just-bash. Almostnode itself takes a different approach: it transforms TypeScript and modern JavaScript with esbuild compiled to WebAssembly, then executes the resulting CommonJS modules in the browser's own JavaScript engine inside the page realm. There is no virtual machine isolation, no separate sandboxed interpreter, just a module runtime that lives in the same realm as the host application.

The second correction concerns the virtual filesystem name. The library in use is Platformatic VFS, not Platformic. It is version zero point four, backed by SQLite through Node's built-in sqlite module, which means it ships only on Node twenty-two or newer and cannot run in the browser. The browser side uses a different filesystem entirely, an in-memory tree structure provided by almostnode.

A third item worth flagging up front is the version split inside the shell layer. Piebox pins just-bash at version three point zero point one. Almostnode bundles its own copy of just-bash internally at version two point seven. Those builds can drift in shell-builtin behavior, and any drift becomes a latent class of bugs where the same shell command from the agent produces different results on the server and in the browser.

The other element, isomorphic-git, is correctly identified. It runs over the piebox filesystem interface and is symmetric across backends because both backends implement the same interface.

So the substrate today, when described faithfully, looks like this. On the server, the virtual filesystem is Platformatic VFS over SQLite. The shell is just-bash version three plus an adapter that translates piebox's synchronous filesystem into the asynchronous interface just-bash expects. Agent JavaScript runs through whatever just-bash provides as its node command. Git runs through isomorphic-git over the same filesystem. There is no network bridge because the server can use real sockets, and there is no formal trust model beyond whatever just-bash's surface allows.

On the browser side, the virtual filesystem is almostnode's in-memory tree. The shell is almostnode's bundled just-bash at version two point seven, exposed through container dot run. JavaScript execution goes through an esbuild transform to CommonJS that then runs in the page realm. Git is isomorphic-git again, over the same filesystem interface, though the playground re-implements its own git tools rather than importing them from piebox. A Service Worker bridge exposes any in-virtual-filesystem HTTP server to the preview iframe. The trust model is documented in two tiers, today's main-thread mode for trusted code and a future cross-origin sandbox mode for untrusted code.

## Part Two. The Portability Seams That Already Exist

This is the good news. The browser work that landed in pull request six did not bolt a parallel architecture onto piebox. It slotted the browser into an interface that was designed for both sides from the start.

The filesystem interface, PieboxFS, lives in the types module of the filesystem package. It declares the read surface, including existsSync, statSync, lstatSync, accessSync, realpathSync, the overloaded readFileSync that returns either a typed array or a string depending on encoding, and the overloaded readdirSync that returns either a list of names or a list of Dirent objects. It declares the write surface, including writeFileSync, mkdirSync, unlinkSync, rmdirSync, renameSync, and copyFileSync. And it declares three optional methods, appendFileSync, readlinkSync, and symlinkSync, which are marked optional precisely because they are either Node-only or unreliable in the browser.

The runtime interface, PieboxRuntime, is leaner. It declares a single required method, run, which takes a command string and optional options and returns a promise of a result. It also declares two optional methods, getServerUrl for resolving an in-substrate HTTP port to a real URL, and sendInput for piping data into an interactive process.

A factory function in the filesystem index module already dispatches between createNodeFs and createBrowserFs based on a backend option. The runtime side has only the browser binding so far, but the runtime index file is explicit in its comment header that a Node-side binding around just-bash will land alongside the agent-tool integration in a follow-up task. The intent has always been portable.

In other words, this is not a from-scratch design problem. The question is whether to finish the portable design that's already in motion or to collapse to a single substrate.

## Part Three. What's Actually Asymmetric Today

There are six divergences worth naming, in roughly the order they would bite.

The first is the missing Node runtime. Server-side bash goes through the Bash class from just-bash plus a bash-filesystem-adapter, not through PieboxRuntime. As a consequence, the bash tool itself takes a Bash instance, not a runtime instance. When the browser playground needed bash, it could not use the canonical tool layer. It re-implemented it from scratch, roughly seven hundred and fifty lines in the playground's agent module, duplicating write, read, edit, bash, list directory, and the seven git tools that piebox already provides for the server. Two sources of truth for what is supposed to be the same tool contract.

The second is that createSandboxedTools, the function that produces the canonical agent tool set, is exported only from the main piebox entry, not from the browser entry. The playground had to build its own. The two implementations will drift.

The third is that createBrowserFs quietly patches gaps in almostnode's filesystem. It synthesizes readdirSync with file-types, it implements appendFileSync as a read-concat-write, it normalizes the object form of the encoding option into a literal string, and it stubs out symlinks with clean errors. These are almostnode-shaped workarounds living inside piebox. If almostnode's filesystem ever changes shape, the patch layer is brittle.

The fourth is that the workaround layer, the so-called STOPGAP code, lives in the playground example rather than in piebox itself. The npm-create translator, the node-dash-e tempfile dance, the npm-install devDependencies backstop, the bundled Vite template scaffolder, all of these are substrate concerns. They are not playground concerns. The next consumer of the browser entry will hit the same gaps and reinvent the same workarounds.

The fifth is the just-bash version split already mentioned. Three point zero point one on one side, two point seven on the other.

The sixth is the permanent capability ceiling in the browser, which no amount of patching can lift. The browser substrate cannot run real curl, wget, python, make, or a real git binary. It cannot load native node addons like better-sqlite-three or sharp. It has no raw TCP through net dot createConnection. It cannot spawn arbitrary child processes. It has no real operating system filesystem. It also has specific browser-shaped quirks: node dash dash test does not work, node dash e needs a tempfile translation, npm install silently skips devDependencies, npm create vite at latest trips on the missing util dot styleText function, and dev servers must bind to localhost rather than to all interfaces because the Service Worker bridge forwards requests with no Host header.

## Part Four. Two Centralization Paths and Their Tradeoffs

There are two reasonable directions, and they are not equal.

The first direction is almostnode everywhere. Drop Platformatic VFS. Drop the server-side just-bash dependency. Always go through almostnode's container, whether the host is a browser or a Node process.

The advantages are real. One substrate means one set of caveats, one set of bugs, one set of patches. There is no Node runtime to maintain because almostnode already runs in the browser and its JavaScript would, in principle, run anywhere JavaScript runs. Tests in continuous integration look identical to tests in the playground. The class of "this works on server, fails in browser" bugs largely disappears.

The disadvantages are also real, and more decisive. Server-side agents permanently lose the ability to call real binaries, load native addons, open real TCP sockets, do real DNS, connect to a Postgres database, talk to Redis. Every workaround piebox currently maintains for the browser becomes permanent on the server too, even when the host could trivially fill the gap. Almostnode has no Node entry point today, so adopting it on the server would mean either pushing it upstream or maintaining a server build inside piebox. And, importantly, performance degrades on hardware where real Node is available, because every module load goes through an esbuild WebAssembly transform and every execution happens in a CommonJS module runtime instead of in V8 directly.

The honest summary of this path is that almostnode is a compromise made for the browser. Forcing the server to live inside the same compromise gives up genuine capability for the sake of symmetry. The headline server-side use case for piebox is an agent that can do real things in the world. Losing curl, native modules, and TCP is a serious downgrade in service of architectural cleanliness.

The second direction is to finish the portable runtime. Treat PieboxRuntime and PieboxFS as the only contracts the tool layer depends on, and then provide multiple implementations of each.

On the filesystem side, this means keeping NodeFs over Platformatic VFS for now, keeping BrowserFs over almostnode's virtual filesystem, and possibly adding a shared in-memory tree for tests and lightweight cases. On the runtime side, the browser implementation already exists and wraps almostnode. The Node side gains two implementations. The first is a trusted Node runtime that spawns child processes against a working directory in a temporary path, with appropriate cwd, environment, and ulimit constraints, suitable for development. The second is a sandboxed Node runtime that wraps real Node in something stronger: firejail or bubblewrap on Linux, sandbox-exec on macOS, or a Docker or Firecracker microVM for full isolation, suitable for untrusted agent code.

Above these implementations sits createSandboxedTools, taking a filesystem and a runtime and producing the canonical tool set. The bash tool now reads runtime dot run rather than holding a Bash instance directly. The file tools, read, write, edit, list, grep, and find, already operate on the filesystem interface. The git tools wrap isomorphic-git over the filesystem. Above the tools sits createSandboxedSession, the provider-agnostic agent loop.

The advantages of this direction are that the server keeps its full capability, the capability differences between server and browser become explicit in the type system through optional methods and a capabilities object, there is one tool layer instead of two, the playground's seven-hundred-fifty-line tool reimplementation collapses back into the canonical function, and the browser-only quirks move into the browser entry once instead of being copied into every example. The disadvantages are that two implementations must be maintained, but almostnode already exists and the Node side is mostly already-written through just-bash, and the adapter layer must stay disciplined so host-specific shapes do not leak upward.

## Part Five. The Recommendation

The recommendation is to finish the portable runtime. Concretely, in roughly this order.

First, land a createNodeRuntime as the Node-side implementation of PieboxRuntime. Start trivially. Wrap child process spawn, or wrap just-bash to keep behavioral parity with what the agent already knows, whichever is easier. This eliminates the bash-filesystem-adapter as a separate concept because bash becomes whatever the runtime does.

Second, refactor the bash tool to depend on PieboxRuntime rather than on the Bash class directly. This is the keystone change. Once bash is runtime dot run, createSandboxedTools works in both environments unchanged, and the playground no longer needs its parallel implementation.

Third, promote the workaround layer out of the playground example and into the browser entry of piebox. The npm-create translator, the node-dash-e tempfile dance, the devDependencies install backstop, the bundled Vite template scaffolder, all of these are substrate concerns that should live with the substrate. Once they live there, the playground shrinks dramatically, and the next consumer of the browser entry does not have to reinvent them.

Fourth, add an explicit capabilities object to PieboxRuntime. It would expose whether the runtime can spawn real processes, whether it has real network access, whether it can load native addons, which host binaries are available, and what kind of filesystem it provides. The agent's system prompt then becomes a function of capabilities rather than a hardcoded list of "what bash cannot do" that has to be kept in sync by hand in every example.

Fifth, resolve the just-bash version split. Either pin almostnode and piebox to the same just-bash version, or, better, drop the direct dependency on the server side once bash goes through PieboxRuntime. The server-side Node runtime can then own its just-bash version internally or skip it entirely and use the host operating system shell.

Sixth, do not force unification of filesystem backends yet. Platformatic VFS might still earn its keep on the server for use cases that want SQLite snapshots or queryability. The filesystem interface already lets both coexist. After the runtime work lands, revisit whether SQLite is still pulling its weight, and unify on an in-memory tree if not.

Seventh, make the trust model a property of the runtime rather than a property of piebox. Server-trusted is the plain Node runtime. Server-untrusted is the sandboxed Node runtime parameterized by jail technology. Browser-trusted is almostnode in main-thread mode. Browser-untrusted is almostnode in cross-origin sandbox mode, which is already documented in almostnode and is the production path the playground README points at.

## Part Six. What This Does Not Solve

A few honest gaps deserve to be named.

Capability divergence is structural, not architectural. No amount of interface design makes a browser do raw TCP. The portable runtime path makes that divergence explicit, in the type system, where the agent and the developer can see it. The almostnode-everywhere path hides it by removing the capability from the server too. Hiding a real difference is worse than exposing it.

Agent prompts will still need substrate awareness. Even with a capabilities object on the runtime, the language model has to know what it can attempt. The win is that the prompt becomes templated from capabilities rather than a parallel hardcoded knowledge base in each example.

Almostnode is one repository that piebox does not control upstream. Patches filed against it, for missing util functions, for npm create handling, for node-dash-e flag parsing, for devDependencies install behavior, are dependencies on someone else's roadmap. The portable runtime path lets piebox keep a workaround layer that is separable from almostnode itself, so workarounds can be dropped as upstream fixes land.

The session and streaming layers are not yet exported from the browser entry. Pull request six stopped at the substrate. The second step in the recommendation, refactoring the bash tool to depend on the runtime, also depends on the session and streaming layers being available on the browser side. That work is mostly type wiring, but it is not free.

## Closing

If this map looks faithful, the next cheap-but-load-bearing step would be a short design document that fixes the shape of the capabilities object and the unified tool surface. That should be locked down before any code moves, because the bash-tool-through-runtime refactor is the kind of change that is expensive to redo if the capabilities shape is wrong.
