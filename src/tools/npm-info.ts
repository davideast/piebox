/**
 * npm-info tool — query npm registry metadata from inside the sandbox.
 *
 * Eliminates the need for agents to write helper scripts when they need
 * to check package versions, inspect dependencies, or audit outdated packages.
 *
 * Re-shaped in Step 5 of the composable-sandbox migration plan
 * (`docs/investigations/G-migration.md`) as a Layer 2 `PieboxTool`,
 * so it composes with `PieboxToolset` and any driver that consumes
 * the Layer 2 surface (agent loop, MCP server, CLI). The pre-Step-5
 * `createNpmInfoToolDefinition(opts)` (which returned a
 * `@earendil-works/pi-coding-agent` `ToolDefinition`) is removed.
 */

import type { PieboxResult, PieboxTool } from "../layer2/index.js";

// ─── Input ───────────────────────────────────────────────────────────────────

export interface NpmInfoArgs {
  /** What to do. */
  action: "info" | "versions" | "outdated";
  /** Package name (e.g. 'express', '@types/node'). Required for 'info' and 'versions'. */
  package?: string;
  /** Path to package.json. Required for 'outdated'. Defaults to 'package.json'. */
  path?: string;
}

// ─── Registry helpers ────────────────────────────────────────────────────────

const REGISTRY = "https://registry.npmjs.org";

interface PackageInfo {
  name: string;
  version: string;
  description?: string;
  license?: string;
  homepage?: string;
  repository?: { url?: string };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  engines?: Record<string, string>;
}

interface OutdatedEntry {
  package: string;
  current: string;
  latest: string;
  breaking: boolean;
}

async function fetchLatest(pkg: string): Promise<PackageInfo> {
  const res = await fetch(`${REGISTRY}/${encodeURIComponent(pkg).replace("%40", "@")}/latest`);
  if (!res.ok) {
    throw new Error(`npm registry: ${res.status} for ${pkg}`);
  }
  return res.json() as Promise<PackageInfo>;
}

async function fetchVersions(pkg: string): Promise<string[]> {
  const res = await fetch(`${REGISTRY}/${encodeURIComponent(pkg).replace("%40", "@")}`, {
    headers: { Accept: "application/vnd.npm.install-v1+json" },
  });
  if (!res.ok) {
    throw new Error(`npm registry: ${res.status} for ${pkg}`);
  }
  const data = await res.json() as { versions?: Record<string, unknown> };
  return Object.keys(data.versions ?? {});
}

function parseMajor(version: string): number {
  const clean = version.replace(/^[^0-9]*/, "");
  const parts = clean.split(".");
  const major = parseInt(parts[0] ?? "0", 10);
  return isNaN(major) ? 0 : major;
}

// ─── Actions ─────────────────────────────────────────────────────────────────

async function handleInfo(pkg: string): Promise<string> {
  const info = await fetchLatest(pkg);
  const lines = [
    `${info.name}@${info.version}`,
    "",
  ];
  if (info.description) lines.push(`Description: ${info.description}`);
  if (info.license) lines.push(`License: ${info.license}`);
  if (info.homepage) lines.push(`Homepage: ${info.homepage}`);
  if (info.repository?.url) lines.push(`Repository: ${info.repository.url}`);
  if (info.engines) {
    lines.push(`Engines: ${Object.entries(info.engines).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  }
  if (info.dependencies) {
    lines.push("", `Dependencies (${Object.keys(info.dependencies).length}):`);
    for (const [name, version] of Object.entries(info.dependencies)) {
      lines.push(`  ${name}: ${version}`);
    }
  }
  if (info.peerDependencies) {
    lines.push("", `Peer Dependencies (${Object.keys(info.peerDependencies).length}):`);
    for (const [name, version] of Object.entries(info.peerDependencies)) {
      lines.push(`  ${name}: ${version}`);
    }
  }
  return lines.join("\n");
}

async function handleVersions(pkg: string): Promise<string> {
  const versions = await fetchVersions(pkg);
  // Show last 20 versions (most recent)
  const recent = versions.slice(-20);
  const lines = [`${pkg} — ${versions.length} published versions`, ""];
  if (versions.length > 20) {
    lines.push(`(showing last 20 of ${versions.length})`);
  }
  lines.push(recent.join(", "));
  return lines.join("\n");
}

async function handleOutdated(
  readFile: (path: string) => string,
  filePath: string,
): Promise<string> {
  let pkgJson: { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  try {
    pkgJson = JSON.parse(readFile(filePath));
  } catch (e) {
    throw new Error(`Cannot read ${filePath}: ${e instanceof Error ? e.message : String(e)}`);
  }

  const allDeps = {
    ...(pkgJson.dependencies ?? {}),
    ...(pkgJson.devDependencies ?? {}),
  };

  const entries: OutdatedEntry[] = [];
  const errors: string[] = [];

  // Fetch all in parallel (batched to avoid overwhelming)
  const depEntries = Object.entries(allDeps);
  const batchSize = 8;

  for (let i = 0; i < depEntries.length; i += batchSize) {
    const batch = depEntries.slice(i, i + batchSize);
    const results = await Promise.allSettled(
      batch.map(async ([name, currentRange]) => {
        const info = await fetchLatest(name);
        const currentMajor = parseMajor(currentRange);
        const latestMajor = parseMajor(info.version);
        // Only report if the latest isn't within the current range
        if (!currentRange.includes(info.version)) {
          entries.push({
            package: name,
            current: currentRange,
            latest: info.version,
            breaking: latestMajor > currentMajor,
          });
        }
      }),
    );
    for (const [idx, result] of results.entries()) {
      if (result.status === "rejected") {
        const entry = batch[idx];
        errors.push(`${entry ? entry[0] : "unknown"}: ${result.reason}`);
      }
    }
  }

  if (entries.length === 0 && errors.length === 0) {
    return "All packages are up to date.";
  }

  // Sort: breaking changes first, then alphabetical
  entries.sort((a, b) => {
    if (a.breaking !== b.breaking) return a.breaking ? -1 : 1;
    return a.package.localeCompare(b.package);
  });

  const lines = [
    `${entries.length} outdated package${entries.length === 1 ? "" : "s"} in ${filePath}`,
    "",
    `${"Package".padEnd(35)} ${"Current".padEnd(12)} ${"Latest".padEnd(12)} Breaking`,
    "─".repeat(72),
  ];

  for (const e of entries) {
    lines.push(
      `${e.package.padEnd(35)} ${e.current.padEnd(12)} ${e.latest.padEnd(12)} ${e.breaking ? "⚠ yes" : "  no"}`,
    );
  }

  if (errors.length > 0) {
    lines.push("", `Errors (${errors.length}):`);
    for (const err of errors) lines.push(`  ${err}`);
  }

  return lines.join("\n");
}

// ─── PieboxTool ──────────────────────────────────────────────────────────────

const DESCRIPTION = [
  "Query npm registry metadata. Three actions:",
  "",
  "- info: Get latest version, description, license, deps for a package.",
  "- versions: List all published versions of a package.",
  "- outdated: Read package.json and check all deps against latest. Reports breaking changes.",
].join("\n");

/**
 * The npm-info `PieboxTool`. Reads `package.json` for the `outdated`
 * action via the supplied sandbox's filesystem. Network calls go to
 * `registry.npmjs.org` and rely on the runtime's `fetch` permissions
 * being open for that origin.
 */
export const npmInfoTool: PieboxTool<NpmInfoArgs, { text: string }> = {
  name: "npm_info",
  description: DESCRIPTION,
  inputSchema: {
    type: "object",
    properties: {
      action: {
        type: "string",
        enum: ["info", "versions", "outdated"],
        description: "Action to perform",
      },
      package: {
        type: "string",
        description: "Package name. Required for 'info' and 'versions'.",
      },
      path: {
        type: "string",
        description: "Path to package.json (relative to sandbox cwd). Defaults to 'package.json'.",
      },
    },
    required: ["action"],
  },
  async execute(args, sandbox, signal): Promise<PieboxResult<{ text: string }>> {
    if (signal.aborted) {
      return { ok: false, summary: "cancelled" };
    }
    const cwd = sandbox.cwd.endsWith("/") ? sandbox.cwd.slice(0, -1) : sandbox.cwd;
    const readFile = (path: string): string => {
      const resolved = path.startsWith("/") ? path : `${cwd}/${path}`;
      const buf = sandbox.fs.readFileSync(resolved, "utf-8");
      return typeof buf === "string" ? buf : Buffer.from(buf as unknown as Uint8Array).toString("utf-8");
    };

    try {
      let text: string;
      switch (args.action) {
        case "info":
          if (!args.package) {
            return { ok: false, summary: "'package' is required for action 'info'." };
          }
          text = await handleInfo(args.package);
          break;
        case "versions":
          if (!args.package) {
            return { ok: false, summary: "'package' is required for action 'versions'." };
          }
          text = await handleVersions(args.package);
          break;
        case "outdated":
          text = await handleOutdated(readFile, args.path ?? "package.json");
          break;
        default:
          return {
            ok: false,
            summary: `Unknown action: ${String((args as { action?: unknown }).action)}.`,
          };
      }
      return { ok: true, summary: `npm_info ${args.action}`, data: { text } };
    } catch (e) {
      return {
        ok: false,
        summary: `npm_info failed: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  },
};
