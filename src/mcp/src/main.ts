#!/usr/bin/env node
// Set the skip flag BEFORE importing anything to prevent CLI auto-run
process.env.PRETTIER_PLUGIN_GML_SKIP_CLI_RUN = "1";

// Use dynamic import to ensure env var is set before module evaluation
const { runGmloopMcpStdioServer } = await import("./server/index.js");
await runGmloopMcpStdioServer();
