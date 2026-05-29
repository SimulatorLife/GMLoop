import * as API from "./api/index.js";
import * as Emitter from "./emitter/index.js";

export const Transpiler = Object.freeze({
    ...API,
    ...Emitter
});

// Re-export TranspilerError and TranspilerErrorCode from the public API surface
// (api/index.ts → api/errors.ts). These are already flattened into the Transpiler
// namespace via the spread of `...API` above, but a direct named export is also
// provided for callers who prefer explicit import over namespace access.
// The api/index.ts re-export is the canonical source of truth; this file is the
// package entry-point and delegates ownership to the API layer without duplicating
// the export declaration.
export type {
    ClosurePatch,
    EventPatch,
    GmlTranspiler,
    ScriptPatch,
    TranspileClosureRequest,
    TranspileEventRequest,
    TranspilerDependencies,
    TranspileScriptRequest
} from "./api/index.js";
export { TranspilerError, TranspilerErrorCode } from "./api/index.js";
