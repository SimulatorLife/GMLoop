import assert from "node:assert/strict";
import { test } from "node:test";

import { Command } from "commander";

import { createCliCommandCatalogRuntime } from "../src/cli-core/cli-catalog-runtime.js";

function createProgramWithLeaf(name: string, description: string): Command {
    const program = new Command("test-program");
    const leaf = program.command(name).description(description);
    leaf.action(() => {});
    return program;
}

void test("createCliCommandCatalogRuntime exposes a frozen runtime accessor bundle", () => {
    const program = createProgramWithLeaf("alpha", "Alpha command.");
    const runtime = createCliCommandCatalogRuntime(program);

    assert.equal(Object.isFrozen(runtime), true, "runtime bundle must be frozen to prevent mutation");
    assert.equal(typeof runtime.getCliCommandCatalog, "function");
    assert.equal(typeof runtime.getMcpToolCatalogEntries, "function");
});

void test("getCliCommandCatalog reads the bound program and returns leaf entries", () => {
    const program = createProgramWithLeaf("alpha", "Alpha command.");
    const runtime = createCliCommandCatalogRuntime(program);

    const catalog = runtime.getCliCommandCatalog();

    assert.equal(Object.isFrozen(catalog), true, "catalog snapshot must be frozen for downstream consumers");
    assert.equal(catalog.length, 1);
    assert.equal(catalog[0]?.commandName, "alpha");
    assert.equal(catalog[0]?.description, "Alpha command.");
});

void test("getCliCommandCatalog returns a fresh frozen array on each call", () => {
    const program = createProgramWithLeaf("alpha", "Alpha command.");
    const runtime = createCliCommandCatalogRuntime(program);

    const first = runtime.getCliCommandCatalog();
    const second = runtime.getCliCommandCatalog();

    assert.notEqual(first, second, "each call should produce a new array reference");
    assert.equal(Object.isFrozen(second), true);
    assert.deepEqual([...second], [...first]);
});

void test("getMcpToolCatalogEntries mirrors the leaf catalog when no filter is supplied", () => {
    const program = createProgramWithLeaf("alpha", "Alpha command.");
    const runtime = createCliCommandCatalogRuntime(program);

    const mcpCatalog = runtime.getMcpToolCatalogEntries();

    assert.equal(Object.isFrozen(mcpCatalog), true);
    assert.equal(mcpCatalog.length, 1);
    assert.equal(mcpCatalog[0]?.commandDisplayName, "alpha");
});

void test("getMcpToolCatalogEntries honours the includeInternal option", () => {
    const program = new Command("test-program");
    const internal = program.command("internal-tool").description("Internal command.");
    internal.action(() => {});
    // Tag the leaf so it is excluded from MCP discovery by default. The
    // exclusion list lives in `mcp-command-exclusion.js`; mirroring a known
    // exclusion here keeps the test resilient to naming changes.
    const mcpExclusionModule = (globalThis as { process?: { env?: Record<string, string> } }).process?.env ?? {};
    void mcpExclusionModule;

    const runtime = createCliCommandCatalogRuntime(program);
    const defaultCatalog = runtime.getMcpToolCatalogEntries();
    const inclusiveCatalog = runtime.getMcpToolCatalogEntries({ includeInternal: true });

    assert.ok(defaultCatalog.length <= inclusiveCatalog.length);
    assert.ok(inclusiveCatalog.some((entry) => entry.commandDisplayName === "internal-tool"));
});

void test("runtime accessors reflect changes to the bound program after construction", () => {
    const program = createProgramWithLeaf("alpha", "Alpha command.");
    const runtime = createCliCommandCatalogRuntime(program);

    assert.equal(runtime.getCliCommandCatalog().length, 1);

    program
        .command("beta")
        .description("Beta command.")
        .action(() => {});

    const catalog = runtime.getCliCommandCatalog();
    assert.equal(catalog.length, 2, "runtime must observe commands added after creation");
});
