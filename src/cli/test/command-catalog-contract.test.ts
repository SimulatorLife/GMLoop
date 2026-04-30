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

void test("MCP catalog is derived 1:1 from CLI catalog", () => {
    const cliCatalog = getCliCommandCatalog();
    const mcpCatalog = getMcpToolCatalogEntries();

    assert.equal(mcpCatalog.length, cliCatalog.length);

    const cliByDisplayName = new Map(cliCatalog.map((entry) => [entry.displayName, entry]));
    for (const mcpEntry of mcpCatalog) {
        const cliEntry = cliByDisplayName.get(mcpEntry.commandDisplayName);
        assert.ok(cliEntry, `MCP entry has no matching CLI entry: ${mcpEntry.commandDisplayName}`);
        assert.equal(mcpEntry.description, cliEntry.description);

        const expectedToolName = `gmloop_${cliEntry.commandPath.join("_").replaceAll("-", "_")}`;
        assert.equal(mcpEntry.toolName, expectedToolName);
    }
});
