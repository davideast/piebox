import * as crypto from "node:crypto";

const ADJECTIVES = ["bold", "brave", "calm", "clever", "cool", "eager", "fierce", "gentle", "happy", "jolly", "kind", "lively", "proud", "quiet", "silly", "smart", "swift", "wild", "witty", "zealous"];
const NOUNS = ["bear", "bird", "cat", "dog", "fox", "frog", "goat", "hawk", "lion", "owl", "puma", "seal", "swan", "toad", "wolf", "crab", "deer", "duck", "fish", "moth"];

export function generateTripleName(): string {
  const adj1 = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const adj2 = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj1}-${adj2}-${noun}`;
}

export function generatePushId(): string {
  return crypto.randomBytes(8).toString("hex");
}

/** Resolve sandbox name from args or auto-generate. */
export function getName(args: Record<string, unknown>): string {
  if (typeof args.sandbox === "string" && args.sandbox.length > 0) return args.sandbox;
  return process.stdout.isTTY ? generateTripleName() : generatePushId();
}
