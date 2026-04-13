import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { createGmloopMcpServer, listGmloopMcpToolNames } from "../src/server/index.js";

const WORKSPACE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

void test("MCP workspace scaffold declares the server package and plan", async () => {
    const packageJsonText = await readFile(path.join(WORKSPACE_ROOT, "package.json"), "utf8");
    const readmeText = await readFile(path.join(WORKSPACE_ROOT, "README.md"), "utf8");

    assert.match(packageJsonText, /"name": "@gmloop\/mcp"/);
    assert.match(packageJsonText, /"gmloop-mcp": "\.\/dist\/src\/main\.js"/);
    assert.match(readmeText, /## Full Implementation Plan/);
    assert.match(readmeText, /registerTool/);
    assert.match(readmeText, /gmloop_graph_search/);
});

void test("MCP server registers CLI-derived graph tools and graph resources", () => {
    const server = createGmloopMcpServer() as unknown as {
        _registeredResources: Record<string, unknown>;
        _registeredResourceTemplates: Record<string, unknown>;
        _registeredTools: Record<string, unknown>;
    };

    const toolNames = listGmloopMcpToolNames();
    assert.ok(toolNames.includes("gmloop_graph_index"));
    assert.ok(toolNames.includes("gmloop_graph_search"));
    assert.ok(toolNames.includes("gmloop_graph_context"));

    assert.ok(Object.hasOwn(server._registeredTools, "gmloop_graph_search"));
    assert.ok(Object.hasOwn(server._registeredResources, "gm://graph/overview"));
    assert.ok(Object.hasOwn(server._registeredResourceTemplates, "graph-node"));
    assert.ok(Object.hasOwn(server._registeredResourceTemplates, "graph-context"));
});
