# Add Custom Tools to the Agent

## Define a tool and pass it to `createSession()`

To register custom tools alongside the built-in sandboxed tools, pass an `additionalTools` array to `createSession()`:

```ts
import { sandbox } from "piebox";
import type { ToolDefinition } from "piebox";

const fetchUrlTool: ToolDefinition = {
  name: "fetch_url",
  description: "Fetch the text content of a URL.",
  parameters: {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "The URL to fetch.",
      },
    },
    required: ["url"],
  },
  execute: async (params: { url: string }) => {
    const response = await fetch(params.url);
    const text = await response.text();
    return { content: text.slice(0, 5000) };
  },
};

const sb = sandbox();
await sb.clone({ url: "https://github.com/your-org/repo" });

const session = await sb.createSession({
  model,
  additionalTools: [fetchUrlTool],
});

await session.prompt("Fetch https://example.com and summarize it.");
```

Custom tools are **not sandboxed** — they have full access to whatever their `execute` function implements. The built-in sandbox tools (bash, read, write, edit, grep, find, ls) are always included.

## Register multiple tools

To add several tools, include them all in the `additionalTools` array:

```ts
const session = await sb.createSession({
  model,
  additionalTools: [fetchUrlTool, databaseQueryTool, slackNotifyTool],
});
```

## Give the tool access to the sandbox

To create a tool that operates on the sandbox's VFS, close over the sandbox instance:

```ts
import { sandbox } from "piebox";
import type { ToolDefinition } from "piebox";

const sb = sandbox();
await sb.clone({ url: "https://github.com/your-org/repo" });

const countLinesTool: ToolDefinition = {
  name: "count_lines",
  description: "Count the number of lines in a file.",
  parameters: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Absolute path to the file in the sandbox.",
      },
    },
    required: ["path"],
  },
  execute: async (params: { path: string }) => {
    const content = sb.fs.readFileSync(params.path, "utf-8") as string;
    const lines = content.split("\n").length;
    return { content: `${lines} lines` };
  },
};

const session = await sb.createSession({
  model,
  additionalTools: [countLinesTool],
});
```
