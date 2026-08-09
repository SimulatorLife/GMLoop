import type { Command } from "commander";

import { type CliCatalogEntry, createCliCommandCatalog } from "./command-catalog.js";
import { createMcpToolCatalogEntries, type McpToolCatalogEntry } from "./mcp-tool-catalog.js";

/**
 * Bundle of catalog accessors bound to a single Commander {@link Command} program.
 *
 * Internal CLI consumers (for example `commands/graph/visualize/catalog.ts`) reach
 * for the CLI's leaf catalog and MCP catalog from many places. Centralizing the
 * functions behind a single factory keeps them anchored to the program that the
 * CLI bootstrap module created and lets us avoid internal modules reaching into
 * the workspace entry point file (`cli.ts`) just to obtain the live catalog.
 *
 * The factory exposes plain functions rather than a class so the resulting
 * accessors can be passed as dependency parameters (e.g. to `registerCliCommands`)
 * without consumers needing to type-check a new wrapper class.
 */
export interface CliCommandCatalogRuntime {
    getCliCommandCatalog: () => ReadonlyArray<CliCatalogEntry>;
    getMcpToolCatalogEntries: (options?: { includeInternal?: boolean }) => ReadonlyArray<McpToolCatalogEntry>;
}

/**
 * Build a frozen catalog runtime bound to {@link program}.
 *
 * The returned accessors always read from the same Commander program instance,
 * so callers do not have to thread it through every call site.
 */
export function createCliCommandCatalogRuntime(program: Command): CliCommandCatalogRuntime {
    function readLeafCatalog(): ReadonlyArray<CliCatalogEntry> {
        return Object.freeze(createCliCommandCatalog(program));
    }

    return Object.freeze({
        getCliCommandCatalog: () => readLeafCatalog(),
        getMcpToolCatalogEntries: (options) => createMcpToolCatalogEntries(readLeafCatalog(), options)
    });
}

let activeRuntime: CliCommandCatalogRuntime | null = null;

/**
 * Install the runtime that powers the module-level {@link getCliCommandCatalog}
 * and {@link getMcpToolCatalogEntries} accessors.
 *
 * `cli.ts` invokes this exactly once at module load, immediately after creating
 * the Commander program. Throwing if a runtime is already installed prevents
 * accidental double-registration during bootstrap or tests.
 */
export function registerCliCommandCatalogRuntime(runtime: CliCommandCatalogRuntime): void {
    if (activeRuntime !== null) {
        throw new Error("CLI command catalog runtime is already registered.");
    }
    activeRuntime = runtime;
}

/**
 * Reset the registered runtime.
 *
 * Exposed exclusively for tests that need to install a stub runtime; production
 * callers should rely on {@link registerCliCommandCatalogRuntime} and treat the
 * accessor functions as live bindings.
 */
export function __resetCliCommandCatalogRuntimeForTests(): void {
    activeRuntime = null;
}

function resolveActiveRuntime(): CliCommandCatalogRuntime {
    if (activeRuntime === null) {
        throw new Error(
            "CLI command catalog runtime has not been registered. " +
                "Call registerCliCommandCatalogRuntime() during CLI bootstrap."
        );
    }
    return activeRuntime;
}

/**
 * Return a frozen snapshot of the CLI leaf-command catalog.
 *
 * Internal consumers should import this function from `cli-core` instead of
 * reaching into the workspace entry point (`cli.ts`). External consumers can
 * keep importing the same function from the CLI's public surface.
 */
export function getCliCommandCatalog(): ReadonlyArray<CliCatalogEntry> {
    return resolveActiveRuntime().getCliCommandCatalog();
}

/**
 * Derive the MCP tool catalog from the CLI leaf commands.
 *
 * See {@link getCliCommandCatalog} for the import-location convention.
 */
export function getMcpToolCatalogEntries(options?: { includeInternal?: boolean }): ReadonlyArray<McpToolCatalogEntry> {
    return resolveActiveRuntime().getMcpToolCatalogEntries(options);
}
