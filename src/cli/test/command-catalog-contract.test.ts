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

void test("room layer update MCP tool schema includes write mode option", () => {
    const mcpCatalog = getMcpToolCatalogEntries();
    const entry = mcpCatalog.find((candidate) => candidate.toolName === "gmloop_room_layer_update");
    assert.ok(entry);

    const writeField = entry.fields.find((field) => field.attributeName === "write");
    assert.ok(writeField);
    assert.equal(writeField.kind, "option");
    assert.equal(writeField.valueType, "boolean");
});

void test("room instance update MCP tool schema includes mutation arguments and write option", () => {
    const mcpCatalog = getMcpToolCatalogEntries();
    const entry = mcpCatalog.find((candidate) => candidate.toolName === "gmloop_room_instance_update");
    assert.ok(entry);

    const writeField = entry.fields.find((field) => field.attributeName === "write");
    assert.ok(writeField);
    assert.equal(writeField.kind, "option");
    assert.equal(writeField.valueType, "boolean");

    for (const requiredArgument of ["room", "instance_id", "x", "y"]) {
        const field = entry.fields.find((candidate) => candidate.attributeName === requiredArgument);
        assert.ok(field, `Missing required argument field: ${requiredArgument}`);
        assert.equal(field.kind, "argument");
        assert.equal(field.required, true);
    }
});
