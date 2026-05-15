# Your First Sandbox

In this tutorial we will create an in-memory sandbox, populate it with files, run a shell command, and then hand the sandbox to an AI agent. By the end you will have a working script that proves everything is wired together.

## Prerequisites

Before we begin, make sure you have the following ready:

- **Node.js ≥ 22** installed
- **piebox** installed in your project (`npm install piebox`)
- **Pi SDK authentication** configured (see the Pi SDK setup guide)

That's all we need. Let's get started.

## Create a sandbox

We will start by importing `sandbox` from piebox and creating a new sandbox instance. Open a new file called `first-sandbox.ts` and add the following:

```ts
import { sandbox } from 'piebox';

const sb = sandbox();
console.log('Working directory:', sb.cwd);
```

Run the file to confirm everything is working:

```bash
npx tsx first-sandbox.ts
```

You should see:

```
Working directory: /sandbox
```

Notice that the working directory is `/sandbox` — this is a virtual path inside the in-memory filesystem. Nothing is written to your real disk.

## Write files to the virtual filesystem

Now let's put some files into the sandbox. The `sb.fs` object is fully compatible with Node's `fs` module, so you can use familiar methods like `writeFileSync` and `mkdirSync`.

Add the following lines to your script:

```ts
import { sandbox } from 'piebox';

const sb = sandbox();

// Create a project structure
sb.fs.mkdirSync('/sandbox/src', { recursive: true });
sb.fs.writeFileSync('/sandbox/src/index.ts', `
export function greet(name: string): string {
  return "Hello, " + name;
}
`);
sb.fs.writeFileSync('/sandbox/package.json', JSON.stringify({
  name: 'my-project',
  version: '1.0.0',
}, null, 2));

// Verify the files exist
const files = sb.fs.readdirSync('/sandbox');
console.log('Files in /sandbox:', files);
```

Run the script again. You should see:

```
Files in /sandbox: [ 'src', 'package.json' ]
```

We now have a small project living entirely in memory.

## Run a shell command

The sandbox includes a built-in shell interpreter. We can use `sb.shell.exec()` to run commands against our virtual filesystem — no real shell process is spawned.

Add the following to your script:

```ts
const result = sb.shell.exec('cat /sandbox/src/index.ts');
console.log('Shell output:', result.stdout);
```

You should see the contents of `index.ts` printed to the console. The shell supports pipes, redirections, variables, loops, and over 80 built-in commands — all operating on the same in-memory filesystem.

## Create an agent session

Here is where things get exciting. We will create an AI agent session that is wired to our sandbox. The agent will be able to read and write files, run shell commands, and interact with the virtual filesystem — all without touching your real machine.

Add the model import and session creation:

```ts
import { sandbox } from 'piebox';
import { getModel } from '@earendil-works/pi-ai';

const sb = sandbox();

// Set up the project files (from previous steps)
sb.fs.mkdirSync('/sandbox/src', { recursive: true });
sb.fs.writeFileSync('/sandbox/src/index.ts', `
export function greet(name: string): string {
  return "Hello, " + name;
}
`);

// Create an agent session
const model = getModel('google', 'gemini-3-flash-preview');
const session = await sb.createSession({ model });
console.log('Session created!');
```

Run it. You should see:

```
Session created!
```

The session is now ready to receive prompts.

## Prompt the agent

Let's ask the agent to improve our code. We will prompt it to add error handling to the `greet` function.

Add the following:

```ts
const response = await session.prompt(
  'Add input validation to the greet function in src/index.ts. Throw an error if name is empty.'
);
console.log('Agent response:', response.text);
```

The agent will read the file from the virtual filesystem, modify it, and write the changes back — all in memory. You should see the agent's response describing the changes it made.

## Inspect the filesystem after the run

Now let's verify what the agent actually did. We can read the modified file directly from the sandbox's filesystem:

```ts
const updated = sb.fs.readFileSync('/sandbox/src/index.ts', 'utf8');
console.log('Updated file:\n', updated);
```

You should see the updated `index.ts` with the validation logic the agent added.

## Putting it all together

Here is the complete script:

```ts
import { sandbox } from 'piebox';
import { getModel } from '@earendil-works/pi-ai';

// 1. Create the sandbox
const sb = sandbox();

// 2. Write files
sb.fs.mkdirSync('/sandbox/src', { recursive: true });
sb.fs.writeFileSync('/sandbox/src/index.ts', `
export function greet(name: string): string {
  return "Hello, " + name;
}
`);
sb.fs.writeFileSync('/sandbox/package.json', JSON.stringify({
  name: 'my-project',
  version: '1.0.0',
}, null, 2));

// 3. Run a shell command
const catResult = sb.shell.exec('cat /sandbox/src/index.ts');
console.log('Before agent:\n', catResult.stdout);

// 4. Create an agent session
const model = getModel('google', 'gemini-3-flash-preview');
const session = await sb.createSession({ model });

// 5. Prompt the agent
const response = await session.prompt(
  'Add input validation to the greet function in src/index.ts. Throw an error if name is empty.'
);
console.log('\nAgent response:', response.text);

// 6. Inspect the result
const updated = sb.fs.readFileSync('/sandbox/src/index.ts', 'utf8');
console.log('\nAfter agent:\n', updated);
```

Run the complete script:

```bash
npx tsx first-sandbox.ts
```

Congratulations! You have created an in-memory sandbox, populated it with files, run shell commands, created an agent session, prompted it to modify code, and inspected the results — all without touching your real filesystem.

## What's next

Now that you know the basics, try the [Clone a Repo and Review It](./clone-and-review.md) tutorial to learn how to clone a real GitHub repository into a sandbox and have an agent review it.
