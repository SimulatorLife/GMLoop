import * as Graph from "./graph/index.js";
import * as GraphVisualizationBundle from "./graph/graph-visualization-bundle.js";
import * as Surfaces from "./surfaces/index.js";

/**
 * Public UI workspace namespace for cross-project renderers and view surfaces.
 *
 * The server-only graph visualization bundle renderer is composed here rather
 * than through the shared `graph` barrel so its Node-only dependencies
 * (`node:child_process`, `node:fs`, `node:path`) never leak into the browser
 * bundle that imports graph layout/viewport/type helpers from that barrel.
 */
export const UI = Object.freeze({
    ...Graph,
    ...GraphVisualizationBundle,
    ...Surfaces,
    Graph,
    Surfaces
});
