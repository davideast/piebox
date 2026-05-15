# piebox Documentation

Welcome to the piebox documentation — a lightweight in-memory sandbox environment for agent execution.

## New? Start here

Work through the tutorials to get hands-on experience with piebox.

- [Your First Sandbox](tutorials/your-first-sandbox.md) — Create a sandbox, write files, run an agent.
- [Clone a Repo and Review It](tutorials/clone-and-review.md) — Clone a GitHub repo into memory and let an agent review it.

## Trying to do something specific?

Jump to the how-to guides for step-by-step solutions to common tasks.

- [Clone a Private Repository](how-to/clone-a-private-repo.md) — Use auth tokens with `sb.clone()`.
- [Inject Skills into the Agent](how-to/inject-skills.md) — Auto-discover, explicit, or disabled skills.
- [Inspect What the Agent Changed](how-to/inspect-agent-changes.md) — Use git utilities to diff and commit.
- [Add Custom Tools to the Agent](how-to/add-custom-tools.md) — Register additional tools alongside built-ins.

## Need details?

Consult the reference for exhaustive API documentation.

- [API Reference](reference/api.md) — Every export, type, method, and option.
- [Built-in Agent Tools](reference/tools.md) — The 7 sandboxed tools available to the agent.

## Want to understand the design?

Read the explanation docs for architectural context and design decisions.

- [Architecture](explanation/architecture.md) — Why the shared filesystem, adapters, and composition.
- [In-Memory Git](explanation/in-memory-git.md) — How isomorphic-git works with VFS, and why it matters.
