/**
 * Tool wiring — creates all SDK tool definitions.
 *
 * @platformatic/vfs is the filesystem foundation. just-bash gets an
 * IFileSystem adapter over the VFS. Pi SDK tools use the VFS directly.
 */

import type { VirtualFileSystem } from "@platformatic/vfs";
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

/**
 * Create all SDK tool definitions.
 *
 * - Bash tool → delegates to `Bash.exec()` (just-bash interpreter)
 * - File tools → delegate directly to `VirtualFileSystem` (node:fs API)
 *
 * Both operate on the same underlying filesystem because the Bash
 * instance is configured with an IFileSystem adapter over the VFS.
 *
 * @param cwd - Virtual working directory for all tools
 * @param vfs - @platformatic/vfs VirtualFileSystem (the foundation)
 * @param bash - just-bash Bash instance (configured with VFS adapter)
 * @returns Array of ToolDefinitions ready for `customTools`
 */
export function createSandboxedTools(
  cwd: string,
  vfs: VirtualFileSystem,
  bash: Bash,
): ToolDefinition[] {
  return [
    createBashToolDefinition(cwd, { operations: createBashOperations(bash) }),
    createReadToolDefinition(cwd, { operations: createReadOperations(vfs) }),
    createWriteToolDefinition(cwd, { operations: createWriteOperations(vfs) }),
    createEditToolDefinition(cwd, { operations: createEditOperations(vfs) }),
    createGrepToolDefinition(cwd, { operations: createGrepOperations(vfs) }),
    createFindToolDefinition(cwd, { operations: createFindOperations(vfs) }),
    createLsToolDefinition(cwd, { operations: createLsOperations(vfs) }),
  ] as ToolDefinition[];
}
