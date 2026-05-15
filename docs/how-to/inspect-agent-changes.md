# Inspect What the Agent Changed

## List modified files

To get a list of files the agent changed, call `modifiedFiles()` on the sandbox's git utilities:

```ts
import { sandbox } from "piebox";

const sb = sandbox();
await sb.clone({ url: "https://github.com/your-org/repo" });

const session = await sb.createSession({ model });
await session.prompt("Add input validation to all handlers.");

const changed = await sb.git!.modifiedFiles();
console.log("Modified files:", changed);
// ["src/handlers/auth.ts", "src/handlers/user.ts"]
```

`modifiedFiles()` returns file paths where the working directory differs from HEAD.

## Inspect the full status matrix

To get detailed status information for every tracked file, call `statusMatrix()`:

```ts
const matrix = await sb.git!.statusMatrix();
for (const [filepath, head, workdir, stage] of matrix) {
  console.log(filepath, { head, workdir, stage });
}
```

The matrix follows `isomorphic-git` conventions. Each row is `[filepath, HEAD, WORKDIR, STAGE]`:

| HEAD | WORKDIR | Meaning |
|------|---------|---------|
| `1`  | `1`     | Unmodified |
| `1`  | `2`     | Modified |
| `0`  | `2`     | New file |
| `1`  | `0`     | Deleted |

## Read the modified content

To read a modified file's content from the in-memory filesystem:

```ts
const changed = await sb.git!.modifiedFiles();
for (const filepath of changed) {
  const content = sb.fs.readFileSync(`/sandbox/${filepath}`, "utf-8");
  console.log(`--- ${filepath} ---`);
  console.log(content);
}
```

## Stage and commit changes

To commit the agent's changes, stage the modified files and create a commit:

```ts
// Stage all modified files
await sb.git!.addAll();

// Commit with a message
const sha = await sb.git!.commit("feat: add input validation");
console.log("Commit SHA:", sha);
```

To stage individual files instead:

```ts
await sb.git!.add("src/handlers/auth.ts");
await sb.git!.commit("fix: validate auth input", {
  name: "CI Bot",
  email: "ci@example.com",
});
```

## Commit to a new branch

To commit changes on a separate branch:

```ts
await sb.git!.branch("agent/validation-fix");
await sb.git!.addAll();
await sb.git!.commit("feat: add input validation");

const branch = await sb.git!.currentBranch();
console.log("Current branch:", branch);
// "agent/validation-fix"
```
