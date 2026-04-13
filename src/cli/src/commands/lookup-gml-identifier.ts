import { readFile } from "node:fs/promises";
import process from "node:process";

import { Core } from "@gmloop/core";
import { Command } from "commander";

import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import type { CommanderCommandLike } from "../cli-core/commander-types.js";
import { resolveFromRepoRoot } from "../shared/workspace-paths.js";

const { getErrorMessageOrFallback, normalizeIdentifierMetadataEntries } = Core;

const DEFAULT_IDENTIFIERS_PATH = resolveFromRepoRoot("resources", "gml-identifiers.json");
const GML_MANUAL_BASE_URL = "https://manual.gamemaker.io/monthly/en/#t=";
const IDENTIFIER_NOT_FOUND_EXIT_CODE = 2;

interface LookupGmlIdentifierCommandOptions {
    identifiersPath?: string;
    json?: boolean;
}

interface LookupResult {
    identifier: string;
    normalizedLookup: string;
    found: boolean;
    signature: string | null;
    info: Record<string, unknown> | null;
    manualUrl: string | null;
}

type NormalizedIdentifierEntry = ReturnType<typeof normalizeIdentifierMetadataEntries>[number];

function resolveLookupCommandOptions(command: CommanderCommandLike): LookupGmlIdentifierCommandOptions {
    return (command.opts() as LookupGmlIdentifierCommandOptions) ?? {};
}

function normalizeLookupKey(value: string): string {
    return value.trim().toLowerCase();
}

function buildManualUrl(manualPath: string | null): string | null {
    if (typeof manualPath !== "string" || manualPath.length === 0) {
        return null;
    }

    return `${GML_MANUAL_BASE_URL}${encodeURIComponent(manualPath)}.htm`;
}

function decodeIdentifierEntries(rawJson: string, sourcePath: string): Array<NormalizedIdentifierEntry> {
    let parsed: unknown;

    try {
        parsed = JSON.parse(rawJson) as unknown;
    } catch (error) {
        throw new Error(
            `Failed to parse gml-identifiers payload at '${sourcePath}': ${getErrorMessageOrFallback(error)}`,
            { cause: error }
        );
    }

    const entries = normalizeIdentifierMetadataEntries(parsed);
    if (!Array.isArray(entries) || entries.length === 0) {
        throw new TypeError(
            `gml-identifiers payload at '${sourcePath}' did not produce any normalized identifier metadata entries.`
        );
    }

    return entries;
}

async function readIdentifierEntries(sourcePath: string): Promise<Array<NormalizedIdentifierEntry>> {
    const rawJson = await readFile(sourcePath, "utf8");
    return decodeIdentifierEntries(rawJson, sourcePath);
}

function findIdentifierByName(
    entries: ReadonlyArray<NormalizedIdentifierEntry>,
    requestedIdentifier: string
): [string, Record<string, unknown>] | null {
    const lookupKey = normalizeLookupKey(requestedIdentifier);

    for (const entry of entries) {
        if (normalizeLookupKey(entry.name) === lookupKey) {
            return [entry.name, entry.descriptor];
        }
    }

    return null;
}

function formatLookupResultAsText(result: LookupResult): string {
    if (!result.found) {
        return `Identifier '${result.identifier}' was not found in gml-identifiers.`;
    }

    const info = result.info;
    const type = typeof info?.type === "string" ? info.type : "unknown";
    const deprecated = info?.deprecated === true ? "yes" : "no";
    const manualUrl = result.manualUrl ?? "(none)";

    return [
        `Identifier: ${result.identifier}`,
        `Type: ${type}`,
        `Deprecated: ${deprecated}`,
        `Signature: ${result.signature ?? "(not available in identifier metadata)"}`,
        `Manual URL: ${manualUrl}`,
        `Info JSON: ${JSON.stringify(info, null, 2)}`
    ].join("\n");
}

/**
 * Create the CLI command used to query built-in GML identifier metadata.
 *
 * The command reads the canonical `gml-identifiers.json` snapshot generated
 * from the GameMaker manual and performs a case-insensitive lookup.
 *
 * @returns Commander command definition for the identifier lookup command.
 */
export function createLookupGmlIdentifierCommand(): Command {
    return applyStandardCommandOptions(
        new Command("lookup-gml-identifier")
            .usage("[options] <identifier>")
            .description(
                "Lookup a built-in keyword/function/identifier from gml-identifiers metadata generated from the GameMaker manual."
            )
            .argument("<identifier>", "Built-in identifier to lookup (for example: draw_text or room_speed).")
            .option("--identifiers-path <path>", "Path to gml-identifiers.json to query.", DEFAULT_IDENTIFIERS_PATH)
            .option("--json", "Emit JSON output instead of human-readable text.")
    );
}

/**
 * Execute the `lookup-gml-identifier` command.
 *
 * Returns exit code `0` when the identifier exists and `2` when the lookup
 * misses. Other failures throw and are handled by the CLI error boundary.
 *
 * @param command Commander command instance.
 * @returns Exit code representing lookup success or miss.
 */
export async function runLookupGmlIdentifierCommand(command: CommanderCommandLike): Promise<number> {
    const options = resolveLookupCommandOptions(command);
    const requestedIdentifier = String(command.args[0] ?? "").trim();
    const sourcePath = options.identifiersPath ?? DEFAULT_IDENTIFIERS_PATH;
    const useJson = Boolean(options.json);

    const entries = await readIdentifierEntries(sourcePath);
    const match = findIdentifierByName(entries, requestedIdentifier);

    const normalizedLookup = normalizeLookupKey(requestedIdentifier);
    const lookupResult: LookupResult =
        match === null
            ? {
                  identifier: requestedIdentifier,
                  normalizedLookup,
                  found: false,
                  signature: null,
                  info: null,
                  manualUrl: null
              }
            : {
                  identifier: match[0],
                  normalizedLookup,
                  found: true,
                  signature: null,
                  info: match[1],
                  manualUrl: buildManualUrl(typeof match[1].manualPath === "string" ? match[1].manualPath : null)
              };

    const output = useJson
        ? `${JSON.stringify(lookupResult, null, 2)}\n`
        : `${formatLookupResultAsText(lookupResult)}\n`;
    process.stdout.write(output);

    return lookupResult.found ? 0 : IDENTIFIER_NOT_FOUND_EXIT_CODE;
}
