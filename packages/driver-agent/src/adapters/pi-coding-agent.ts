/**
 * pi-coding-agent adapter — bridges the server-side
 * `@earendil-works/pi-coding-agent` SDK to the Layer 2 substrate.
 *
 * Responsibility: take a `Sandbox` (Layer 2) plus driver-supplied
 * config (model, skills, system prompt, additional tools) and produce
 * an `AgentSession` wired to the sandbox's fs + a just-bash interpreter.
 *
 * The adapter takes the `Bash` instance directly (rather than going
 * through `sandbox.runtime.run`) because the SDK's bash tool needs the
 * full `BashExecResult` shape — streaming, env, exit code — which the
 * narrower `PieboxRuntime` interface doesn't surface. The Layer 2
 * Sandbox is still the source of truth for `fs` and `cwd`; the Bash
 * passed here is the same one wired into the sandbox's runtime.
 *
 * This is the ONLY file in `@piebox/driver-agent`'s server path that
 * touches the agent SDK's tool-building APIs. `session.ts` imports
 * `createPiCodingAgentSession` from here and never calls the SDK
 * directly.
 *
 * Step 5 of the composable-sandbox migration plan
 * (`docs/investigations/G-migration.md`). Pairs with
 * `./inbrowser-agent.ts` (Step 4) for the browser path.
 */

import type { Model } from "@earendil-works/pi-ai";
import type { ThinkingLevel } from "@earendil-works/pi-agent-core";
import type {
  AgentSession,
  Skill,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import {
  AuthStorage,
  createAgentSession,
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  DefaultResourceLoader,
  ModelRegistry,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { Bash } from "just-bash";
import type { Sandbox } from "piebox/layer2";
import {
  createBashOperations,
  createEditOperations,
  createFindOperations,
  createGrepOperations,
  createLsOperations,
  createReadOperations,
  createWriteOperations,
} from "piebox/operations";

/**
 * Re-export the SDK types/values consumers of this driver need.
 * Importing these from `@piebox/driver-agent` means downstream code
 * doesn't add a direct dependency on `@earendil-works/pi-coding-agent`.
 *
 * `AgentSession`, `Skill`, `ToolDefinition` are type-only.
 * `AuthStorage` and `ModelRegistry` are classes (both type + value).
 */
export type { AgentSession, Skill, ToolDefinition };
export { AuthStorage, ModelRegistry };

// ── Adapter inputs ────────────────────────────────────────────────────────

export interface PiCodingAgentSessionInputs {
  /** Layer 2 sandbox — owns the substrate (fs, runtime, cwd). */
  sandbox: Sandbox;
  /** Bash interpreter wired to the sandbox's fs. The SDK's bash tool
   *  uses this directly so it can surface `BashExecResult` faithfully. */
  bash: Bash;
  /** Model to drive the session. Required. */
  model: Model<any>;
  /** Optional thinking level. */
  thinkingLevel?: ThinkingLevel;
  /** Extra system-prompt lines appended after the driver's preamble. */
  systemPrompt?: string[];
  /** Skills to inject into the system prompt. */
  skills?: Skill[];
  /** Directories on the host filesystem to scan for SKILL.md files. */
  skillPaths?: string[];
  /** Additional custom tools registered alongside the sandboxed built-ins. */
  additionalTools?: ToolDefinition[];
  /** Auth storage. @default AuthStorage.create() */
  authStorage?: AuthStorage;
  /** Model registry. @default ModelRegistry.create(authStorage) */
  modelRegistry?: ModelRegistry;
}

// ── Tool wiring ────────────────────────────────────────────────────────────

/**
 * Build the SDK ToolDefinition[] wired to the sandbox's fs + the Bash
 * interpreter. The piebox-native operation factories (read/write/edit/
 * grep/find/ls + bash) match the SDK's operations interfaces
 * structurally, so they slot in here without an extra translation layer.
 */
function buildSdkTools(sandbox: Sandbox, bash: Bash): ToolDefinition[] {
  const fs = sandbox.fs;
  const cwd = sandbox.cwd;

  return [
    createBashToolDefinition(cwd, { operations: createBashOperations(bash) }),
    createReadToolDefinition(cwd, { operations: createReadOperations(fs) }),
    createWriteToolDefinition(cwd, { operations: createWriteOperations(fs) }),
    createEditToolDefinition(cwd, { operations: createEditOperations(fs) }),
    createGrepToolDefinition(cwd, { operations: createGrepOperations(fs) }),
    createFindToolDefinition(cwd, { operations: createFindOperations(fs) }),
    createLsToolDefinition(cwd, { operations: createLsOperations(fs) }),
  ] as ToolDefinition[];
}

// ── Session factory ────────────────────────────────────────────────────────

const DRIVER_SYSTEM_PROMPT = [
  "You are operating in a sandboxed environment.",
  "All file operations target an in-memory virtual filesystem.",
  "The bash tool supports full shell syntax: pipes, redirections, variables, loops, and 80+ built-in commands.",
];

/**
 * Create a pi-coding-agent AgentSession bound to the supplied
 * Layer 2 Sandbox. Returns the session ready for `.prompt()`.
 */
export async function createPiCodingAgentSession(
  inputs: PiCodingAgentSessionInputs,
): Promise<AgentSession> {
  const hasSkills = !!(inputs.skills?.length || inputs.skillPaths?.length);
  const authStorage = inputs.authStorage ?? AuthStorage.create();
  const modelRegistry =
    inputs.modelRegistry ?? ModelRegistry.create(authStorage);
  const settingsManager = SettingsManager.inMemory();

  const systemPromptLines = [
    ...DRIVER_SYSTEM_PROMPT,
    ...(inputs.systemPrompt ?? []),
  ];

  const resourceLoader = new DefaultResourceLoader({
    cwd: inputs.sandbox.cwd,
    agentDir: `${inputs.sandbox.cwd}/.pi`,
    settingsManager,
    noExtensions: true,
    noSkills: !hasSkills,
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    appendSystemPrompt: systemPromptLines,
    additionalSkillPaths: inputs.skillPaths ?? [],
    skillsOverride: inputs.skills
      ? (current) => ({
          skills: [...current.skills, ...inputs.skills!],
          diagnostics: current.diagnostics,
        })
      : undefined,
  });
  await resourceLoader.reload();

  const sdkTools = buildSdkTools(inputs.sandbox, inputs.bash);
  const allTools = inputs.additionalTools
    ? [...sdkTools, ...inputs.additionalTools]
    : sdkTools;

  const { session } = await createAgentSession({
    sessionManager: SessionManager.inMemory(),
    authStorage,
    modelRegistry,
    model: inputs.model,
    thinkingLevel: inputs.thinkingLevel,
    settingsManager,
    resourceLoader,
    cwd: inputs.sandbox.cwd,
    noTools: "builtin",
    customTools: allTools,
  });

  return session;
}
