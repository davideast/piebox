/**
 * Tool wiring — creates all SDK tool definitions.
 *
 * @platformatic/vfs is the filesystem foundation. just-bash gets an
 * IFileSystem adapter over the VFS. Pi SDK tools use the VFS directly.
 */

import type { PieboxFS as VirtualFileSystem } from "./fs/types.js";
import type { Bash } from "just-bash";
import {
  createBashToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  createEditToolDefinition,
  createGrepToolDefinition,
  createFindToolDefinition,
  createLsToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  createBashOperations,
  createReadOperations,
  createWriteOperations,
  createEditOperations,
  createGrepOperations,
  createFindOperations,
  createLsOperations,
} from "./operations/index.js";
import { createNpmInfoToolDefinition } from "./tools/npm-info.js";

export interface SandboxedToolsOptions {
  /** When true, include the npm-info tool (requires network access). */
  npmInfo?: boolean;
}

/**
 * Create all SDK tool definitions.
 *
 * - Bash tool → delegates to `Bash.exec()` (just-bash interpreter)
 * - File tools → delegate directly to `VirtualFileSystem` (node:fs API)
 * - npm-info → queries npm registry via fetch() (when network is enabled)
 *
 * Both operate on the same underlying filesystem because the Bash
 * instance is configured with an IFileSystem adapter over the VFS.
 *
 * @param cwd - Virtual working directory for all tools
 * @param vfs - @platformatic/vfs VirtualFileSystem (the foundation)
 * @param bash - just-bash Bash instance (configured with VFS adapter)
 * @param options - Optional tool configuration
 * @returns Array of ToolDefinitions ready for `customTools`
 */
export function createSandboxedTools(
  cwd: string,
  vfs: VirtualFileSystem,
  bash: Bash,
  options?: SandboxedToolsOptions,
): ToolDefinition[] {
  const tools = [
    createBashToolDefinition(cwd, { operations: createBashOperations(bash) }),
    createReadToolDefinition(cwd, { operations: createReadOperations(vfs) }),
    createWriteToolDefinition(cwd, { operations: createWriteOperations(vfs) }),
    createEditToolDefinition(cwd, { operations: createEditOperations(vfs) }),
    createGrepToolDefinition(cwd, { operations: createGrepOperations(vfs) }),
    createFindToolDefinition(cwd, { operations: createFindOperations(vfs) }),
    createLsToolDefinition(cwd, { operations: createLsOperations(vfs) }),
  ] as ToolDefinition[];

  if (options?.npmInfo) {
    tools.push(
      createNpmInfoToolDefinition({
        readFile: (path) => {
          const resolved = path.startsWith("/") ? path : `${cwd}/${path}`;
          return vfs.readFileSync(resolved, "utf-8") as string;
        },
      }),
    );
  }

  return tools as ToolDefinition[];
}

