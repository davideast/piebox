/**
 * Browser backend for PieboxFS — wraps almostnode's VirtualFS.
 *
 * almostnode's VirtualFS implements most of the sync node:fs surface piebox
 * needs, but has known gaps documented in docs/almostnode-findings.md. This
 * adapter fills them:
 *
 *   • readdirSync({ withFileTypes: true }) is synthesized via statSync.
 *   • readFileSync / writeFileSync accept the options-object encoding form.
 *   • appendFileSync is implemented as read+concat+write.
 *   • symlinkSync / readlinkSync throw a clean ENOSYS — almostnode has no
 *     symlinks, and piebox does not need them in Scenario A.
 *
 * piebox does NOT import almostnode directly here: the adapter accepts any
 * object that implements `AlmostnodeVirtualFsLike`. The browser entrypoint
 * (or a consumer) constructs the almostnode container and passes its `vfs`
 * to `createBrowserFs`. This keeps almostnode out of the Node code path.
 */

import type {
  PieboxFS,
  PieboxFsDirent,
  PieboxFsEncoding,
  PieboxFsMkdirOptions,
  PieboxFsReaddirOptions,
  PieboxFsReadOptions,
  PieboxFsStats,
  PieboxFsWriteOptions,
} from "./types.js";

/**
 * Structural type matching almostnode's `VirtualFS`. Defined here so piebox
 * does not have a hard import of `almostnode` in its type graph.
 */
export interface AlmostnodeVirtualFsLike {
  existsSync(path: string): boolean;
  statSync(path: string): PieboxFsStats;
  lstatSync(path: string): PieboxFsStats;
  accessSync(path: string, mode?: number): void;
  realpathSync(path: string): string;
  readFileSync(path: string): Uint8Array;
  readFileSync(path: string, encoding: PieboxFsEncoding): string;
  writeFileSync(path: string, data: string | Uint8Array): void;
  mkdirSync(path: string, options?: { recursive?: boolean }): void;
  readdirSync(path: string): string[];
  unlinkSync(path: string): void;
  rmdirSync(path: string): void;
  renameSync(oldPath: string, newPath: string): void;
  copyFileSync(src: string, dest: string): void;
}

function normalizeEncoding(
  options: PieboxFsReadOptions | PieboxFsWriteOptions,
): PieboxFsEncoding | undefined {
  if (typeof options === "string") return options;
  if (options && typeof options === "object") {
    const enc = options.encoding;
    if (enc === "utf-8" || enc === "utf8") return enc;
  }
  return undefined;
}

function normalizeData(data: string | Uint8Array): string | Uint8Array {
  // If a Node Buffer leaks in from a caller, it's already a Uint8Array;
  // almostnode handles both branches of `typeof data === "string"` itself.
  return data;
}

function notSupported(op: string, path: string): never {
  const err = new Error(
    `ENOSYS: ${op} is not supported by the browser FS backend, path '${path}'`,
  ) as Error & { code: string; syscall: string; path: string };
  err.code = "ENOSYS";
  err.syscall = op;
  err.path = path;
  throw err;
}

export interface BrowserBackendOptions {
  /**
   * The `VirtualFS` instance from `almostnode`. Typically obtained via
   * `createContainer()` from almostnode.
   */
  source: AlmostnodeVirtualFsLike;
}

/**
 * Wrap an almostnode VirtualFS so it conforms to the PieboxFS interface.
 */
export function createBrowserFs(options: BrowserBackendOptions): PieboxFS {
  const src = options.source;

  function readFileSyncImpl(
    path: string,
    opts?: PieboxFsReadOptions,
  ): string | Uint8Array {
    const enc = normalizeEncoding(opts);
    if (enc) {
      return src.readFileSync(path, enc);
    }
    return src.readFileSync(path);
  }

  function readdirSyncImpl(
    path: string,
    opts?: PieboxFsReaddirOptions,
  ): string[] | PieboxFsDirent[] {
    const names = src.readdirSync(path);
    if (!opts?.withFileTypes) return names;
    const sep = path.endsWith("/") ? "" : "/";
    return names.map((name): PieboxFsDirent => {
      let stat: PieboxFsStats | undefined;
      try {
        stat = src.statSync(`${path}${sep}${name}`);
      } catch {
        // Entry vanished between readdir and stat; report as plain file.
      }
      const isFile = stat?.isFile() ?? false;
      const isDir = stat?.isDirectory() ?? false;
      return {
        name,
        isFile: () => isFile,
        isDirectory: () => isDir,
        isSymbolicLink: () => false,
      };
    });
  }

  function writeFileSyncImpl(
    path: string,
    data: string | Uint8Array,
    _options?: PieboxFsWriteOptions,
  ): void {
    // almostnode's writeFileSync takes only (path, data); encoding is implicit
    // UTF-8 for strings. The options arg is accepted for API compatibility and
    // ignored — there is no other behavior available.
    src.writeFileSync(path, normalizeData(data));
  }

  function appendFileSyncImpl(
    path: string,
    data: string | Uint8Array,
    options?: PieboxFsWriteOptions,
  ): void {
    let existing: Uint8Array = new Uint8Array(0);
    if (src.existsSync(path)) {
      const cur = src.readFileSync(path);
      existing = cur instanceof Uint8Array ? cur : new TextEncoder().encode(cur);
    }
    const incoming =
      typeof data === "string" ? new TextEncoder().encode(data) : data;
    const combined = new Uint8Array(existing.length + incoming.length);
    combined.set(existing, 0);
    combined.set(incoming, existing.length);
    void options;
    src.writeFileSync(path, combined);
  }

  function mkdirSyncImpl(path: string, opts?: PieboxFsMkdirOptions): void {
    src.mkdirSync(path, opts ? { recursive: opts.recursive } : undefined);
  }

  const fs: PieboxFS = {
    existsSync: (p) => src.existsSync(p),
    statSync: (p) => src.statSync(p),
    lstatSync: (p) => src.lstatSync(p),
    accessSync: (p, mode) => src.accessSync(p, mode),
    realpathSync: (p) => src.realpathSync(p),

    readFileSync: readFileSyncImpl as PieboxFS["readFileSync"],
    readdirSync: readdirSyncImpl as PieboxFS["readdirSync"],

    writeFileSync: writeFileSyncImpl,
    appendFileSync: appendFileSyncImpl,
    mkdirSync: mkdirSyncImpl,
    unlinkSync: (p) => src.unlinkSync(p),
    rmdirSync: (p) => src.rmdirSync(p),
    renameSync: (a, b) => src.renameSync(a, b),
    copyFileSync: (a, b) => src.copyFileSync(a, b),

    readlinkSync: (p) => notSupported("readlink", p),
    symlinkSync: (_t, p) => notSupported("symlink", p),
  };

  return fs;
}
