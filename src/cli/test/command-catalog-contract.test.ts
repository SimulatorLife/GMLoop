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

void test("read-side object and room inspection MCP schemas expose required lookup arguments", () => {
    const mcpCatalog = getMcpToolCatalogEntries();
    const requiredArgumentsByTool = new Map<string, ReadonlyArray<string>>([
        ["gmloop_object_event_list", ["object"]],
        ["gmloop_object_event_inspect", ["object", "event"]],
        ["gmloop_room_layer_list", ["room"]],
        ["gmloop_room_layer_inspect", ["room", "layer"]],
        ["gmloop_room_camera_list", ["room"]],
        ["gmloop_room_camera_inspect", ["room", "camera_id"]]
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

void test("test case create/update MCP tool schema includes mutation arguments and write mode option", () => {
    const mcpCatalog = getMcpToolCatalogEntries();

    for (const toolName of ["gmloop_test_case_create", "gmloop_test_case_update"] as const) {
        const entry = mcpCatalog.find((candidate) => candidate.toolName === toolName);
        assert.ok(entry, `Missing MCP tool: ${toolName}`);

        const writeField = entry.fields.find((field) => field.attributeName === "write");
        assert.ok(writeField);
        assert.equal(writeField.kind, "option");
        assert.equal(writeField.valueType, "boolean");

        const expectedField = entry.fields.find((field) => field.attributeName === "expected");
        assert.ok(expectedField);
        assert.equal(expectedField.kind, "option");
        assert.equal(expectedField.required, false);

        for (const requiredArgument of ["target", "name"]) {
            const field = entry.fields.find((candidate) => candidate.attributeName === requiredArgument);
            assert.ok(field, `Missing required argument field '${requiredArgument}' on ${toolName}`);
            assert.equal(field.kind, "argument");
            assert.equal(field.required, true);
        }
    }
});
