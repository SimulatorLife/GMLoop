import * as Graph from "./graph/index.js";
import * as Surfaces from "./surfaces/index.js";

/**
 * Public UI workspace namespace for cross-project renderers and view surfaces.
 */
export const UI = Object.freeze({
    ...Graph,
    ...Surfaces,
    Graph,
    Surfaces
});
