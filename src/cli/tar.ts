/**
 * Minimal tar.gz read/write using only Node.js built-ins.
 *
 * Tar format: 512-byte header blocks + file data padded to 512-byte boundaries.
 * We use POSIX ustar format for compatibility.
 *
 * Only handles regular files (no symlinks, directories, or special types).
 * This is sufficient for VFS snapshots where every entry is a file.
 */

import { createGzip, createGunzip } from "node:zlib";
import * as fs from "node:fs";
import { pipeline } from "node:stream/promises";
import { Readable, Writable } from "node:stream";

export interface TarEntry {
  path: string;
  content: Buffer;
}

// ── Write ──────────────────────────────────────────────────────────────────

/**
 * Write entries to a tar.gz file.
 */
export async function writeTarGz(filePath: string, entries: TarEntry[]): Promise<void> {
  const blocks: Buffer[] = [];

  for (const entry of entries) {
    blocks.push(createHeader(entry.path, entry.content.length));
    blocks.push(entry.content);

    // Pad to 512-byte boundary
    const remainder = entry.content.length % 512;
    if (remainder > 0) {
      blocks.push(Buffer.alloc(512 - remainder));
    }
  }

  // End-of-archive marker: two 512-byte zero blocks
  blocks.push(Buffer.alloc(1024));

  const tarBuffer = Buffer.concat(blocks);
  const readable = Readable.from(tarBuffer);
  const gzip = createGzip({ level: 6 });
  const writable = fs.createWriteStream(filePath);

  await pipeline(readable, gzip, writable);
}

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

// ── Read ───────────────────────────────────────────────────────────────────

/**
 * Read entries from a tar.gz file.
 */
export async function readTarGz(filePath: string): Promise<TarEntry[]> {
  const tarBuffer = await decompress(filePath);
  return parseTar(tarBuffer);
}

async function decompress(filePath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const readable = fs.createReadStream(filePath);
    const gunzip = createGunzip();

    readable.pipe(gunzip);
    gunzip.on("data", (chunk: Buffer) => chunks.push(chunk));
    gunzip.on("end", () => resolve(Buffer.concat(chunks)));
    gunzip.on("error", reject);
    readable.on("error", reject);
  });
}

function parseTar(buf: Buffer): TarEntry[] {
  const entries: TarEntry[] = [];
  let offset = 0;

  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);

    // Check for end-of-archive (all zeros)
    if (header.every(b => b === 0)) break;

    // Read file name
    let name = header.subarray(0, 100).toString("utf-8").replace(/\0+$/, "");

    // Check for prefix (ustar long paths)
    const prefix = header.subarray(345, 500).toString("utf-8").replace(/\0+$/, "");
    if (prefix) {
      name = prefix + name;
    }

    // Read size (octal)
    const sizeStr = header.subarray(124, 136).toString("utf-8").replace(/\0+$/, "").trim();
    const size = parseInt(sizeStr, 8) || 0;

    // Read typeflag
    const typeflag = String.fromCharCode(header[156]!);

    offset += 512; // move past header

    // Only extract regular files
    if ((typeflag === "0" || typeflag === "\0") && size > 0 && name) {
      const content = buf.subarray(offset, offset + size);
      entries.push({ path: name, content: Buffer.from(content) });
    }

    // Skip past file data (padded to 512)
    offset += Math.ceil(size / 512) * 512;
  }

  return entries;
}
