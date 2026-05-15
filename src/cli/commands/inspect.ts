import { defineCommand } from "citty";
import { initServices } from "../services.js";
import { output } from "../utils/output.js";

export const filesCommand = defineCommand({
  meta: { name: "files", description: "List files in a sandbox" },
  args: {
    sandbox: { type: "string", alias: "s", description: "Sandbox name", required: true },
    path: { type: "positional", description: "Directory to list (default: cwd)", required: false },
    json: { type: "boolean" },
  },
  async run({ args }) {
    try {
      const { manager } = await initServices();
      const sb = await manager.load(args.sandbox);
      const dir = args.path ? `${sb.cwd}/${args.path}` : sb.cwd;
      const files = listRecursive(sb, dir, sb.cwd);

      if (args.json) {
        output({ success: true, data: { files } }, args);
      } else {
        console.log(`${files.length} files in ${args.sandbox}:\n`);
        for (const f of files) {
          console.log(`  ${f}`);
        }
      }
    } catch (e: unknown) {
      output({ success: false, error: { code: "FILES_FAILED", message: (e instanceof Error ? e.message : String(e)) } }, args);
    }
  },
});

export const readCommand = defineCommand({
  meta: { name: "read", description: "Read a file from a sandbox" },
  args: {
    sandbox: { type: "string", alias: "s", description: "Sandbox name", required: true },
    file: { type: "positional", description: "File path to read", required: true },
    json: { type: "boolean" },
  },
  async run({ args }) {
    try {
      const { manager } = await initServices();
      const sb = await manager.load(args.sandbox);
      const fullPath = args.file.startsWith("/") ? args.file : `${sb.cwd}/${args.file}`;
      const content = sb.fs.readFileSync(fullPath, "utf-8") as string;

      if (args.json) {
        output({ success: true, data: { path: args.file, content } }, args);
      } else {
        process.stdout.write(content);
        // Ensure trailing newline
        if (!content.endsWith("\n")) process.stdout.write("\n");
      }
    } catch (e: unknown) {
      output({ success: false, error: { code: "READ_FAILED", message: (e instanceof Error ? e.message : String(e)) } }, args);
    }
  },
});

function listRecursive(sb: any, dir: string, cwd: string): string[] {
  const results: string[] = [];
  try {
    const entries = sb.fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = `${dir}/${entry.name}`;
      const relativePath = fullPath.slice(cwd.length + 1);
      if (entry.isDirectory()) {
        // Skip .git internals
        if (entry.name === ".git") continue;
        results.push(...listRecursive(sb, fullPath, cwd));
      } else {
        results.push(relativePath);
      }
    }
  } catch {
    // Directory doesn't exist
  }
  return results;
}
