/**
 * Runtime hook for piebox — dispatches shell-style commands (node/npm) into
 * a sandbox runtime. Today only the browser binding (almostnode) is wired;
 * a Node-side binding around just-bash will land alongside the agent-tool
 * integration in a follow-up task.
 *
 * See docs/almostnode-findings.md §9 for the contract rationale.
 */

export type {
  PieboxRuntime,
  PieboxRunOptions,
  PieboxRunResult,
} from "./types.js";

export {
  createBrowserRuntime,
  type AlmostnodeContainerLike,
  type CreateBrowserRuntimeOptions,
} from "./browser.js";
