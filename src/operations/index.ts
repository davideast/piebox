// Operation factories — concrete implementations over a PieboxFS / Bash.
export { createBashOperations } from "./bash.js";
export { createReadOperations } from "./read.js";
export { createWriteOperations } from "./write.js";
export { createEditOperations } from "./edit.js";
export { createGrepOperations } from "./grep.js";
export { createFindOperations } from "./find.js";
export { createLsOperations } from "./ls.js";

// Piebox-native operation type aliases. Structurally compatible with
// the equivalent types in `@earendil-works/pi-coding-agent` (Step 2 of
// the composable-sandbox migration plan — see
// docs/investigations/G-migration.md). The downstream Layer 2 surface
// types its substrate against these instead of the SDK types so the
// agent driver stops being a transitive dependency of `src/`.
export type {
  ReadOperations,
  WriteOperations,
  EditOperations,
  LsOperations,
  GrepOperations,
  FindOperations,
  BashOperations,
} from "./types.js";
