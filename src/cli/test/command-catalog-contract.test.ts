import assert from "node:assert/strict";
import { test } from "node:test";

import { getCliCommandCatalog, getMcpToolCatalogEntries } from "../src/cli.js";

void test("CLI command catalog leaf display names are unique", () => {
    const catalog = getCliCommandCatalog();
    const seen = new Set<string>();

    for (const entry of catalog) {
        assert.equal(seen.has(entry.displayName), false, `Duplicate CLI leaf command: ${entry.displayName}`);
        seen.add(entry.displayName);
        assert.ok(entry.description.length > 0, `CLI command missing description: ${entry.displayName}`);
    }
});

void test("MCP catalog is derived from MCP-exposed CLI leaf commands", () => {
    const cliCatalog = getCliCommandCatalog();
    const mcpCatalog = getMcpToolCatalogEntries();

    const mcpExposedCliCatalog = cliCatalog.filter((entry) => !entry.excludeFromMcp);
    assert.equal(mcpCatalog.length, mcpExposedCliCatalog.length);

    const cliByDisplayName = new Map(cliCatalog.map((entry) => [entry.displayName, entry]));
    for (const mcpEntry of mcpCatalog) {
        const cliEntry = cliByDisplayName.get(mcpEntry.commandDisplayName);
        assert.ok(cliEntry, `MCP entry has no matching CLI entry: ${mcpEntry.commandDisplayName}`);
        assert.equal(
            cliEntry.excludeFromMcp,
            false,
            `Excluded command leaked into MCP catalog: ${cliEntry.displayName}`
        );
        assert.equal(mcpEntry.description, cliEntry.description);

        const expectedToolName = `gmloop_${cliEntry.commandPath.join("_").replaceAll("-", "_")}`;
        assert.equal(mcpEntry.toolName, expectedToolName);
    }
});

void test("mcp command is excluded from MCP tool catalog", () => {
    const cliCatalog = getCliCommandCatalog();
    const mcpCatalog = getMcpToolCatalogEntries();

    const mcpCliEntry = cliCatalog.find((entry) => entry.displayName === "mcp");
    assert.ok(mcpCliEntry);
    assert.equal(mcpCliEntry.excludeFromMcp, true);
    assert.equal(
        mcpCatalog.some((entry) => entry.toolName === "gmloop_mcp"),
        false
    );
});

void test("official gm-cli integration helpers and ResourceTool mirrors are excluded from MCP catalog", () => {
    const mcpCatalog = getMcpToolCatalogEntries();
    const toolNames = new Set(mcpCatalog.map((entry) => entry.toolName));

    assert.equal(toolNames.has("gmloop_gm_cli_capability_audit"), false);
    assert.equal(toolNames.has("gmloop_gm_cli_mcp"), false);
    assert.equal(toolNames.has("gmloop_resource_add"), false);
    assert.equal(toolNames.has("gmloop_resource_remove"), false);
    assert.equal(toolNames.has("gmloop_resource_rename"), false);
    assert.equal(toolNames.has("gmloop_resource_duplicate"), false);
    assert.equal(toolNames.has("gmloop_resource_move"), false);
});

void test("developer-only and internal toolchain commands are excluded from MCP catalog", () => {
    const mcpCatalog = getMcpToolCatalogEntries();
    const toolNames = new Set(mcpCatalog.map((entry) => entry.toolName));

    // Excluded exact commands
    assert.equal(toolNames.has("gmloop_graph_visualize"), false);
    assert.equal(toolNames.has("gmloop_transpile"), false);
    assert.equal(toolNames.has("gmloop_collect_stats"), false);

    // Excluded prefix/wildcard command categories
    assert.equal(toolNames.has("gmloop_generate_feather_metadata"), false);
    assert.equal(toolNames.has("gmloop_generate_gml_identifiers"), false);
    assert.equal(toolNames.has("gmloop_generate_quality_report"), false);

    assert.equal(toolNames.has("gmloop_ui_inspect"), false);
    assert.equal(toolNames.has("gmloop_ui_validate"), false);
    assert.equal(toolNames.has("gmloop_ui_preview"), false);
    assert.equal(toolNames.has("gmloop_ui_scaffold"), false);

    assert.equal(toolNames.has("gmloop_profile_start"), false);
    assert.equal(toolNames.has("gmloop_profile_stop"), false);
    assert.equal(toolNames.has("gmloop_profile_snapshot"), false);
    assert.equal(toolNames.has("gmloop_profile_compare"), false);
    assert.equal(toolNames.has("gmloop_profile_report"), false);

    assert.equal(toolNames.has("gmloop_test_run"), false);
    assert.equal(toolNames.has("gmloop_test_list"), false);
    assert.equal(toolNames.has("gmloop_test_results"), false);
    assert.equal(toolNames.has("gmloop_test_case_create"), false);
    assert.equal(toolNames.has("gmloop_test_case_update"), false);

    // Ensure no commands under these prefix namespace categories leak
    for (const toolName of toolNames) {
        assert.ok(!toolName.startsWith("gmloop_ui_"), `Leaked UI command: ${toolName}`);
        assert.ok(!toolName.startsWith("gmloop_profile_"), `Leaked Profile command: ${toolName}`);
        assert.ok(!toolName.startsWith("gmloop_test_"), `Leaked Test command: ${toolName}`);
        assert.ok(!toolName.startsWith("gmloop_generate_"), `Leaked Generate command: ${toolName}`);
    }

    // Standard game development / agent-facing commands must remain included
    assert.equal(toolNames.has("gmloop_format"), true);
    assert.equal(toolNames.has("gmloop_lint"), true);
    assert.equal(toolNames.has("gmloop_refactor"), true);
    assert.equal(toolNames.has("gmloop_graph_index"), true);
    assert.equal(toolNames.has("gmloop_graph_search"), true);
    assert.equal(toolNames.has("gmloop_graph_doctor"), true);
});

void test("object event add MCP tool schema includes write mode option and required mutation arguments", () => {
    const mcpCatalog = getMcpToolCatalogEntries();
    const entry = mcpCatalog.find((candidate) => candidate.toolName === "gmloop_object_event_add");
    assert.ok(entry, "Missing MCP tool for object event add.");

    const writeField = entry.fields.find((field) => field.attributeName === "write");
    assert.ok(writeField, "object event add MCP tool is missing the dry-run/write flag.");
    assert.equal(writeField.kind, "option");
    assert.equal(writeField.valueType, "boolean");

    const objectField = entry.fields.find((field) => field.attributeName === "object");
    assert.ok(objectField, "object event add MCP tool is missing the object argument.");
    assert.equal(objectField.kind, "argument");
    assert.equal(objectField.required, true);

    const eventField = entry.fields.find((field) => field.attributeName === "event");
    assert.ok(eventField, "object event add MCP tool is missing the event argument.");
    assert.equal(eventField.kind, "argument");
    assert.equal(eventField.required, true);

    const handlerField = entry.fields.find((field) => field.attributeName === "handler");
    assert.ok(handlerField, "object event add MCP tool is missing the handler argument.");
    assert.equal(handlerField.kind, "argument");
    assert.equal(handlerField.required, true);
});

void test("object event update MCP tool schema includes write mode option", () => {
    const mcpCatalog = getMcpToolCatalogEntries();
    const entry = mcpCatalog.find((candidate) => candidate.toolName === "gmloop_object_event_update");
    assert.ok(entry);

    const writeField = entry.fields.find((field) => field.attributeName === "write");
    assert.ok(writeField);
    assert.equal(writeField.kind, "option");
    assert.equal(writeField.valueType, "boolean");

    const objectField = entry.fields.find((field) => field.attributeName === "object");
    assert.ok(objectField);
    assert.equal(objectField.kind, "argument");
    assert.equal(objectField.required, true);

    const eventField = entry.fields.find((field) => field.attributeName === "event");
    assert.ok(eventField);
    assert.equal(eventField.kind, "argument");
    assert.equal(eventField.required, true);

    const handlerField = entry.fields.find((field) => field.attributeName === "handler");
    assert.ok(handlerField);
    assert.equal(handlerField.kind, "argument");
    assert.equal(handlerField.required, true);
});

void test("project readiness MCP tool schemas include project path and graph options", () => {
    const mcpCatalog = getMcpToolCatalogEntries();

    for (const toolName of ["gmloop_project_inspect", "gmloop_project_validate"] as const) {
        const entry = mcpCatalog.find((candidate) => candidate.toolName === toolName);
        assert.ok(entry, `Missing MCP tool: ${toolName}`);

        for (const fieldName of ["path", "config", "databasePath", "toolsetRoot", "json"]) {
            const field = entry.fields.find((candidate) => candidate.attributeName === fieldName);
            assert.ok(field, `Missing project readiness field: ${fieldName}`);
            assert.equal(field.kind, "option");
        }
    }
});

void test("live-reload MCP tool schema exposes the unified project session workflow", () => {
    const mcpCatalog = getMcpToolCatalogEntries();
    const expectedPathTools = ["gmloop_live_reload_session", "gmloop_live_reload_wait_for_patch"];

    for (const toolName of expectedPathTools) {
        const entry = mcpCatalog.find((candidate) => candidate.toolName === toolName);
        assert.ok(entry, `Missing MCP tool: ${toolName}`);

        const pathField = entry.fields.find((field) => field.attributeName === "path");
        assert.ok(pathField, `Missing path field on ${toolName}`);
        assert.equal(pathField.kind, "option");
    }

    assert.equal(
        mcpCatalog.some((entry) => entry.toolName === "gmloop_live_reload_dev"),
        false
    );
    assert.equal(
        mcpCatalog.some((entry) => entry.toolName === "gmloop_live_reload_discover"),
        false
    );
    assert.equal(
        mcpCatalog.some((entry) => entry.toolName === "gmloop_live_reload_status"),
        false
    );
    assert.equal(
        mcpCatalog.some((entry) => entry.toolName === "gmloop_live_reload_worker"),
        false
    );

    const sessionTool = mcpCatalog.find((candidate) => candidate.toolName === "gmloop_live_reload_session");
    assert.ok(sessionTool);
    assert.ok(sessionTool.fields.some((field) => field.attributeName === "forceStart"));
    assert.ok(sessionTool.fields.some((field) => field.attributeName === "stop"));

    const waitTool = mcpCatalog.find((candidate) => candidate.toolName === "gmloop_live_reload_wait_for_patch");
    assert.ok(waitTool);
    assert.ok(waitTool.fields.some((field) => field.attributeName === "sincePatchId"));
    assert.ok(waitTool.fields.some((field) => field.attributeName === "timeoutMs"));
    assert.ok(waitTool.fields.some((field) => field.attributeName === "pollIntervalMs"));
});

void test("read-side object and room inspection MCP schemas expose required lookup arguments", () => {
    const mcpCatalog = getMcpToolCatalogEntries();
    const requiredArgumentsByTool = new Map<string, ReadonlyArray<string>>([
        ["gmloop_object_event_list", ["object"]],
        ["gmloop_object_event_inspect", ["object", "event"]],
        ["gmloop_room_layer_list", ["room"]],
        ["gmloop_room_camera_list", ["room"]]
    ]);

    for (const [toolName, requiredArguments] of requiredArgumentsByTool) {
        const entry = mcpCatalog.find((candidate) => candidate.toolName === toolName);
        assert.ok(entry, `Missing MCP tool: ${toolName}`);

        for (const requiredArgument of requiredArguments) {
            const field = entry.fields.find((candidate) => candidate.attributeName === requiredArgument);
            assert.ok(field, `Missing required argument field '${requiredArgument}' on ${toolName}`);
            assert.equal(field.kind, "argument");
            assert.equal(field.required, true);
        }
    }
});

void test("object event delete MCP tool schema includes write mode option", () => {
    const mcpCatalog = getMcpToolCatalogEntries();
    const entry = mcpCatalog.find((candidate) => candidate.toolName === "gmloop_object_event_delete");
    assert.ok(entry);

    const writeField = entry.fields.find((field) => field.attributeName === "write");
    assert.ok(writeField);
    assert.equal(writeField.kind, "option");
    assert.equal(writeField.valueType, "boolean");

    for (const requiredArgument of ["object", "event"]) {
        const field = entry.fields.find((candidate) => candidate.attributeName === requiredArgument);
        assert.ok(field, `Missing required argument field: ${requiredArgument}`);
        assert.equal(field.kind, "argument");
        assert.equal(field.required, true);
    }
});

void test("room layer create MCP tool schema includes mutation arguments and write option", () => {
    const mcpCatalog = getMcpToolCatalogEntries();
    const entry = mcpCatalog.find((candidate) => candidate.toolName === "gmloop_room_layer_create");
    assert.ok(entry);

    const writeField = entry.fields.find((field) => field.attributeName === "write");
    assert.ok(writeField);
    assert.equal(writeField.kind, "option");
    assert.equal(writeField.valueType, "boolean");

    for (const requiredArgument of ["room", "layer", "depth"]) {
        const field = entry.fields.find((candidate) => candidate.attributeName === requiredArgument);
        assert.ok(field, `Missing required argument field: ${requiredArgument}`);
        assert.equal(field.kind, "argument");
        assert.equal(field.required, true);
    }
});

void test("room layer update/delete/reorder MCP tool schemas include mutation fields", () => {
    const mcpCatalog = getMcpToolCatalogEntries();
    const updateEntry = mcpCatalog.find((candidate) => candidate.toolName === "gmloop_room_layer_update");
    assert.ok(updateEntry);

    const updateWriteField = updateEntry.fields.find((field) => field.attributeName === "write");
    assert.ok(updateWriteField);
    assert.equal(updateWriteField.kind, "option");
    assert.equal(updateWriteField.valueType, "boolean");

    for (const requiredArgument of ["room", "layer"]) {
        const field = updateEntry.fields.find((candidate) => candidate.attributeName === requiredArgument);
        assert.ok(field, `Missing required argument field on update: ${requiredArgument}`);
        assert.equal(field.kind, "argument");
        assert.equal(field.required, true);
    }

    for (const optionalFieldName of ["name", "depth"]) {
        const field = updateEntry.fields.find((candidate) => candidate.attributeName === optionalFieldName);
        assert.ok(field, `Missing option field on update: ${optionalFieldName}`);
        assert.equal(field.kind, "option");
        assert.equal(field.required, false);
    }

    const deleteEntry = mcpCatalog.find((candidate) => candidate.toolName === "gmloop_room_layer_delete");
    assert.ok(deleteEntry);
    const deleteWriteField = deleteEntry.fields.find((field) => field.attributeName === "write");
    assert.ok(deleteWriteField);
    assert.equal(deleteWriteField.kind, "option");
    assert.equal(deleteWriteField.valueType, "boolean");

    for (const requiredArgument of ["room", "layer"]) {
        const field = deleteEntry.fields.find((candidate) => candidate.attributeName === requiredArgument);
        assert.ok(field, `Missing required argument field on delete: ${requiredArgument}`);
        assert.equal(field.kind, "argument");
        assert.equal(field.required, true);
    }

    const reorderEntry = mcpCatalog.find((candidate) => candidate.toolName === "gmloop_room_layer_reorder");
    assert.ok(reorderEntry);
    const reorderWriteField = reorderEntry.fields.find((field) => field.attributeName === "write");
    assert.ok(reorderWriteField);
    assert.equal(reorderWriteField.kind, "option");
    assert.equal(reorderWriteField.valueType, "boolean");

    for (const requiredArgument of ["room", "layer", "index"]) {
        const field = reorderEntry.fields.find((candidate) => candidate.attributeName === requiredArgument);
        assert.ok(field, `Missing required argument field on reorder: ${requiredArgument}`);
        assert.equal(field.kind, "argument");
        assert.equal(field.required, true);
    }
});

void test("room camera update/frame MCP tool schemas include mutation arguments and write option", () => {
    const mcpCatalog = getMcpToolCatalogEntries();
    const entry = mcpCatalog.find((candidate) => candidate.toolName === "gmloop_room_camera_update");
    assert.ok(entry);

    const writeField = entry.fields.find((field) => field.attributeName === "write");
    assert.ok(writeField);
    assert.equal(writeField.kind, "option");
    assert.equal(writeField.valueType, "boolean");

    for (const requiredArgument of ["room", "camera_id", "x", "y", "width", "height"]) {
        const field = entry.fields.find((candidate) => candidate.attributeName === requiredArgument);
        assert.ok(field, `Missing required argument field: ${requiredArgument}`);
        assert.equal(field.kind, "argument");
        assert.equal(field.required, true);
    }

    const frameEntry = mcpCatalog.find((candidate) => candidate.toolName === "gmloop_room_camera_frame");
    assert.ok(frameEntry);
    const frameWriteField = frameEntry.fields.find((field) => field.attributeName === "write");
    assert.ok(frameWriteField);
    assert.equal(frameWriteField.kind, "option");
    assert.equal(frameWriteField.valueType, "boolean");

    for (const requiredArgument of ["room", "camera_id", "layer"]) {
        const field = frameEntry.fields.find((candidate) => candidate.attributeName === requiredArgument);
        assert.ok(field, `Missing required argument field on frame: ${requiredArgument}`);
        assert.equal(field.kind, "argument");
        assert.equal(field.required, true);
    }

    const paddingField = frameEntry.fields.find((candidate) => candidate.attributeName === "padding");
    assert.ok(paddingField);
    assert.equal(paddingField.kind, "option");
    assert.equal(paddingField.required, false);
});

void test("room repair MCP tool schema includes room argument and write option", () => {
    const mcpCatalog = getMcpToolCatalogEntries();
    const entry = mcpCatalog.find((candidate) => candidate.toolName === "gmloop_room_repair");
    assert.ok(entry);

    const roomField = entry.fields.find((field) => field.attributeName === "room");
    assert.ok(roomField);
    assert.equal(roomField.kind, "argument");
    assert.equal(roomField.required, true);

    const writeField = entry.fields.find((field) => field.attributeName === "write");
    assert.ok(writeField);
    assert.equal(writeField.kind, "option");
    assert.equal(writeField.valueType, "boolean");
});

void test("room instance list/inspect MCP tool schemas include required lookup arguments", () => {
    const mcpCatalog = getMcpToolCatalogEntries();
    const listEntry = mcpCatalog.find((candidate) => candidate.toolName === "gmloop_room_instance_list");
    assert.ok(listEntry);

    const listRoomField = listEntry.fields.find((candidate) => candidate.attributeName === "room");
    assert.ok(listRoomField);
    assert.equal(listRoomField.kind, "argument");
    assert.equal(listRoomField.required, true);
    assert.equal(
        listEntry.fields.some((candidate) => candidate.attributeName === "write"),
        false
    );

    const inspectEntry = mcpCatalog.find((candidate) => candidate.toolName === "gmloop_room_instance_inspect");
    assert.ok(inspectEntry);

    for (const requiredArgument of ["room", "instance_id"]) {
        const field = inspectEntry.fields.find((candidate) => candidate.attributeName === requiredArgument);
        assert.ok(field, `Missing required inspect argument field: ${requiredArgument}`);
        assert.equal(field.kind, "argument");
        assert.equal(field.required, true);
    }
    assert.equal(
        inspectEntry.fields.some((candidate) => candidate.attributeName === "write"),
        false
    );
});

void test("room instance add/update/delete MCP tool schemas include mutation arguments and write option", () => {
    const mcpCatalog = getMcpToolCatalogEntries();
    const addEntry = mcpCatalog.find((candidate) => candidate.toolName === "gmloop_room_instance_add");
    assert.ok(addEntry);

    const addWriteField = addEntry.fields.find((field) => field.attributeName === "write");
    assert.ok(addWriteField);
    assert.equal(addWriteField.kind, "option");
    assert.equal(addWriteField.valueType, "boolean");

    for (const requiredArgument of ["room", "object", "x", "y"]) {
        const field = addEntry.fields.find((candidate) => candidate.attributeName === requiredArgument);
        assert.ok(field, `Missing required add argument field: ${requiredArgument}`);
        assert.equal(field.kind, "argument");
        assert.equal(field.required, true);
    }

    const updateEntry = mcpCatalog.find((candidate) => candidate.toolName === "gmloop_room_instance_update");
    assert.ok(updateEntry);

    const updateWriteField = updateEntry.fields.find((field) => field.attributeName === "write");
    assert.ok(updateWriteField);
    assert.equal(updateWriteField.kind, "option");
    assert.equal(updateWriteField.valueType, "boolean");

    for (const requiredArgument of ["room", "instance_id", "x", "y"]) {
        const field = updateEntry.fields.find((candidate) => candidate.attributeName === requiredArgument);
        assert.ok(field, `Missing required update argument field: ${requiredArgument}`);
        assert.equal(field.kind, "argument");
        assert.equal(field.required, true);
    }

    const deleteEntry = mcpCatalog.find((candidate) => candidate.toolName === "gmloop_room_instance_delete");
    assert.ok(deleteEntry);

    const deleteWriteField = deleteEntry.fields.find((field) => field.attributeName === "write");
    assert.ok(deleteWriteField);
    assert.equal(deleteWriteField.kind, "option");
    assert.equal(deleteWriteField.valueType, "boolean");

    for (const requiredArgument of ["room", "instance_id"]) {
        const field = deleteEntry.fields.find((candidate) => candidate.attributeName === requiredArgument);
        assert.ok(field, `Missing required delete argument field: ${requiredArgument}`);
        assert.equal(field.kind, "argument");
        assert.equal(field.required, true);
    }
});

void test("replay commands are excluded from MCP catalog by default but exposed when GMLOOP_EXPOSE_INTERNAL_MCP_TOOLS=true", () => {
    // 1. By default, it should be excluded
    const mcpCatalogDefault = getMcpToolCatalogEntries();
    const defaultReplayEntry = mcpCatalogDefault.find((entry) => entry.toolName.startsWith("gmloop_replay"));
    assert.equal(defaultReplayEntry, undefined, "Replay tools should be excluded from MCP by default");

    // 2. When GMLOOP_EXPOSE_INTERNAL_MCP_TOOLS=true, it should be exposed
    const originalEnv = process.env.GMLOOP_EXPOSE_INTERNAL_MCP_TOOLS;
    process.env.GMLOOP_EXPOSE_INTERNAL_MCP_TOOLS = "true";
    try {
        const mcpCatalogInternal = getMcpToolCatalogEntries();
        const internalReplayEntry = mcpCatalogInternal.find((entry) => entry.toolName === "gmloop_replay_record");
        assert.ok(internalReplayEntry, "Replay tools should be exposed when GMLOOP_EXPOSE_INTERNAL_MCP_TOOLS=true");
    } finally {
        if (originalEnv === undefined) {
            delete process.env.GMLOOP_EXPOSE_INTERNAL_MCP_TOOLS;
        } else {
            process.env.GMLOOP_EXPOSE_INTERNAL_MCP_TOOLS = originalEnv;
        }
    }
});
