// Public facade for the macro-expansion domain.
//
// The transpiler workspace organizes its sibling domains (`api/`, `emitter/`,
// `event-context/`) behind `index.ts` barrels so that consumers can import
// each domain's exports without reaching into individual implementation files.
// `macro-expansion` previously lived as a flat file directly under `src/` and
// was imported via `"./macro-expansion.js"`, which broke the convention and
// forced every consumer to know the implementation file by name. The barrel
// re-exports the same public surface so callers can move from
// `from "../macro-expansion.js"` to `from "../macros/index.js"` (or
// `from "../macros/macro-expansion.js"` when only the file path is needed).
export * from "./macro-expansion.js";
