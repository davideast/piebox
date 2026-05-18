/**
 * sandbox.ts — Example consumer of the pi-sandbox library.
 *
 * Demonstrates the full in-memory architecture with VFS-based skills:
 *   @platformatic/vfs  ← foundation (node:fs-compatible)
 *       ├── just-bash  ← shell interpreter
 *       ├── Pi SDK     ← tool operations
 *       └── Skills     ← discovered from VFS (no host bundling)
 *
 * The diataxis skill is seeded directly into the VFS and discovered
 * by loadSkillsFromVFS — no host filesystem copy needed.
 */

import { createVFS } from "./src/index.js";
import {
  createSandboxedSession,
  loadSkillsFromVFS,
} from "@piebox/driver-agent/server";
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

// ── Step 1: Prepare a VFS with the skill seeded from the host ────────────
// In a real workflow, this VFS would come from cloneIntoSandbox()
// and the skills would already be inside the cloned repo.
const vfs = createVFS({ moduleHooks: false });
const sandboxDir = "/sandbox";

// Seed project files
vfs.mkdirSync(sandboxDir, { recursive: true });
vfs.writeFileSync(`${sandboxDir}/README.md`, "# My Project\nA sandboxed project.\n");
vfs.writeFileSync(`${sandboxDir}/index.ts`, 'console.log("Hello from sandbox!");\n');
vfs.writeFileSync(
  `${sandboxDir}/package.json`,
  JSON.stringify({ name: "sandbox", version: "1.0.0" }, null, 2),
);

// Seed the diataxis skill into the VFS — simulates what cloneIntoSandbox() does
// when the cloned repo contains skills at .agents/skills/diataxis/SKILL.md
const hostSkillDir = path.join(__dirname, ".agents", "skills", "diataxis");
seedDirToVFS(vfs, hostSkillDir, `${sandboxDir}/.agents/skills/diataxis`);

// ── Step 2: Discover skills from the VFS ─────────────────────────────────
// This reads SKILL.md files from the in-memory filesystem, parses frontmatter,
// and returns Skill objects ready for injection.
const skills = loadSkillsFromVFS({
  vfs,
  dir: `${sandboxDir}/.agents/skills`,
});

console.log(`Discovered ${skills.length} skill(s) from VFS:`);
for (const skill of skills) {
  console.log(`  - ${skill.name}: ${skill.description.slice(0, 60)}...`);
}

// ── Step 3: Create the session with VFS-discovered skills ────────────────
const { session, bash } = await createSandboxedSession({
  model: getModel("google", "gemini-3-flash-preview"),
  vfs, // reuse the VFS we already prepared
  skills, // inject skills discovered from the VFS
});

// Stream events to logs + stdout
session.subscribe((event: any) => {
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

// Run the agent — it now has the diataxis skill from the VFS
await session.prompt(
  "Write a tutorial for the project in this directory. Follow Diátaxis guidelines.",
);

// Inspect the VFS after the run
console.log("\n\n--- VFS state after agent run ---");
const files = vfs.readdirSync(sandboxDir) as string[];
for (const file of files) {
  console.log(`  /sandbox/${file}`);
}

// ─── Helper ──────────────────────────────────────────────────────────────────
// Recursively seed a host directory into the VFS.
function seedDirToVFS(
  targetVfs: typeof vfs,
  hostDir: string,
  vfsDir: string,
): void {
  targetVfs.mkdirSync(vfsDir, { recursive: true });
  for (const entry of fs.readdirSync(hostDir, { withFileTypes: true })) {
    const hostPath = path.join(hostDir, entry.name);
    const vfsPath = `${vfsDir}/${entry.name}`;
    if (entry.isDirectory()) {
      seedDirToVFS(targetVfs, hostPath, vfsPath);
    } else {
      targetVfs.writeFileSync(vfsPath, fs.readFileSync(hostPath, "utf-8"));
    }
  }
}
