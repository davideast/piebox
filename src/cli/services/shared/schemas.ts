import { z } from "zod";

export const SandboxNameSchema = z
  .string()
  .min(1, "Sandbox name cannot be empty")
  .max(100, "Sandbox name is too long")
  .regex(/^[a-zA-Z0-9_-]+$/, "Sandbox name must contain only letters, numbers, hyphens, or underscores");

export const GitUrlSchema = z
  .string()
  .min(1, "URL cannot be empty")
  .refine((url) => url.startsWith("http://") || url.startsWith("https://") || url.startsWith("git@"), {
    message: "Must be an HTTP, HTTPS, or SSH Git URL",
  });

export const OutputPathSchema = z
  .string()
  .min(1, "Output path cannot be empty");
