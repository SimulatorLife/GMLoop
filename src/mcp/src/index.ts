// Import the server module as a namespace so its members are flattened into
// the public `Mcp` namespace without becoming named exports at this layer.
// Mirrors the import/namespace pattern used by sibling workspaces
// (`@gmloop/core`, `@gmloop/parser`, `@gmloop/transpiler`, `@gmloop/semantic`).
import * as Server from "./server/index.js";

/**
 * Public MCP workspace namespace that exposes the GMLoop MCP server,
 * stdio entrypoint, tool/resource helpers, and shared metadata for
 * cross-workspace consumers.
 *
 * Flattened into a single frozen object so callers can access server
 * helpers directly (e.g. `Mcp.createGmloopMcpServer`) without reaching
 * into the internal `server/` subdirectory.
 */
export const Mcp = Object.freeze({
    ...Server
});

// Re-export the public metadata type so consumers can import it from the
// package root without having to navigate the nested `server` module.
export type { GmloopMcpServerMetadata } from "./server/index.js";
