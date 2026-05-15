/**
 * Secrets — sourcing, resolution, and scrubbing.
 *
 * Two injection modes with different security properties:
 *
 *   **Expose** — agent sees the raw value in `process.env`.
 *   Values are scrubbed from all output as defense-in-depth.
 *
 *   **Broker** — credentials injected at the network boundary.
 *   Agent never sees the raw value. Preferred for HTTP auth.
 *
 * @example
 * ```ts
 * // Shorthand: expose only (reads from process.env)
 * secrets: ['OPENAI_API_KEY']
 *
 * // Full: expose + broker
 * secrets: {
 *   expose: ['OPENAI_API_KEY'],
 *   broker: {
 *     'https://api.github.com': {
 *       Authorization: `Bearer ${ghToken}`,
 *     },
 *   },
 * }
 * ```
 */

// ─── Public Types ───────────────────────────────────────────────────────────

/**
 * Secrets configuration — two injection modes.
 *
 * Shorthand: `string[]` exposes process.env vars.
 * Full form: separate `expose` and `broker` config.
 */
export type SecretsConfig = string[] | SecretsFullConfig;

export interface SecretsFullConfig {
  /**
   * Secrets the agent can access as `process.env.NAME`.
   *
   * The agent has the raw value — it can log, write, or exfiltrate it.
   * Output scrubbing is applied automatically as defense-in-depth.
   *
   * - `string[]` — reads values from host `process.env` at creation time.
   * - `Record<string, string>` — explicit name→value (for vaults, keychains).
   */
  expose?: string[] | Record<string, string>;

  /**
   * Credentials injected at the network boundary.
   *
   * The agent never sees these values. When the agent makes a request
   * to a matching origin, headers are added by the host automatically.
   *
   * Brokered origins are automatically added to the network allowlist.
   *
   * @example
   * ```ts
   * broker: {
   *   'https://api.github.com': {
   *     Authorization: 'Bearer ghp_...',
   *     'User-Agent': 'piebox-sandbox',
   *   },
   * }
   * ```
   */
  broker?: Record<string, Record<string, string>>;
}

// ─── Resolved Secrets ───────────────────────────────────────────────────────

/** Resolved secrets — the output of `resolveSecrets()`. */
export interface ResolvedSecrets {
  /** Secrets exposed to agent code as process.env.NAME → value. */
  expose: Map<string, string>;
  /** Origin → headers map for credential brokering at the network boundary. */
  broker: Map<string, Record<string, string>>;
}

/**
 * Resolve a `SecretsConfig` into concrete maps.
 *
 * - `string[]` shorthand reads from `process.env` at call time.
 * - Full config resolves both `expose` and `broker`.
 * - Missing env vars are silently skipped (no error).
 */
export function resolveSecrets(config?: SecretsConfig): ResolvedSecrets {
  const expose = new Map<string, string>();
  const broker = new Map<string, Record<string, string>>();

  if (!config) return { expose, broker };

  // Shorthand: string[] → expose from process.env
  if (Array.isArray(config)) {
    for (const name of config) {
      const value = process.env[name];
      if (value !== undefined) {
        expose.set(name, value);
      }
    }
    return { expose, broker };
  }

  // Full config: expose
  if (config.expose) {
    if (Array.isArray(config.expose)) {
      for (const name of config.expose) {
        const value = process.env[name];
        if (value !== undefined) {
          expose.set(name, value);
        }
      }
    } else {
      for (const [name, value] of Object.entries(config.expose)) {
        expose.set(name, value);
      }
    }
  }

  // Full config: broker
  if (config.broker) {
    for (const [origin, headers] of Object.entries(config.broker)) {
      broker.set(origin, headers);
    }
  }

  return { expose, broker };
}

// ─── Scrubber ───────────────────────────────────────────────────────────────

/**
 * Minimum secret length to register for scrubbing.
 * Short values cause too many false positives in output.
 */
const MIN_SECRET_LENGTH = 8;

/** Escape special regex characters in a string. */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Scrubs exposed secret values from output strings.
 *
 * Applied at every output boundary:
 * - Terminal stdout/stderr
 * - Markdown session logs
 * - JSONL event streams
 * - VFS → tar.gz snapshots
 * - Outbound request URLs (throws instead of scrubbing)
 */
export class SecretsScrubber {
  private patterns: Array<{ name: string; regex: RegExp }> = [];

  /**
   * Register a secret value for scrubbing.
   * Values under 8 characters are silently skipped (too many false positives).
   */
  register(name: string, value: string): void {
    if (value.length < MIN_SECRET_LENGTH) return;
    this.patterns.push({
      name,
      regex: new RegExp(escapeRegex(value), "g"),
    });
  }

  /** Replace secret values with `[NAME]` in text output. */
  scrub(text: string): string {
    let result = text;
    for (const { name, regex } of this.patterns) {
      result = result.replace(regex, `[${name}]`);
      regex.lastIndex = 0;
    }
    return result;
  }

  /**
   * Reject URLs containing raw secret values.
   * Throws an error — if a secret appears in a URL, it's a bug.
   */
  checkUrl(url: string): void {
    for (const { name, regex } of this.patterns) {
      if (regex.test(url)) {
        regex.lastIndex = 0;
        throw new Error(
          `Secret "${name}" detected in request URL. ` +
            `Use secrets.broker instead of secrets.expose for HTTP auth.`,
        );
      }
      regex.lastIndex = 0;
    }
  }

  /** Returns true if any secrets are registered for scrubbing. */
  get active(): boolean {
    return this.patterns.length > 0;
  }

  /** Number of registered secret patterns. */
  get size(): number {
    return this.patterns.length;
  }
}

// ─── Bootstrap Generation ───────────────────────────────────────────────────

/**
 * Generate QuickJS bootstrap code that injects exposed secrets
 * into `globalThis.process.env`.
 *
 * @param expose - Map of secret name → value
 * @param cwd - Virtual working directory for process.cwd()
 */
export function generateBootstrap(
  expose: Map<string, string>,
  cwd: string,
): string {
  if (expose.size === 0) return "";

  const envEntries = Array.from(expose.entries())
    .map(([k, v]) => `    ${JSON.stringify(k)}: ${JSON.stringify(v)}`)
    .join(",\n");

  return `
globalThis.process = Object.assign(globalThis.process || {}, {
  env: Object.assign((globalThis.process || {}).env || {}, {
${envEntries}
  }),
  version: 'v22.0.0',
  platform: 'linux',
  cwd: function() { return ${JSON.stringify(cwd)}; },
});
`.trim();
}
