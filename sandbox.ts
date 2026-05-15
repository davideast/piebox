/**
 * sandbox.ts — Example consumer of the pi-sandbox library.
 *
 * Demonstrates the full in-memory architecture:
 *   @platformatic/vfs  ← foundation (node:fs-compatible)
 *       ├── just-bash  ← shell interpreter
 *       └── Pi SDK     ← tool operations
 */

import { createSandboxedSession } from "./src/index.js";
import { getModel } from "@earendil-works/pi-ai";
import { appendFile } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as fs from "node:fs";

// Host-side logging setup (the only thing that touches real disk)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const logsDir = path.join(__dirname, "logs");
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir);

// Create a sandboxed session with seed files
const { session, vfs, bash } = await createSandboxedSession({
  model: getModel("google", "gemini-3-flash-preview"),
  seed: {
    "README.md": "# My Project\nA sandboxed project.\n",
    "index.ts": 'console.log("Hello from sandbox!");\n',
    "package.json": JSON.stringify({ name: "sandbox", version: "1.0.0" }, null, 2),
  },
});

// Stream events to logs + stdout
session.subscribe((event) => {
  appendFile(
    `${logsDir}/${session.sessionId}.jsonl`,
    JSON.stringify(event) + "\n",
    (err) => { if (err) throw err; },
  );
  if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
});

// Run the agent
await session.prompt("What files are in the directory? Read the README and describe the project.");

// Inspect the VFS after the run — it's a standard node:fs API
console.log("\n\n--- VFS state after agent run ---");
const files = vfs.readdirSync("/sandbox") as string[];
for (const file of files) {
  console.log(`  /sandbox/${file}`);
}

// VFS is ready for isomorphic-git:
// import git from 'isomorphic-git';
// await git.init({ fs: vfs, dir: '/sandbox' });
