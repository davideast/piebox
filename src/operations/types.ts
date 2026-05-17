/**
 * Piebox-native operation type aliases.
 *
 * Each of these mirrors the structural shape of the equivalent interface
 * in `@earendil-works/pi-coding-agent`'s `core/tools/` directory, so the
 * functions in this directory (`createReadOperations`, etc.) can return
 * a piebox-native type instead of an SDK type without any implementation
 * changes.
 *
 * Step 2 of the composable-sandbox migration plan (see
 * docs/investigations/G-migration.md) introduces these aliases so the
 * downstream Layer 2 surface can be typed against piebox-native shapes.
 * The SDK's equivalents stay valid; structural compatibility means a
 * value of one type is assignable to the other in both directions.
 *
 * No behavior is defined here — this is types only. The runtime
 * implementations live in `./read.ts`, `./write.ts`, etc.
 */

/**
 * Pluggable read-file operations. Implementations vary by substrate:
 * piebox's in-memory backend reads from a VFS; an SSH backend would
 * stream over the network; a fork could mount a real OS filesystem.
 */
export interface ReadOperations {
  /** Read a file's full contents as a Buffer. */
  readFile: (absolutePath: string) => Promise<Buffer>;
  /** Check that a file is readable. Throws (with an ENOENT-shaped
   *  error) when it isn't. */
  access: (absolutePath: string) => Promise<void>;
  /** Optional: detect an image MIME type from a path. Returns null
   *  or undefined for non-images. */
  detectImageMimeType?: (
    absolutePath: string,
  ) => Promise<string | null | undefined>;
}

/**
 * Pluggable write-file operations.
 */
export interface WriteOperations {
  /** Write `content` to `absolutePath`, replacing any existing content. */
  writeFile: (absolutePath: string, content: string) => Promise<void>;
  /** Create the directory at `dir` and any missing parents. */
  mkdir: (dir: string) => Promise<void>;
}

/**
 * Pluggable edit-file operations. Edits combine reads + writes plus an
 * access check so the tool can fail cleanly when the path isn't both
 * readable and writable.
 */
export interface EditOperations {
  readFile: (absolutePath: string) => Promise<Buffer>;
  writeFile: (absolutePath: string, content: string) => Promise<void>;
  access: (absolutePath: string) => Promise<void>;
}

/**
 * Pluggable directory-listing operations.
 *
 * The `stat` return is intentionally minimal: only `isDirectory()` is
 * required. Implementations may return a richer object — consumers
 * just won't see those fields through this contract.
 */
export interface LsOperations {
  /** Whether a path exists. May be sync or async. */
  exists: (absolutePath: string) => Promise<boolean> | boolean;
  /** Stat a path. Throws when the path does not exist. */
  stat: (
    absolutePath: string,
  ) =>
    | Promise<{ isDirectory: () => boolean }>
    | { isDirectory: () => boolean };
  /** Read directory entries (names only, no withFileTypes). */
  readdir: (absolutePath: string) => Promise<string[]> | string[];
}

/**
 * Pluggable grep operations. The default piebox implementation reads
 * each candidate file from the VFS; alternate backends might
 * delegate to ripgrep or a remote search service.
 */
export interface GrepOperations {
  /** Whether a path is a directory. Throws when the path does not exist. */
  isDirectory: (absolutePath: string) => Promise<boolean> | boolean;
  /** Read file contents as a string. Used for context-line rendering. */
  readFile: (absolutePath: string) => Promise<string> | string;
}

/**
 * Pluggable find operations.
 */
export interface FindOperations {
  /** Whether a path exists. */
  exists: (absolutePath: string) => Promise<boolean> | boolean;
  /** Resolve a glob pattern under `cwd`. Returns paths (relative or
   *  absolute — implementations don't have to agree). `options.ignore`
   *  is a list of glob patterns to exclude; `options.limit` caps the
   *  result count. */
  glob: (
    pattern: string,
    cwd: string,
    options: { ignore: string[]; limit: number },
  ) => Promise<string[]> | string[];
}

/**
 * Pluggable bash-style command execution. The signature mirrors the
 * just-bash + SDK shape: streamed output via `onData`, optional
 * abort/timeout/env. The return is a single object with the resolved
 * exit code (null when the process was killed by a signal).
 */
export interface BashOperations {
  exec: (
    command: string,
    cwd: string,
    options: {
      onData: (data: Buffer) => void;
      signal?: AbortSignal;
      timeout?: number;
      env?: NodeJS.ProcessEnv;
    },
  ) => Promise<{ exitCode: number | null }>;
}
