import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { createGmloopMcpServer, listGmloopMcpToolCatalogEntries, listGmloopMcpToolNames } from "../src/server/index.js";

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
    assert.ok(toolNames.includes("gmloop_graph_doctor"));
    assert.ok(toolNames.includes("gmloop_graph_visualize"));
    assert.ok(toolNames.includes("gmloop_symbol_inspect"));
    assert.ok(toolNames.includes("gmloop_symbol_context"));
    assert.ok(toolNames.includes("gmloop_symbol_neighbors"));
    assert.ok(toolNames.includes("gmloop_symbol_usages"));
    assert.ok(!toolNames.includes("gmloop_graph_symbol"));
    assert.ok(!toolNames.includes("gmloop_graph_context"));
    assert.ok(!toolNames.includes("gmloop_graph_neighbors"));
    assert.ok(!toolNames.includes("gmloop_graph_usages"));
    assert.ok(toolNames.includes("gmloop_resource_add"));
    assert.ok(toolNames.includes("gmloop_resource_remove"));
    assert.ok(toolNames.includes("gmloop_resource_list"));
    assert.ok(toolNames.includes("gmloop_resource_find"));
    assert.ok(toolNames.includes("gmloop_resource_inspect"));
    assert.ok(toolNames.includes("gmloop_resource_deps"));
    assert.ok(toolNames.includes("gmloop_resource_dependents"));
    assert.ok(toolNames.includes("gmloop_resource_audit"));
    assert.ok(toolNames.includes("gmloop_resource_rename"));
    assert.ok(toolNames.includes("gmloop_resource_duplicate"));
    assert.ok(toolNames.includes("gmloop_resource_move"));
    assert.ok(toolNames.includes("gmloop_runner_start"));
    assert.ok(toolNames.includes("gmloop_runner_stop"));
    assert.ok(toolNames.includes("gmloop_runner_restart"));
    assert.ok(toolNames.includes("gmloop_runner_pause"));
    assert.ok(toolNames.includes("gmloop_runner_resume"));
    assert.ok(toolNames.includes("gmloop_runner_status"));
    assert.ok(toolNames.includes("gmloop_runner_logs"));
    assert.ok(toolNames.includes("gmloop_runner_clear_logs"));
    assert.ok(toolNames.includes("gmloop_runner_room_set"));
    assert.ok(toolNames.includes("gmloop_runner_room_current"));

    assert.ok(Object.hasOwn(server._registeredTools, "gmloop_graph_search"));
    assert.ok(Object.hasOwn(server._registeredTools, "gmloop_resource_add"));
    assert.ok(Object.hasOwn(server._registeredTools, "gmloop_resource_audit"));
    assert.ok(Object.hasOwn(server._registeredResources, "gm://graph/overview"));
    assert.ok(Object.hasOwn(server._registeredResourceTemplates, "graph-node"));
    assert.ok(Object.hasOwn(server._registeredResourceTemplates, "graph-context"));
});

void test("MCP tool catalog exports live tool fields derived from the CLI catalog", () => {
    const catalog = listGmloopMcpToolCatalogEntries();
    const formatTool = catalog.find((entry) => entry.toolName === "gmloop_format");
    assert.ok(formatTool);
    assert.equal(formatTool.commandDisplayName, "format");
    assert.match(formatTool.description, /Format GameMaker Language files/u);
    assert.ok(formatTool.fields.some((field) => field.name === "cwd"));
    assert.ok(formatTool.fields.some((field) => field.name === "--path"));
});
