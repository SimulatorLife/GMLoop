import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
    createGmloopMcpServer,
    extractGraphById,
    listGmloopMcpToolCatalogEntries,
    listGmloopMcpToolNames
} from "../src/server/index.js";

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
    assert.ok(toolNames.includes("gmloop_script_add"));
    assert.ok(toolNames.includes("gmloop_script_remove"));
    assert.ok(toolNames.includes("gmloop_script_inspect"));
    assert.ok(toolNames.includes("gmloop_script_update"));
    assert.ok(toolNames.includes("gmloop_script_rename"));
    assert.ok(toolNames.includes("gmloop_script_duplicate"));
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
    assert.ok(!toolNames.includes("gmloop_mcp"));

    assert.ok(toolNames.includes("gmloop_test_case_create"));
    assert.ok(toolNames.includes("gmloop_test_case_update"));

    assert.ok(Object.hasOwn(server._registeredTools, "gmloop_graph_search"));
    assert.ok(Object.hasOwn(server._registeredTools, "gmloop_script_add"));
    assert.ok(Object.hasOwn(server._registeredTools, "gmloop_script_remove"));
    assert.ok(Object.hasOwn(server._registeredTools, "gmloop_script_duplicate"));
    assert.ok(Object.hasOwn(server._registeredTools, "gmloop_test_case_create"));
    assert.ok(Object.hasOwn(server._registeredTools, "gmloop_test_case_update"));
    assert.ok(Object.hasOwn(server._registeredResources, "gm://graph/overview"));
    assert.ok(Object.hasOwn(server._registeredResourceTemplates, "graph-node"));
    assert.ok(Object.hasOwn(server._registeredResourceTemplates, "graph-context"));
});

void test("MCP tool catalog exposes test case create with correct arguments and options", () => {
    const catalog = listGmloopMcpToolCatalogEntries();
    const createTool = catalog.find((entry) => entry.toolName === "gmloop_test_case_create");
    assert.ok(createTool, "gmloop_test_case_create must appear in the MCP tool catalog");
    assert.equal(createTool.commandDisplayName, "test case create");

    const fieldNames = new Set(createTool.fields.map((field) => field.name));
    assert.ok(fieldNames.has("cwd"), "test case create must include cwd field");
    assert.ok(fieldNames.has("target"), "test case create must include target argument");
    assert.ok(fieldNames.has("name"), "test case create must include name argument");
    assert.ok(fieldNames.has("--expected"), "test case create must include --expected option");
    assert.ok(fieldNames.has("--write"), "test case create must include --write option");
    assert.ok(fieldNames.has("--path"), "test case create must include --path option");
    assert.ok(fieldNames.has("--json"), "test case create must include --json option");

    const targetField = createTool.fields.find((field) => field.name === "target");
    assert.ok(targetField);
    assert.equal(targetField.kind, "argument");
    assert.equal(targetField.required, true);
    assert.equal(targetField.valueType, "string");

    const writeField = createTool.fields.find((field) => field.name === "--write");
    assert.ok(writeField);
    assert.equal(writeField.kind, "option");
    assert.equal(writeField.valueType, "boolean");
});

void test("MCP tool catalog exposes test case update with correct arguments and options", () => {
    const catalog = listGmloopMcpToolCatalogEntries();
    const updateTool = catalog.find((entry) => entry.toolName === "gmloop_test_case_update");
    assert.ok(updateTool, "gmloop_test_case_update must appear in the MCP tool catalog");
    assert.equal(updateTool.commandDisplayName, "test case update");

    const fieldNames = new Set(updateTool.fields.map((field) => field.name));
    assert.ok(fieldNames.has("cwd"), "test case update must include cwd field");
    assert.ok(fieldNames.has("target"), "test case update must include target argument");
    assert.ok(fieldNames.has("name"), "test case update must include name argument");
    assert.ok(fieldNames.has("--expected"), "test case update must include --expected option");
    assert.ok(fieldNames.has("--write"), "test case update must include --write option");
    assert.ok(fieldNames.has("--path"), "test case update must include --path option");
    assert.ok(fieldNames.has("--json"), "test case update must include --json option");

    const targetField = updateTool.fields.find((field) => field.name === "target");
    assert.ok(targetField);
    assert.equal(targetField.kind, "argument");
    assert.equal(targetField.required, true);
    assert.equal(targetField.valueType, "string");

    const writeField = updateTool.fields.find((field) => field.name === "--write");
    assert.ok(writeField);
    assert.equal(writeField.kind, "option");
    assert.equal(writeField.valueType, "boolean");
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

void test("extractGraphById collapses the 3-segment chain into a single call", () => {
    // Simulates the shape returned by `graph doctor --json`.
    const envelope = {
        payload: {
            graphs: [
                { graphId: "project", nodeCount: 42, edgeCount: 7 },
                { graphId: "toolset", nodeCount: 3, edgeCount: 0 }
            ]
        }
    };

    const projectGraph = extractGraphById(envelope, "project");
    assert.ok(projectGraph);
    assert.equal(projectGraph.graphId, "project");
    assert.equal(projectGraph.nodeCount, 42);

    const toolsetGraph = extractGraphById(envelope, "toolset");
    assert.ok(toolsetGraph);
    assert.equal(toolsetGraph.graphId, "toolset");
    assert.equal(toolsetGraph.edgeCount, 0);

    // Absent graph id returns null without throwing.
    assert.equal(extractGraphById(envelope, "nonexistent"), null);

    // Empty graphs array returns null.
    assert.equal(extractGraphById({ payload: { graphs: [] } }, "project"), null);
});
