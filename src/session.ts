/**
 * Sandbox session factory — the primary entrypoint for the library.
 *
 * Architecture:
 *   @platformatic/vfs  ← foundation (node:fs-compatible in-memory filesystem)
 *       ├── just-bash  ← shell interpreter (via IFileSystem adapter over VFS)
 *       ├── Pi SDK     ← tool operations (via direct VFS sync API)
 *       └── (future)   ← isomorphic-git ({ fs: vfs }), Node.js require(), etc.
 */

import {
  AuthStorage,
  createAgentSession,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import { create as createVFS } from "@platformatic/vfs";
import { Bash } from "just-bash";
import { createBashFsAdapter } from "./adapters/bash-fs-adapter.js";
import { createSandboxedTools } from "./tools.js";
import type { SandboxSessionOptions, SandboxSessionResult } from "./types.js";

const DEFAULT_CWD = "/sandbox";

const SANDBOX_SYSTEM_PROMPT = [
  "You are operating in a sandboxed environment.",
  "All file operations target an in-memory virtual filesystem.",
  "The bash tool supports full shell syntax: pipes, redirections, variables, loops, and 80+ built-in commands.",
];

/**
 * Create a sandboxed Pi agent session.
 *
 * @example
 * ```ts
 * import { createSandboxedSession } from "./src";
 * import { getModel } from "@earendil-works/pi-ai";
 *
 * const { session, vfs, bash } = await createSandboxedSession({
 *   model: getModel("google", "gemini-3-flash-preview"),
 *   seed: {
 *     "README.md": "# My Project",
 *     "src/index.ts": 'console.log("Hello!");',
 *   },
 * });
 *
 * await session.prompt("What files are in the directory?");
 *
 * // VFS is node:fs-compatible — pass directly to isomorphic-git
 * // await git.init({ fs: vfs, dir: "/sandbox" });
 * ```
 */
export async function createSandboxedSession(
  options: SandboxSessionOptions,
): Promise<SandboxSessionResult> {
  const cwd = options.cwd ?? DEFAULT_CWD;

  // ── Layer 1: @platformatic/vfs (foundation) ──────────────────────────
  const vfs = options.vfs ?? createVFS({ moduleHooks: false });

  // Ensure cwd exists
  try {
    vfs.mkdirSync(cwd, { recursive: true });
  } catch {
    // Already exists
  }

  // Apply seed files
  if (options.seed) {
    for (const [relativePath, content] of Object.entries(options.seed)) {
      const fullPath = relativePath.startsWith("/")
        ? relativePath
        : `${cwd}/${relativePath}`;

      // Ensure parent directories exist
      const parentDir = fullPath.substring(0, fullPath.lastIndexOf("/"));
      if (parentDir && parentDir !== cwd) {
        try {
          vfs.mkdirSync(parentDir, { recursive: true });
        } catch {
          // Already exists
        }
      }

      vfs.writeFileSync(fullPath, content);
    }
  }

  // ── Layer 2: just-bash (shell interpreter over VFS) ──────────────────
  let bash: Bash;
  if (options.bash) {
    bash = options.bash;
  } else {
    // Create an IFileSystem adapter that bridges VFS → just-bash
    const bashFs = createBashFsAdapter(vfs);
    bash = new Bash({
      fs: bashFs,
      cwd,
      ...options.bashOptions,
    });
  }

  // ── Layer 3: Pi SDK session ──────────────────────────────────────────
  const authStorage = options.authStorage ?? AuthStorage.create();
  const modelRegistry =
    options.modelRegistry ?? ModelRegistry.create(authStorage);
  const settingsManager = SettingsManager.inMemory();

  const systemPromptLines = [
    ...SANDBOX_SYSTEM_PROMPT,
    ...(options.systemPrompt ?? []),
  ];

  // Skills are host-filesystem configuration, not VFS content.
  // Enable skill loading only when the consumer provides skills or skillPaths.
  const hasSkills = !!(options.skills?.length || options.skillPaths?.length);

  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir: `${cwd}/.pi`,
    settingsManager,
    noExtensions: true,
    noSkills: !hasSkills,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    appendSystemPrompt: systemPromptLines,
    // Directory-based skill discovery (host filesystem)
    additionalSkillPaths: options.skillPaths ?? [],
    // Programmatic skill injection
    skillsOverride: options.skills
      ? (current) => ({
          skills: [...current.skills, ...options.skills!],
          diagnostics: current.diagnostics,
        })
      : undefined,
  });
  await resourceLoader.reload();

  // Create tool definitions: bash → just-bash, everything else → VFS
  const sandboxedTools = createSandboxedTools(cwd, vfs, bash);
  const allTools = options.additionalTools
    ? [...sandboxedTools, ...options.additionalTools]
    : sandboxedTools;

  const { session } = await createAgentSession({
    sessionManager: SessionManager.inMemory(),
    authStorage,
    modelRegistry,
    model: options.model,
    thinkingLevel: options.thinkingLevel,
    settingsManager,
    resourceLoader,
    cwd,
    noTools: "builtin",
    customTools: allTools,
  });

  return { session, vfs, bash };
}
