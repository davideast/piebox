#!/usr/bin/env node

// Suppress ExperimentalWarning for features we intentionally use (SQLite, TypeScript stripping)
const originalEmit = process.emit;
// @ts-ignore — patching process.emit to filter experimental warnings
process.emit = function (event: string, ...args: any[]) {
  if (event === "warning" && args[0]?.name === "ExperimentalWarning") {
    return false;
  }
  return originalEmit.apply(process, [event, ...args] as any);
};

import { runCli } from "./index.js";

runCli();
