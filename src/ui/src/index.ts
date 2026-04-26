import * as Graph from "./graph/index.js";
import * as Surfaces from "./surfaces/index.js";

type UINamespace = typeof Graph & {
    Graph: typeof Graph;
    Surfaces: typeof Surfaces;
};

/**
 * Public UI workspace namespace for cross-project renderers and view surfaces.
 */
export const UI: UINamespace = Object.freeze({
    ...Graph,
    ...Surfaces,
    Graph,
    Surfaces
});
