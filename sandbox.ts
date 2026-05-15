/**
 * sandbox.ts — Example consumer of the pi-sandbox library.
 *
 * Demonstrates the full in-memory architecture with Agent Skills:
 *   @platformatic/vfs  ← foundation (node:fs-compatible)
 *       ├── just-bash  ← shell interpreter
 *       ├── Pi SDK     ← tool operations
 *       └── Skills     ← system prompt knowledge (diataxis)
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

// Path to the diataxis skill (host filesystem — read at loader.reload() time)
const skillsDir = path.join(__dirname, "skills");

// Create a sandboxed session with seed files and the diataxis skill
const { session, vfs, bash } = await createSandboxedSession({
  model: getModel("google", "gemini-3-flash-preview"),
  seed: {
    "README.md": "# My Project\nA sandboxed project.\n",
    "index.ts": 'console.log("Hello from sandbox!");\n',
    "package.json": JSON.stringify(
      { name: "sandbox", version: "1.0.0" },
      null,
      2,
    ),
  },
  // Wire up the diataxis skill from the host filesystem
  skillPaths: [skillsDir],
});

// Stream events to logs + stdout
session.subscribe((event) => {
  appendFile(
    `${logsDir}/${session.sessionId}.jsonl`,
    JSON.stringify(event) + "\n",
    (err) => {
      if (err) throw err;
    },
  );
  if (
    event.type === "message_update" &&
    event.assistantMessageEvent.type === "text_delta"
  ) {
    process.stdout.write(event.assistantMessageEvent.delta);
  }
});

// Run the agent — it now has the diataxis skill in its system prompt
await session.prompt(
  "Write a tutorial for the project in this directory. Follow Diátaxis guidelines.",
);

// Inspect the VFS after the run — it's a standard node:fs API
console.log("\n\n--- VFS state after agent run ---");
const files = vfs.readdirSync("/sandbox") as string[];
for (const file of files) {
  console.log(`  /sandbox/${file}`);
}
