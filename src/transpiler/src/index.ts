import * as API from "./api/index.js";
import * as Emitter from "./emitter/index.js";

export const Transpiler = Object.freeze({
    ...API,
    ...Emitter
});

export { TranspilerError, TranspilerErrorCode } from "./api/errors.js";
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
