/**
 * VFS-to-tarball packing for Layer 2's `Sandbox.toTarball()`.
 *
 * Adapts the tar.gz block-writing logic from `src/cli/tar.ts` to walk
 * a PieboxFS instead of a real OS filesystem and return a Uint8Array
 * instead of writing to a path. The format is POSIX ustar, gzip-
 * compressed, same as the existing CLI snapshot writer.
 *
 * Why a separate file: the CLI's tar.ts is locked to `node:fs` and
 * stream APIs that don't compose with the VFS interface. Rather than
 * rework that file in this step, this module owns the VFS path and
 * inherits the same on-the-wire format so snapshots from either side
 * are interchangeable.
 */

import type { PieboxFS } from "../fs/types.js";

// `node:zlib` is loaded lazily inside `vfsToTarball` so importing
// `piebox/layer2` from the browser doesn't trigger Vite's externalized-
// Node-module shim at module-load time. Browser consumers that never
// call `Sandbox.toTarball` never reach this import; consumers that do
// will get a clean runtime error from the absent module rather than a
// page-loading crash.

export interface VfsToTarballOptions {
  /** Where to root the walk. Defaults to the sandbox cwd. */
  root: string;
  /** Glob-shaped patterns to exclude. Default: node_modules + .git/objects/pack
   *  so the output stays compact even when a long-lived session has
   *  installed dependencies. */
  exclude?: readonly string[];
  /** Gzip compression level 1-9. Default 6. */
  compressionLevel?: number;
}

const DEFAULT_EXCLUDES = ["node_modules", ".git/objects/pack"];

export async function vfsToTarball(
  fs: PieboxFS,
  options: VfsToTarballOptions,
): Promise<Uint8Array> {
  // Dynamic import so the module-level evaluation of this file (e.g.
  // when a browser bundle imports `piebox/layer2` for the Sandbox /
  // tool types) doesn't reach `node:zlib`. On Node this is a single
  // resolved-module lookup; in the browser it throws at call time,
  // which is the right behavior for `toTarball` running where there's
  // no zlib.
  const { gzipSync } = await import("node:zlib");

  const { root, exclude = DEFAULT_EXCLUDES, compressionLevel = 6 } = options;

  const entries: Array<{ path: string; content: Buffer }> = [];
  collect(fs, root, root, exclude, entries);

  const blocks: Buffer[] = [];
  for (const entry of entries) {
    blocks.push(createHeader(entry.path, entry.content.length));
    blocks.push(entry.content);
    const remainder = entry.content.length % 512;
    if (remainder > 0) blocks.push(Buffer.alloc(512 - remainder));
  }
  // End-of-archive: two 512-byte zero blocks.
  blocks.push(Buffer.alloc(1024));

  const tarBuffer = Buffer.concat(blocks);
  const gz = gzipSync(tarBuffer, { level: compressionLevel });
  // Hand back a Uint8Array — Buffer in Node is one already, but
  // typing it loosely makes the browser case work too.
  return new Uint8Array(gz.buffer, gz.byteOffset, gz.byteLength);
}

/** Recursive walk over the VFS. Collects regular files only; the
 *  tar format we write here doesn't model directories or symlinks. */
function collect(
  fs: PieboxFS,
  root: string,
  dir: string,
  exclude: readonly string[],
  out: Array<{ path: string; content: Buffer }>,
): void {
  let entries: { name: string; isDirectory(): boolean }[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true }) as unknown as {
      name: string;
      isDirectory(): boolean;
    }[];
  } catch {
    return;
  }
  for (const ent of entries) {
    const full = dir === "/" ? `/${ent.name}` : `${dir}/${ent.name}`;
    const rel = relpath(root, full);
    if (matchesExclude(rel, exclude)) continue;
    if (ent.isDirectory()) {
      collect(fs, root, full, exclude, out);
    } else {
      try {
        const raw = fs.readFileSync(full);
        out.push({ path: rel, content: Buffer.from(raw) });
      } catch {
        // Skip unreadable files rather than fail the whole pack.
      }
    }
  }
}

function relpath(root: string, full: string): string {
  if (full === root) return ".";
  if (full.startsWith(root + "/")) return full.slice(root.length + 1);
  // Outside the root; emit the absolute path. Should be rare —
  // collect() walks from root downward.
  return full;
}

/** Plain prefix match for now. A real glob matcher would handle
 *  `*` / `**`; the two defaults are simple prefixes so this is
 *  sufficient. */
function matchesExclude(path: string, patterns: readonly string[]): boolean {
  for (const p of patterns) {
    if (path === p) return true;
    if (path.startsWith(p + "/")) return true;
  }
  return false;
}

// ── Tar header block ─────────────────────────────────────────────────────
// POSIX ustar format — same algorithm as src/cli/tar.ts, kept in
// sync by structural similarity rather than shared import (the CLI
// version is locked to node:fs streams; this version pulls from the
// VFS). If a divergence shows up, the two should be unified into a
// pure-buffer helper both files import.

function createHeader(filePath: string, size: number): Buffer {
  const header = Buffer.alloc(512);

  // name (0-99, 100 bytes)
  const name = filePath.length <= 100 ? filePath : filePath.slice(-100);
  header.write(name, 0, 100, "utf-8");

  // mode (100-107)
  header.write("0000644\0", 100, 8, "utf-8");

  // uid (108-115)
  header.write("0001000\0", 108, 8, "utf-8");

  // gid (116-123)
  header.write("0001000\0", 116, 8, "utf-8");

  // size (124-135, octal)
  header.write(size.toString(8).padStart(11, "0") + "\0", 124, 12, "utf-8");

  // mtime (136-147, octal seconds since epoch)
  const mtime = Math.floor(Date.now() / 1000);
  header.write(mtime.toString(8).padStart(11, "0") + "\0", 136, 12, "utf-8");

  // checksum placeholder (148-155, spaces)
  header.write("        ", 148, 8, "utf-8");

  // typeflag (156) — '0' = regular file
  header.write("0", 156, 1, "utf-8");

  // magic (257-262) — ustar format
  header.write("ustar\0", 257, 6, "utf-8");

  // version (263-264)
  header.write("00", 263, 2, "utf-8");

  // Handle paths > 100 chars using prefix field (345-499, 155 bytes)
  if (filePath.length > 100) {
    const prefix = filePath.slice(0, filePath.length - 100);
    header.write(prefix.slice(0, 155), 345, 155, "utf-8");
  }

  // Calculate and write checksum
  let checksum = 0;
  for (let i = 0; i < 512; i++) {
    checksum += header[i]!;
  }
  header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8, "utf-8");

  return header;
}
