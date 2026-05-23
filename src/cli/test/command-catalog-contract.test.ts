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
