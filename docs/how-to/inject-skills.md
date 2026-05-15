# Inject Skills into the Agent

## Use auto-discovery (default)

By default, `createSession()` scans `{cwd}/.agents/skills/` in the VFS for skill files. To use auto-discovery, clone a repo that contains a `.agents/skills/` directory and create a session without specifying `skills`:

```ts
import { sandbox } from "piebox";
import { getModel } from "@anthropic-ai/sdk";

const sb = sandbox();
await sb.clone({ url: "https://github.com/your-org/repo-with-skills" });

const session = await sb.createSession({
  model: getModel("google", "gemini-3-flash-preview"),
});
// Skills from /sandbox/.agents/skills/ are injected automatically.
await session.prompt("Refactor the auth module.");
```

Any directory under `.agents/skills/` containing a `SKILL.md` file is treated as a skill root. Standalone `.md` files at the top level of the skills directory are also loaded.

## Write a skill into the VFS manually

To inject a custom skill without cloning, write a `SKILL.md` file directly into the VFS before creating the session:

```ts
import { sandbox } from "piebox";

const sb = sandbox();

// Create the skill directory
sb.fs.mkdirSync("/sandbox/.agents/skills/code-review", { recursive: true });

// Write the SKILL.md with YAML frontmatter
sb.fs.writeFileSync(
  "/sandbox/.agents/skills/code-review/SKILL.md",
  `---
name: code-review
description: Reviews code for correctness, performance, and style issues.
---

# Code Review Skill

You are a code reviewer. When asked to review code, check for:
- Correctness: logic errors, off-by-one, null handling
- Performance: unnecessary allocations, O(n²) where O(n) is possible
- Style: naming conventions, dead code, missing types
`,
);

const session = await sb.createSession({
  model,
});
// The "code-review" skill is auto-discovered and injected.
```

## Pass explicit skills

To override auto-discovery and provide a specific list of skills, pass the `skills` option to `createSession()`:

```ts
import { sandbox } from "piebox";
import type { Skill } from "piebox";

const customSkill: Skill = {
  name: "security-audit",
  description: "Audits code for common security vulnerabilities.",
  filePath: "/sandbox/.agents/skills/security-audit/SKILL.md",
  baseDir: "/sandbox/.agents/skills/security-audit",
};

const sb = sandbox();
await sb.clone({ url: "https://github.com/your-org/repo" });

const session = await sb.createSession({
  model,
  skills: [customSkill],
});
```

When `skills` is provided, auto-discovery is skipped entirely. Only the skills in the array are injected.

## Disable skills

To create a session with no skills at all, pass an empty array:

```ts
const session = await sb.createSession({
  model,
  skills: [],
});
```

This disables both auto-discovery and any explicit skill injection.
