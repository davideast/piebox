/**
 * PieboxFS — the minimal node:fs-style surface piebox depends on.
 *
 * Both backends implement this:
 *   • Node backend wraps `@platformatic/vfs` (which is already this shape).
 *   • Browser backend wraps `almostnode`'s `VirtualFS` (which is mostly this shape;
 *     a thin adapter fills the gaps — see docs/almostnode-findings.md).
 *
 * The surface is the intersection of what piebox actually calls (audited from the
 * codebase) and what both backends can support. It is deliberately sync — piebox's
 * tools, adapters, and skill loader are all sync.
 *
 * Optional members (`readlinkSync?`, `symlinkSync?`, `appendFileSync?`) are present
 * on the Node backend but may throw on the browser backend. Callers that need them
 * must be Node-only or handle the absence.
 */

export interface PieboxFsStats {
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
  size: number;
  mode: number;
  mtime: Date;
}

export interface PieboxFsDirent {
  name: string;
  isFile(): boolean;
  isDirectory(): boolean;
  isSymbolicLink(): boolean;
}

export type PieboxFsEncoding = "utf-8" | "utf8";

export type PieboxFsReadOptions =
  | PieboxFsEncoding
  | { encoding?: PieboxFsEncoding | null }
  | undefined;

export type PieboxFsWriteOptions =
  | PieboxFsEncoding
  | { encoding?: PieboxFsEncoding | null }
  | undefined;

export interface PieboxFsMkdirOptions {
  recursive?: boolean;
  mode?: number;
}

export interface PieboxFsReaddirOptions {
  withFileTypes?: boolean;
}

export interface PieboxFS {
  // ─── Reads ─────────────────────────────────────────────────────────────
  existsSync(path: string): boolean;
  statSync(path: string): PieboxFsStats;
  lstatSync(path: string): PieboxFsStats;
  accessSync(path: string, mode?: number): void;
  realpathSync(path: string): string;

  readFileSync(path: string): Uint8Array;
  readFileSync(path: string, encoding: PieboxFsEncoding): string;
  readFileSync(
    path: string,
    options: { encoding: PieboxFsEncoding },
  ): string;
  readFileSync(
    path: string,
    options?: PieboxFsReadOptions,
  ): string | Uint8Array;

  readdirSync(path: string): string[];
  readdirSync(
    path: string,
    options: { withFileTypes: true },
  ): PieboxFsDirent[];
  readdirSync(
    path: string,
    options?: PieboxFsReaddirOptions,
  ): string[] | PieboxFsDirent[];

  // ─── Writes ────────────────────────────────────────────────────────────
  writeFileSync(
    path: string,
    data: string | Uint8Array,
    options?: PieboxFsWriteOptions,
  ): void;

  mkdirSync(path: string, options?: PieboxFsMkdirOptions): void;
  unlinkSync(path: string): void;
  rmdirSync(path: string): void;
  renameSync(from: string, to: string): void;
  copyFileSync(src: string, dest: string): void;

  // ─── Optional (Node-only or unreliable in browser) ────────────────────
  appendFileSync?(
    path: string,
    data: string | Uint8Array,
    options?: PieboxFsWriteOptions,
  ): void;
  readlinkSync?(path: string): string;
  symlinkSync?(target: string, path: string): void;
}

/**
 * Back-compat alias. The `VirtualFileSystem` name was previously imported from
 * `@platformatic/vfs`; piebox internals now depend on `PieboxFS` instead so the
 * type works for either backend.
 */
export type VirtualFileSystem = PieboxFS;
