import type { Command } from "commander";

import { printProjectPayload, type SharedProjectContextOptions } from "../workflow/project-root.js";
import { createConfigOption, createPathOption } from "./shared-command-options.js";

/**
 * Mutation-flavoured option bag shared by graph-backed resource commands such
 * as `room`, `object`, and `script`. The fields mirror
 * {@link SharedProjectContextOptions} and add an optional `--write` flag
 * used to promote dry-run defaults to on-disk mutations.
 */
export type ResourceMutationOptions = SharedProjectContextOptions &
    Readonly<{
        write?: boolean;
    }>;

/**
 * Register the standard query-side option set used by graph-backed resource
 * commands (rooms, objects, scripts, etc.).
 *
 * Centralises the `--path`, `--config`, `--database-path`, `--toolset-root`,
 * `--force`, and `--json` flags so each command file does not need to keep a
 * private copy of the same wiring. The set matches what `room`, `object`, and
 * `script` registered individually before this helper existed; callers can
 * still attach command-specific options afterwards.
 *
 * @param command Commander command to mutate.
 * @returns The same `command` instance for fluent chaining.
 */
export function addResourceQuerySharedOptions(command: Command): Command {
    return command
        .addOption(createPathOption())
        .addOption(createConfigOption())
        .option("--database-path <path>", "Graph index database path override.")
        .option("--toolset-root <path>", "Toolset project root path override.")
        .option("--force", "Rebuild graph index before query.")
        .option("--json", "Emit JSON output.");
}

/**
 * Emit a resource command payload via the shared
 * {@link printProjectPayload} writer so every graph-backed command produces
 * the same pretty-printed JSON shape.
 *
 * @param payload Serializable value to emit.
 */
export function printResourceCommandPayload(payload: unknown): void {
    printProjectPayload(payload);
}
