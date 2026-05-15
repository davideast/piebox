/**
 * VFS Skill Loader — discover and load Agent Skills from the VFS.
 *
 * Mirrors the SDK's `loadSkillsFromDir` discovery rules but reads
 * from `@platformatic/vfs` instead of `node:fs`. This allows skills
 * that arrive via `cloneIntoSandbox()` to be injected into the agent's
 * system prompt without bundling them on the host filesystem.
 *
 * Discovery rules (matching the SDK):
 *   1. If a directory contains SKILL.md, treat it as a skill root — do not recurse.
 *   2. Otherwise, load direct .md children.
 *   3. Recurse into subdirectories to find SKILL.md files.
 */

import type { VirtualFileSystem } from "@platformatic/vfs";
import type { Skill } from "@earendil-works/pi-coding-agent";
import { createSyntheticSourceInfo } from "@earendil-works/pi-coding-agent";
import * as path from "node:path";

/** Options for loading skills from the VFS. */
export interface LoadSkillsFromVFSOptions {
  /** The VFS instance to read skill files from. */
  vfs: VirtualFileSystem;

  /** Directory in the VFS to scan (e.g., `/sandbox/.agents/skills`). */
  dir: string;

  /**
   * Source identifier for provenance tracking.
   * @default "vfs"
   */
  source?: string;
}

/**
 * Load Agent Skills from a VFS directory.
 *
 * @example
 * ```ts
 * const { vfs, dir } = await cloneIntoSandbox({ url: "..." });
 * const skills = loadSkillsFromVFS({
 *   vfs,
 *   dir: `${dir}/.agents/skills`,
 * });
 *
 * const { session } = await createSandboxedSession({
 *   model,
 *   vfs,
 *   skills, // injected into the system prompt
 * });
 * ```
 */
export function loadSkillsFromVFS(options: LoadSkillsFromVFSOptions): Skill[] {
  const { vfs, dir, source = "vfs" } = options;

  if (!dirExists(vfs, dir)) {
    return [];
  }

  return scanDir(vfs, dir, source);
}

// ─── Internal Discovery ─────────────────────────────────────────────────────

/**
 * Recursively scan a VFS directory for skills.
 * Mirrors loadSkillsFromDir discovery rules.
 */
function scanDir(vfs: VirtualFileSystem, dir: string, source: string): Skill[] {
  const skills: Skill[] = [];

  // Rule 1: If this directory contains SKILL.md, it IS the skill root.
  const skillPath = `${dir}/SKILL.md`;
  if (fileExists(vfs, skillPath)) {
    const skill = parseSkillFile(vfs, skillPath, dir, source);
    if (skill) {
      skills.push(skill);
    }
    // Do not recurse — SKILL.md marks the boundary.
    return skills;
  }

  // Read directory entries
  let entries: ReturnType<typeof vfs.readdirSync>;
  try {
    entries = vfs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return skills;
  }

  for (const entry of entries) {
    const fullPath = `${dir}/${entry.name}`;

    if (entry.isDirectory()) {
      // Rule 3: Recurse into subdirectories.
      skills.push(...scanDir(vfs, fullPath, source));
    } else if (
      entry.isFile() &&
      typeof entry.name === "string" &&
      entry.name.endsWith(".md")
    ) {
      // Rule 2: Load direct .md children (standalone skills).
      const skill = parseSkillFile(vfs, fullPath, dir, source);
      if (skill) {
        skills.push(skill);
      }
    }
  }

  return skills;
}

/**
 * Parse a single .md file from the VFS into a Skill object.
 */
function parseSkillFile(
  vfs: VirtualFileSystem,
  filePath: string,
  baseDir: string,
  source: string,
): Skill | null {
  let content: string;
  try {
    content = vfs.readFileSync(filePath, "utf-8") as string;
  } catch {
    return null;
  }

  const { frontmatter, body } = parseFrontmatter(content);

  // Derive name: frontmatter.name → parent directory name → filename stem
  const dirName = path.basename(baseDir);
  const fileStem = path.basename(filePath, ".md");
  const name =
    frontmatter.name ?? (fileStem === "SKILL" ? dirName : fileStem);

  // Derive description: frontmatter.description → first paragraph
  const description =
    frontmatter.description ?? extractFirstParagraph(body) ?? "";

  const disableModelInvocation =
    frontmatter["disable-model-invocation"] === true;

  return {
    name,
    description,
    filePath,
    baseDir,
    sourceInfo: createSyntheticSourceInfo(filePath, {
      source,
      scope: "temporary",
      origin: "top-level",
      baseDir,
    }),
    disableModelInvocation,
  };
}

// ─── Frontmatter Parser ─────────────────────────────────────────────────────
// Lightweight parser for YAML frontmatter between --- fences.
// The SDK's parseFrontmatter is not exported, so we implement the subset
// we need: name (string), description (string), disable-model-invocation (bool).

interface SkillFrontmatter {
  name?: string;
  description?: string;
  "disable-model-invocation"?: boolean;
  [key: string]: unknown;
}

function parseFrontmatter(content: string): {
  frontmatter: SkillFrontmatter;
  body: string;
} {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match || !match[1] || !match[2]) {
    return { frontmatter: {}, body: content };
  }

  const yamlBlock = match[1];
  const body = match[2];
  const frontmatter: SkillFrontmatter = {};

  // Parse simple key: value YAML (sufficient for SkillFrontmatter fields)
  for (const line of yamlBlock.split("\n")) {
    const kv = line.match(/^\s*([^#][^:]+?):\s*(.*)$/);
    if (!kv || !kv[1] || !kv[2]) continue;

    const key = kv[1].trim();
    let value: string | boolean = kv[2].trim();

    // Strip surrounding quotes
    if (
      (value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"'))
    ) {
      value = value.slice(1, -1);
    }

    // Boolean coercion
    if (value === "true") value = true;
    if (value === "false") value = false;

    frontmatter[key] = value;
  }

  return { frontmatter, body };
}

/**
 * Extract the first non-empty, non-heading paragraph from markdown.
 */
function extractFirstParagraph(body: string): string {
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("#")) continue;
    return trimmed;
  }
  return "";
}

// ─── VFS Helpers ────────────────────────────────────────────────────────────

function fileExists(vfs: VirtualFileSystem, filePath: string): boolean {
  try {
    const stat = vfs.statSync(filePath);
    return stat.isFile();
  } catch {
    return false;
  }
}

function dirExists(vfs: VirtualFileSystem, dirPath: string): boolean {
  try {
    const stat = vfs.statSync(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}
