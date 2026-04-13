import * as Server from "./server/index.js";

export const Mcp = Object.freeze({
    ...Server
});

export type { GmloopMcpServerMetadata } from "./server/index.js";
