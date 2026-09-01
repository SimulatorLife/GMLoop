#!/usr/bin/env node
/**
 * MCP stdio entrypoint.
 *
 * Importing the MCP server statically is safe because the CLI now auto-runs
 * only when its own compiled entrypoint is the process entrypoint. The MCP
 * binary therefore no longer needs to mutate a CLI skip environment variable
 * or use dynamic import ordering as a hidden control-flow hook.
 */
import { runGmloopMcpStdioServer } from "./server/index.js";

await runGmloopMcpStdioServer();
