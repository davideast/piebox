# Clone a Repo and Review It

In this tutorial we will clone a real GitHub repository into an in-memory sandbox and ask an AI agent to review the code. Along the way we will explore the cloned files, inspect git history, and see exactly which files the agent modifies.

## Prerequisites

Before we begin, make sure you have:

- **Node.js ≥ 22** installed
- **piebox** installed in your project (`npm install piebox`)
- **Pi SDK authentication** configured
- Completed the [Your First Sandbox](./your-first-sandbox.md) tutorial

Let's dive in.

## Create the sandbox and clone a repository

We will start by creating a sandbox and cloning a public GitHub repository into it. Create a new file called `clone-review.ts`:

```ts
import { sandbox } from 'piebox';

const sb = sandbox();
await sb.clone({ url: 'https://github.com/davideast/stitch-mcp' });
console.log('Clone complete!');
```

Run it:

```bash
npx tsx clone-review.ts
```

You should see:

```
Clone complete!
```

The entire repository now lives in the sandbox's in-memory filesystem. Notice that we did not specify a target directory — the clone goes into the sandbox's working directory (`/sandbox`) by default.

## Explore the cloned files

Now let's look at what was cloned. We will use `sb.fs` to list the files, just like we would with Node's `fs` module.

Add the following to your script:

```ts
const entries = sb.fs.readdirSync('/sandbox');
console.log('Top-level entries:', entries);
```

Run it again. You should see the repository's top-level files and directories listed out. Let's also peek inside a specific file:

```ts
// Read the README
const readme = sb.fs.readFileSync('/sandbox/README.md', 'utf8');
console.log('README preview:\n', readme.slice(0, 300));
```

We can now browse the entire repository from within our script.

## Check the branch and commit log

After cloning, the `sb.git` property is automatically populated with git utilities. We can use these to inspect the repository's state.

Add the following:

```ts
const branch = await sb.git!.currentBranch();
console.log('Current branch:', branch);

const commits = await sb.git!.log(5);
for (const entry of commits) {
  console.log(`  ${entry.oid.slice(0, 7)} — ${entry.commit.message.trim()}`);
}
```

You should see the current branch name (typically `main`) and the most recent commits. Notice that we use `sb.git!` with the non-null assertion — `git` is guaranteed to be populated after calling `clone()`.

## Create a session and ask the agent to review

Now let's bring in the AI agent. We will create a session and ask it to review the codebase.

```ts
import { sandbox } from 'piebox';
import { getModel } from '@earendil-works/pi-ai';

const sb = sandbox();
await sb.clone({ url: 'https://github.com/davideast/stitch-mcp' });

const model = getModel('google', 'gemini-3-flash-preview');
const session = await sb.createSession({ model });

const response = await session.prompt(
  'Review the codebase and suggest improvements. Fix any issues you find directly in the files.'
);
console.log('Agent review:\n', response.text);
```

The agent will read through the cloned files, analyze the code, and write fixes directly to the in-memory filesystem. This is the power of the sandbox — the agent has full read-write access but nothing escapes the virtual environment.

## Inspect the agent's changes

After the agent finishes, we want to know exactly what changed. The `sb.git.modifiedFiles()` method compares the working directory against the original HEAD commit and returns a list of files that differ.

Add the following:

```ts
const modified = await sb.git!.modifiedFiles();

if (modified.length === 0) {
  console.log('No files were modified.');
} else {
  console.log(`\nModified files (${modified.length}):`);
  for (const file of modified) {
    console.log(`  • ${file}`);
  }
}
```

You should see a list of files the agent touched. We can go a step further and read the updated content of each modified file:

```ts
for (const file of modified) {
  const content = sb.fs.readFileSync(`/sandbox/${file}`, 'utf8');
  console.log(`\n--- ${file} ---`);
  console.log(content);
}
```

This lets us inspect every change the agent made before deciding what to keep.

## Putting it all together

Here is the complete script:

```ts
import { sandbox } from 'piebox';
import { getModel } from '@earendil-works/pi-ai';

// 1. Create sandbox and clone repo
const sb = sandbox();
await sb.clone({ url: 'https://github.com/davideast/stitch-mcp' });
console.log('Clone complete!');

// 2. Explore the cloned files
const entries = sb.fs.readdirSync('/sandbox');
console.log('Top-level entries:', entries);

const readme = sb.fs.readFileSync('/sandbox/README.md', 'utf8');
console.log('README preview:\n', readme.slice(0, 300));

// 3. Check git state
const branch = await sb.git!.currentBranch();
console.log('\nCurrent branch:', branch);

const commits = await sb.git!.log(5);
console.log('Recent commits:');
for (const entry of commits) {
  console.log(`  ${entry.oid.slice(0, 7)} — ${entry.commit.message.trim()}`);
}

// 4. Create agent session and ask for a review
const model = getModel('google', 'gemini-3-flash-preview');
const session = await sb.createSession({ model });

const response = await session.prompt(
  'Review the codebase and suggest improvements. Fix any issues you find directly in the files.'
);
console.log('\nAgent review:\n', response.text);

// 5. See what the agent changed
const modified = await sb.git!.modifiedFiles();

if (modified.length === 0) {
  console.log('\nNo files were modified.');
} else {
  console.log(`\nModified files (${modified.length}):`);
  for (const file of modified) {
    console.log(`  • ${file}`);
    const content = sb.fs.readFileSync(`/sandbox/${file}`, 'utf8');
    console.log(content);
  }
}
```

Run the complete script:

```bash
npx tsx clone-review.ts
```

Congratulations! You have cloned a real repository into an in-memory sandbox, explored its files, checked its git history, had an agent review and modify the code, and then inspected exactly which files changed — all without affecting your local filesystem or the remote repository.

## What's next

You now know how to work with both empty sandboxes and cloned repositories. From here you can explore:

- Using `sb.git.branch()` to create feature branches for agent changes
- Using `sb.git.commit()` to snapshot the agent's work
- Passing custom `systemPrompt` lines to `createSession()` to guide the agent's behavior
