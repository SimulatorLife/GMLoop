import * as Graph from "./graph/index.js";

type UINamespace = typeof Graph & {
    Graph: typeof Graph;
};

/**
 * Public UI workspace namespace for cross-project renderers and view surfaces.
 */
export const UI: UINamespace = Object.freeze({
    ...Graph,
    Graph
});
