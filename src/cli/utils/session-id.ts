/**
 * Session ID generator — chronologically sortable, unique per run.
 *
 * Format: `<sandbox>-<timestamp-base36>-<random>`
 *
 * Properties:
 * - Sorts chronologically via string comparison (ls, glob, etc.)
 * - Unique across concurrent runs (random suffix)
 * - Human-scannable (timestamp is readable, not opaque)
 *
 * @example
 * ```
 * sessionId("hnpwa-api")
 * // → "hnpwa-api-m3k8x2q0-a1b2"
 * ```
 */

const RANDOM_CHARS = "0123456789abcdefghijklmnopqrstuvwxyz";
const RANDOM_LENGTH = 4;

/**
 * Generate a chronologically sortable session ID.
 *
 * @param sandboxName - The sandbox this session belongs to.
 * @returns A unique session ID like `hnpwa-api-m3k8x2q0-a1b2`.
 */
export function sessionId(sandboxName: string): string {
  const timestamp = Date.now().toString(36);
  let random = "";
  for (let i = 0; i < RANDOM_LENGTH; i++) {
    random += RANDOM_CHARS[Math.floor(Math.random() * RANDOM_CHARS.length)];
  }
  return `${sandboxName}-${timestamp}-${random}`;
}

/**
 * Extract the sandbox name from a session ID.
 *
 * @example
 * ```
 * sandboxFromSessionId("hnpwa-api-m3k8x2q0-a1b2")
 * // → "hnpwa-api"
 * ```
 */
export function sandboxFromSessionId(id: string): string {
  // Session ID format: <name>-<timestamp>-<random>
  // Timestamp is base36 (8+ chars), random is 4 chars
  // Split from the right: last part is random, second-to-last is timestamp
  const parts = id.split("-");
  if (parts.length < 3) return id;
  // Remove last two segments (random + timestamp)
  return parts.slice(0, -2).join("-");
}
