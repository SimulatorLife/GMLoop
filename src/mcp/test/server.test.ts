import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
    createGmloopMcpServer,
    extractGraphById,
    listGmloopMcpToolCatalogEntries,
    listGmloopMcpToolNames,
    parseCliJsonStdout,
    parseOptionalCliJsonStdout
} from "../src/server/index.js";

const WORKSPACE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

void test("MCP workspace scaffold declares the server package and plan", async () => {
    const packageJsonText = await readFile(path.join(WORKSPACE_ROOT, "package.json"), "utf8");
    const readmeText = await readFile(path.join(WORKSPACE_ROOT, "README.md"), "utf8");

    assert.match(packageJsonText, /"name": "@gmloop\/mcp"/);
    assert.match(packageJsonText, /"gmloop-mcp": "\.\/dist\/src\/main\.js"/);
    assert.match(readmeText, /## Contract/);
    assert.match(readmeText, /CLI-derived MCP contract/);
    assert.match(readmeText, /official `gm-cli` and ResourceTool behavior as a companion MCP surface/);
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

void test("MCP tool catalog exposes object event add from the CLI command catalog", () => {
    const catalog = listGmloopMcpToolCatalogEntries();
    const addTool = catalog.find((entry) => entry.toolName === "gmloop_object_event_add");
    assert.ok(addTool, "gmloop_object_event_add must appear in the MCP tool catalog");
    assert.equal(addTool.commandDisplayName, "object event add");

    const fieldNames = new Set(addTool.fields.map((field) => field.name));
    assert.ok(fieldNames.has("cwd"), "object event add must include cwd field");
    assert.ok(fieldNames.has("object"), "object event add must include object argument");
    assert.ok(fieldNames.has("event"), "object event add must include event argument");
    assert.ok(fieldNames.has("handler"), "object event add must include handler argument");
    assert.ok(fieldNames.has("--write"), "object event add must include --write option");
    assert.ok(fieldNames.has("--path"), "object event add must include --path option");
    assert.ok(fieldNames.has("--json"), "object event add must include --json option");

    const writeField = addTool.fields.find((field) => field.name === "--write");
    assert.ok(writeField);
    assert.equal(writeField.kind, "option");
    assert.equal(writeField.valueType, "boolean");
});

void test("MCP tool catalog exposes object event update from the CLI command catalog", () => {
    const catalog = listGmloopMcpToolCatalogEntries();
    const updateTool = catalog.find((entry) => entry.toolName === "gmloop_object_event_update");
    assert.ok(updateTool, "gmloop_object_event_update must appear in the MCP tool catalog");
    assert.equal(updateTool.commandDisplayName, "object event update");

    const fieldNames = new Set(updateTool.fields.map((field) => field.name));
    assert.ok(fieldNames.has("cwd"), "object event update must include cwd field");
    assert.ok(fieldNames.has("object"), "object event update must include object argument");
    assert.ok(fieldNames.has("event"), "object event update must include event argument");
    assert.ok(fieldNames.has("handler"), "object event update must include handler argument");
    assert.ok(fieldNames.has("--write"), "object event update must include --write option");
    assert.ok(fieldNames.has("--path"), "object event update must include --path option");
    assert.ok(fieldNames.has("--json"), "object event update must include --json option");

    for (const argumentName of ["object", "event", "handler"] as const) {
        const field = updateTool.fields.find((candidate) => candidate.name === argumentName);
        assert.ok(field, `Missing argument field: ${argumentName}`);
        assert.equal(field.kind, "argument");
        assert.equal(field.required, true);
        assert.equal(field.valueType, "string");
    }

    const writeField = updateTool.fields.find((field) => field.name === "--write");
    assert.ok(writeField);
    assert.equal(writeField.kind, "option");
    assert.equal(writeField.valueType, "boolean");
});

void test("MCP tool catalog exposes room layer create from the CLI command catalog", () => {
    const catalog = listGmloopMcpToolCatalogEntries();
    const createTool = catalog.find((entry) => entry.toolName === "gmloop_room_layer_create");
    assert.ok(createTool, "gmloop_room_layer_create must appear in the MCP tool catalog");
    assert.equal(createTool.commandDisplayName, "room layer create");

    const fieldNames = new Set(createTool.fields.map((field) => field.name));
    assert.ok(fieldNames.has("cwd"), "room layer create must include cwd field");
    assert.ok(fieldNames.has("room"), "room layer create must include room argument");
    assert.ok(fieldNames.has("layer"), "room layer create must include layer argument");
    assert.ok(fieldNames.has("depth"), "room layer create must include depth argument");
    assert.ok(fieldNames.has("--write"), "room layer create must include --write option");
    assert.ok(fieldNames.has("--path"), "room layer create must include --path option");
    assert.ok(fieldNames.has("--json"), "room layer create must include --json option");

    const writeField = createTool.fields.find((field) => field.name === "--write");
    assert.ok(writeField);
    assert.equal(writeField.kind, "option");
    assert.equal(writeField.valueType, "boolean");
});

void test("MCP tool catalog exposes room camera update from the CLI command catalog", () => {
    const catalog = listGmloopMcpToolCatalogEntries();
    const updateTool = catalog.find((entry) => entry.toolName === "gmloop_room_camera_update");
    assert.ok(updateTool, "gmloop_room_camera_update must appear in the MCP tool catalog");
    assert.equal(updateTool.commandDisplayName, "room camera update");

    const fieldNames = new Set(updateTool.fields.map((field) => field.name));
    assert.ok(fieldNames.has("cwd"), "room camera update must include cwd field");
    assert.ok(fieldNames.has("room"), "room camera update must include room argument");
    assert.ok(fieldNames.has("camera-id"), "room camera update must include camera-id argument");
    assert.ok(fieldNames.has("x"), "room camera update must include x argument");
    assert.ok(fieldNames.has("y"), "room camera update must include y argument");
    assert.ok(fieldNames.has("width"), "room camera update must include width argument");
    assert.ok(fieldNames.has("height"), "room camera update must include height argument");
    assert.ok(fieldNames.has("--write"), "room camera update must include --write option");
    assert.ok(fieldNames.has("--path"), "room camera update must include --path option");
    assert.ok(fieldNames.has("--json"), "room camera update must include --json option");

    const writeField = updateTool.fields.find((field) => field.name === "--write");
    assert.ok(writeField);
    assert.equal(writeField.kind, "option");
    assert.equal(writeField.valueType, "boolean");
});

void test("MCP tool catalog exposes object event delete from the CLI command catalog", () => {
    const catalog = listGmloopMcpToolCatalogEntries();
    const deleteTool = catalog.find((entry) => entry.toolName === "gmloop_object_event_delete");
    assert.ok(deleteTool, "gmloop_object_event_delete must appear in the MCP tool catalog");
    assert.equal(deleteTool.commandDisplayName, "object event delete");

    const fieldNames = new Set(deleteTool.fields.map((field) => field.name));
    assert.ok(fieldNames.has("cwd"), "object event delete must include cwd field");
    assert.ok(fieldNames.has("object"), "object event delete must include object argument");
    assert.ok(fieldNames.has("event"), "object event delete must include event argument");
    assert.ok(fieldNames.has("--write"), "object event delete must include --write option");
    assert.ok(fieldNames.has("--path"), "object event delete must include --path option");
    assert.ok(fieldNames.has("--json"), "object event delete must include --json option");

    const writeField = deleteTool.fields.find((field) => field.name === "--write");
    assert.ok(writeField);
    assert.equal(writeField.kind, "option");
    assert.equal(writeField.valueType, "boolean");
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

void test("parseOptionalCliJsonStdout gives MCP tools a stable parsed JSON payload", () => {
    const payload = parseOptionalCliJsonStdout(
        '{"command":"object event update","ok":true,"payload":{"dryRun":true}}\n',
        ["object", "event", "update", "obj_player", "Create:0", "x = 1;", "--json"]
    ) as { command: string; ok: boolean; payload: { dryRun: boolean } };

    assert.equal(payload.command, "object event update");
    assert.equal(payload.ok, true);
    assert.equal(payload.payload.dryRun, true);
    assert.equal(
        parseOptionalCliJsonStdout("object event update exited with code 0\n", ["object", "event", "update"]),
        null
    );
    assert.equal(parseOptionalCliJsonStdout("\n", ["object", "event", "update"]), null);
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

void test("parseCliJsonStdout returns the parsed payload for valid JSON", () => {
    const payload = parseCliJsonStdout<{ ok: true }>('{"ok":true}\n', ["graph", "doctor", "--json"]);

    assert.deepEqual(payload, { ok: true });
});

void test("parseCliJsonStdout decorates syntax errors with the originating command", () => {
    assert.throws(
        () => parseCliJsonStdout("not-json", ["graph", "doctor", "--json"]),
        (error: unknown) => {
            assert.ok(error instanceof SyntaxError);
            assert.equal(error.name, "JsonParseError");
            assert.match(error.message, /CLI JSON output for graph doctor --json/u);
            return true;
        }
    );
});

void test("parseCliJsonStdout throws when the CLI emits an empty stdout", () => {
    assert.throws(
        () => parseCliJsonStdout("", ["graph", "doctor", "--json"]),
        (error: unknown) => {
            assert.ok(error instanceof SyntaxError);
            assert.equal(error.name, "JsonParseError");
            assert.match(error.message, /CLI JSON output for graph doctor --json/u);
            return true;
        }
    );
});
