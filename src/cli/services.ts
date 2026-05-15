// ── Lazy service loader ─────────────────────────────────────────────────────
// Heavy imports (SDK, VFS, isomorphic-git) only load when a command runs,
// not when --help is printed.

export interface Services {
  manager: any;
  run: any;
  clone: any;
  commit: any;
  export: any;
}

let _services: Services;

export async function initServices(): Promise<Services> {
  if (_services) return _services;

  const { SandboxManager } = await import("./sandbox-manager.js");
  const { CloneHandler } = await import("./services/clone/handler.js");
  const { CommitHandler } = await import("./services/commit/handler.js");
  const { ExportHandler } = await import("./services/export/handler.js");
  const { RunHandler } = await import("./services/run/handler.js");

  const manager = new SandboxManager();
  const clone = new CloneHandler(manager);
  const commit = new CommitHandler(manager);
  const exp = new ExportHandler(manager);
  const run = new RunHandler(clone, commit, exp, manager);

  _services = { manager, run, clone, commit, export: exp };
  return _services;
}
