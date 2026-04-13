import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import vm from "node:vm";

import { Core } from "@gmloop/core";
import { Command, Option } from "commander";
import type { Element } from "linkedom/types/interface/element.js";

import { wrapInvalidArgumentResolver } from "../cli-core/command-parsing.js";
import { applyStandardCommandOptions } from "../cli-core/command-standard-options.js";
import type { CommanderCommandLike } from "../cli-core/commander-types.js";
import { isMainModule, runAsMainModule } from "../cli-core/main-module-runner.js";
import { assertSupportedNodeVersion } from "../cli-core/node-version.js";
import {
    getDirectElementChildren,
    parseManualDocument,
    replaceBreakElementsWithNewlines
} from "../modules/manual/html.js";
import { decodeManualKeywordsPayload, decodeManualTagsPayload } from "../modules/manual/payload-validation.js";
import { getManualRootMetadataPath, readManualText, resolveManualSourceCommitHash } from "../modules/manual/source.js";
import { type ManualWorkflowOptions, prepareManualWorkflow } from "../modules/manual/workflow.js";
import { getDefaultVmEvalTimeoutMs, resolveVmEvalTimeout } from "../runtime-options/vm-eval-timeout.js";
import { writeJsonArtifact } from "../shared/fs-artifacts.js";
import { createVerboseDurationLogger, timeSync } from "../shared/timing/verbose-timing.js";
import { resolveFromRepoRoot } from "../shared/workspace-paths.js";

const {
    describeValueWithArticle,
    getErrorMessageOrFallback,
    normalizeIdentifierMetadataEntries,
    toMutableArray,
    toNormalizedLowerCaseSet,
    toPosixPath,
    compactArray
} = Core;

const DEFAULT_OUTPUT_PATH = resolveFromRepoRoot("resources", "gml-identifiers.json");

const DEFAULT_GML_SOURCE_PATH = "Manual/contents/assets/scripts/gml.js";
const DEFAULT_KEYWORDS_PATH = "ZeusDocs_keywords.json";
const DEFAULT_TAGS_PATH = "ZeusDocs_tags.json";
const DEFAULT_OBSOLETE_FUNCTIONS_PATH = "Manual/contents/Additional_Information/Obsolete_Functions.htm";

const IDENTIFIER_VM_TIMEOUT_ENV_VAR = "GML_IDENTIFIER_VM_TIMEOUT_MS";

function matchesAny(needles: Array<string> | undefined, matcher: (value: string) => boolean = () => false) {
    return (needles ?? []).some(matcher);
}

interface GenerateIdentifiersCommandOptions {
    output?: string;
    manualRoot?: string;
    manualPackage?: string;
    manualGmlPath?: string;
    manualKeywordsPath?: string;
    manualTagsPath?: string;
    vmEvalTimeoutMs?: number;
    quiet?: boolean;
}

interface NormalizedGenerateIdentifiersOptions {
    outputPath: string;
    manualRoot: string | null;
    manualPackage: string | null;
    manualGmlPath: string;
    manualKeywordsPath: string;
    manualTagsPath: string;
    vmEvalTimeoutMs: number;
    quiet: boolean;
}

interface RunGenerateIdentifiersContext {
    command?: CommanderCommandLike;
    workflow?: ManualWorkflowOptions["workflow"];
}

interface ManualIdentifierArrayDescriptor {
    identifier?: string;
    source?: string;
}

interface ManualIdentifierMetadata {
    type: string;
    source: string;
}

type DeprecatedReplacementKind = "direct-rename" | "manual-migration" | "none";
type DeprecatedLegacyUsage = "call" | "identifier" | "indexed-identifier" | "call-or-identifier";
type DeprecatedDiagnosticOwner = "gml" | "feather";

type IdentifierMapEntry = {
    type: string;
    sources: Set<string>;
    manualPath?: string;
    tags: Set<string>;
    deprecated: boolean;
    replacement?: string;
    replacementKind?: DeprecatedReplacementKind;
    legacyCategory?: string;
    legacyUsage?: DeprecatedLegacyUsage;
    diagnosticOwner?: DeprecatedDiagnosticOwner;
};

type IdentifierMapMergeData = Readonly<{
    type?: string;
    sources?: ReadonlyArray<string>;
    manualPath?: string;
    tags?: ReadonlyArray<string>;
    deprecated?: boolean;
    replacement?: string;
    replacementKind?: DeprecatedReplacementKind;
    legacyCategory?: string;
    legacyUsage?: DeprecatedLegacyUsage;
    diagnosticOwner?: DeprecatedDiagnosticOwner;
}>;

type LegacySupplement = Readonly<{
    name: string;
    type: string;
    deprecated: true;
    replacement?: string;
    replacementKind?: DeprecatedReplacementKind;
    legacyCategory?: string;
    legacyUsage: DeprecatedLegacyUsage;
    diagnosticOwner?: DeprecatedDiagnosticOwner;
}>;

type ObsoleteIdentifierDescriptor = Readonly<{
    name: string;
    type: string;
    legacyCategory: string;
    legacyUsage: DeprecatedLegacyUsage;
}>;

type ManualDeprecatedReplacement = Readonly<{
    replacement: string;
    replacementKind: DeprecatedReplacementKind;
}>;

type ManualPayloads = Readonly<{
    gmlSource: string;
    keywords: string;
    tags: string;
    obsoleteFunctions: string;
}>;

const DIRECT_RENAME_REPLACEMENT_KIND = "direct-rename" as const satisfies DeprecatedReplacementKind;

const LEGACY_IDENTIFIER_SUPPLEMENTS: ReadonlyArray<LegacySupplement> = Object.freeze([
    Object.freeze({
        name: "os_win32",
        type: "literal",
        deprecated: true,
        replacement: "os_windows",
        replacementKind: DIRECT_RENAME_REPLACEMENT_KIND,
        legacyCategory: "Feather Deprecated Constants",
        legacyUsage: "identifier",
        diagnosticOwner: "feather"
    })
]);

const DIRECT_REPLACEMENT_SUPPLEMENTS = Object.freeze(
    new Map<string, Omit<LegacySupplement, "name" | "deprecated" | "type" | "legacyUsage">>([
        [
            "array_length_1d",
            Object.freeze({
                replacement: "array_length",
                replacementKind: DIRECT_RENAME_REPLACEMENT_KIND,
                legacyCategory: "Deprecated Arrays",
                diagnosticOwner: "feather"
            })
        ],
        [
            "array_height_2d",
            Object.freeze({
                replacement: "array_height",
                replacementKind: DIRECT_RENAME_REPLACEMENT_KIND,
                legacyCategory: "Deprecated Arrays",
                diagnosticOwner: "feather"
            })
        ],
        [
            "array_length_2d",
            Object.freeze({
                replacement: "array_length",
                replacementKind: DIRECT_RENAME_REPLACEMENT_KIND,
                legacyCategory: "Deprecated Arrays",
                diagnosticOwner: "gml"
            })
        ]
    ])
);
export function createGenerateIdentifiersCommand({ env = process.env } = {}) {
    const command = applyStandardCommandOptions(
        new Command()
            .name("generate-gml-identifiers")
            .usage("[options]")
            .description("Generate the gml-identifiers.json artefact from the GameMaker manual.")
    );

    const defaultVmTimeout = getDefaultVmEvalTimeoutMs();
    const envVmTimeout = env?.[IDENTIFIER_VM_TIMEOUT_ENV_VAR];
    const resolvedVmTimeout = envVmTimeout === undefined ? defaultVmTimeout : resolveVmEvalTimeout(envVmTimeout);

    command
        .option("--output <path>", "Path to write gml-identifiers.json.", DEFAULT_OUTPUT_PATH)
        .option("--manual-root <path>", "Override the manual asset root (defaults to vendor/GameMaker-Manual).")
        .option(
            "--manual-package <name>",
            "Manual pnpm package name used when neither --manual-root nor the vendor submodule is available."
        )
        .addOption(
            new Option(
                "--vm-eval-timeout-ms <ms>",
                "Maximum time in milliseconds to evaluate manual identifier arrays. Provide 0 to disable the timeout."
            )
                .argParser(wrapInvalidArgumentResolver(resolveVmEvalTimeout))
                .default(resolvedVmTimeout, String(resolvedVmTimeout))
        )
        .option("--quiet", "Suppress progress logging (useful in CI).")
        .option("--manual-gml-path <path>", "Relative path to the manual gml.js source file.", DEFAULT_GML_SOURCE_PATH)
        .option(
            "--manual-keywords-path <path>",
            "Relative path to the manual keywords JSON file.",
            DEFAULT_KEYWORDS_PATH
        )
        .option("--manual-tags-path <path>", "Relative path to the manual tags JSON file.", DEFAULT_TAGS_PATH);

    return command;
}

function resolveGenerateIdentifierOptions(command?: CommanderCommandLike): NormalizedGenerateIdentifiersOptions {
    const options: GenerateIdentifiersCommandOptions = command?.opts?.() ?? {};

    return {
        outputPath: options.output ?? DEFAULT_OUTPUT_PATH,
        manualRoot: options.manualRoot ?? null,
        manualPackage: options.manualPackage ?? null,
        manualGmlPath: options.manualGmlPath ?? DEFAULT_GML_SOURCE_PATH,
        manualKeywordsPath: options.manualKeywordsPath ?? DEFAULT_KEYWORDS_PATH,
        manualTagsPath: options.manualTagsPath ?? DEFAULT_TAGS_PATH,
        vmEvalTimeoutMs: options.vmEvalTimeoutMs === undefined ? getDefaultVmEvalTimeoutMs() : options.vmEvalTimeoutMs,
        quiet: Boolean(options.quiet)
    };
}

interface ParseArrayLiteralOptions {
    timeoutMs?: number;
}

function parseArrayLiteral(source: string, identifier: string, { timeoutMs }: ParseArrayLiteralOptions = {}) {
    const declaration = `const ${identifier} = [`;
    const start = source.indexOf(declaration);
    if (start === -1) {
        throw new Error(`Could not locate declaration for ${identifier} in gml.js`);
    }
    const bracketStart = source.indexOf("[", start);
    if (bracketStart === -1) {
        throw new Error(`Malformed array literal for ${identifier}`);
    }

    let index = bracketStart;
    let depth = 0;
    let inString;
    let escaped = false;
    while (index < source.length) {
        const char = source[index];
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (char === "\\") {
                escaped = true;
            } else if (char === inString) {
                inString = undefined;
            }
        } else {
            if (char === '"' || char === "'" || char === "`") {
                inString = char;
            } else if (char === "[") {
                depth += 1;
            } else if (char === "]") {
                depth -= 1;
                if (depth === 0) {
                    index += 1;
                    break;
                }
            }
        }
        index += 1;
    }

    const literal = source.slice(bracketStart, index);
    const vmOptions: { timeout?: number } = {};
    if (typeof timeoutMs === "number" && timeoutMs > 0) {
        vmOptions.timeout = timeoutMs;
    }

    try {
        return vm.runInNewContext(literal, {}, vmOptions);
    } catch (error) {
        const message = getErrorMessageOrFallback(error);
        throw new Error(`Failed to evaluate array literal for ${identifier}: ${message}`, { cause: error });
    }
}

const CLASSIFICATION_RULES = [
    {
        type: "function",
        segments: ["functions"],
        tags: ["function", "functions"]
    },
    { type: "method", segments: ["methods"], tags: ["method", "methods"] },
    { type: "event", segments: ["events"], tags: ["event", "events"] },
    {
        type: "variable",
        segments: ["variables"],
        tags: ["variable", "variables"]
    },
    {
        type: "accessor",
        segments: ["accessors"],
        tags: ["accessor", "accessors"]
    },
    {
        type: "property",
        segments: ["properties"],
        tags: ["property", "properties"]
    },
    { type: "macro", segments: ["macros"], tags: ["macro", "macros"] },
    {
        type: "constant",
        segments: ["constants"],
        tags: ["constant", "constants"]
    },
    { type: "enum", segments: ["enums"], tags: ["enum", "enums"] },
    { type: "struct", segments: ["structs"], tags: ["struct", "structs"] }
];

const CO_OCCURRENCE_RULES = [
    { type: "function", requiredSegments: [["layers"], ["functions"]] },
    { type: "constant", requiredSegments: [["shaders"], ["constants"]] }
];

function classifyFromPath(manualPath, tagList) {
    const normalizedTags = toNormalizedLowerCaseSet(tagList);
    const segments = manualPath.split("/").map((part) => part.toLowerCase());

    const segmentMatches = (needle: string) => segments.some((segment) => segment.includes(needle));
    const tagMatches = (needle: string) => normalizedTags.has(needle);

    const matchesAllGroups = (groups: Array<Array<string>> = []) =>
        groups.length > 0 && groups.every((needles) => matchesAny(needles, segmentMatches));

    for (const { type, segments: segmentNeedles = [], tags: tagNeedles = [] } of CLASSIFICATION_RULES) {
        if (matchesAny(segmentNeedles, segmentMatches) || matchesAny(tagNeedles, tagMatches)) {
            return type;
        }
    }

    for (const { type, requiredSegments = [] } of CO_OCCURRENCE_RULES) {
        if (matchesAllGroups(requiredSegments)) {
            return type;
        }
    }

    return "unknown";
}

const TYPE_PRIORITY = new Map([
    ["unknown", 0],
    ["guide", 1],
    ["reference", 1],
    ["keyword", 10],
    ["literal", 20],
    ["symbol", 30],
    ["macro", 40],
    ["constant", 50],
    ["enum", 60],
    ["variable", 70],
    ["property", 72],
    ["accessor", 75],
    ["event", 80],
    ["struct", 82],
    ["method", 85],
    ["function", 90]
]);

const REPLACEMENT_PRIORITY = new Map<DeprecatedReplacementKind, number>([
    ["none", 0],
    ["manual-migration", 1],
    [DIRECT_RENAME_REPLACEMENT_KIND, 2]
]);

function normalizeCellIdentifierText(rawText: string): string {
    return rawText.replaceAll("\u00A0", " ").replaceAll(/\s+/g, "");
}

function extractCellIdentifierText(cell: Element | null | undefined): string | null {
    if (!cell) {
        return null;
    }

    const clone = cell.cloneNode(true) as Element;
    replaceBreakElementsWithNewlines(clone);
    const normalized = normalizeCellIdentifierText(clone.textContent ?? "");
    return normalized.length > 0 ? normalized : null;
}

function looksLikeFunctionIdentifier(identifierName: string): boolean {
    return /^(?:action_|achievement_|ads_|analytics_|audio_|background_(?:get|set|create|add|replace|delete|duplicate|assign|save|prefetch|flush)|buffer_|d3d_|display_|draw_|facebook_|iap_|layer_|matrix_|network_|object_(?:get|set)|playhaven_|pocketchange_|room_|script_|shop_|sound_|steam_|surface_|tile_|vertex_|winphone_)/u.test(
        identifierName
    );
}

function inferLegacyUsageFromIdentifierName(identifierName: string): DeprecatedLegacyUsage {
    if (
        /^(?:background_|view_|show_|caption_|argument_relative$|room_caption$|room_speed$|transition_|game_guid$|error_|gamemaker_|secure_mode$|buffer_surface_copy$|os_)/u.test(
            identifierName
        )
    ) {
        return "identifier";
    }

    return looksLikeFunctionIdentifier(identifierName) ? "call" : "call-or-identifier";
}

function inferLegacyTypeFromUsage(legacyUsage: DeprecatedLegacyUsage): string {
    return legacyUsage === "call" ? "function" : "variable";
}

function parseIndexedLegacyIdentifier(identifierText: string): string | null {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\[\d+\.\.\d+\]$/u.exec(identifierText);
    return match?.[1] ?? null;
}

function normalizeDeprecatedReplacementKind(
    replacementKind: unknown,
    replacement: string | undefined
): DeprecatedReplacementKind {
    if (
        replacementKind === DIRECT_RENAME_REPLACEMENT_KIND ||
        replacementKind === "manual-migration" ||
        replacementKind === "none"
    ) {
        return replacementKind;
    }

    return typeof replacement === "string" && replacement.length > 0 ? DIRECT_RENAME_REPLACEMENT_KIND : "none";
}

function getReplacementPriority(replacementKind: DeprecatedReplacementKind | undefined): number {
    return REPLACEMENT_PRIORITY.get(replacementKind ?? "none") ?? 0;
}

function mergeEntry(map: Map<string, IdentifierMapEntry>, identifier: string, data: IdentifierMapMergeData) {
    const current = map.get(identifier);
    const sourceList = data.sources ?? [];
    const tagList = data.tags ?? [];

    if (!current) {
        const sources = toMutableArray(sourceList);
        const tags = toMutableArray(tagList);

        map.set(identifier, {
            type: data.type ?? "unknown",
            sources: sources.length === 0 ? new Set() : new Set(sources),
            manualPath: data.manualPath,
            tags: tags.length === 0 ? new Set() : new Set(tags),
            deprecated: Boolean(data.deprecated),
            replacement: data.replacement,
            replacementKind: normalizeDeprecatedReplacementKind(data.replacementKind, data.replacement),
            legacyCategory: data.legacyCategory,
            legacyUsage: data.legacyUsage,
            diagnosticOwner: data.diagnosticOwner
        });
        return;
    }

    for (const source of sourceList) {
        current.sources.add(source);
    }
    for (const tag of tagList) {
        current.tags.add(tag);
    }
    if (data.manualPath && !current.manualPath) {
        current.manualPath = data.manualPath;
    }
    if (data.deprecated) {
        current.deprecated = true;
    }
    if (data.legacyCategory && !current.legacyCategory) {
        current.legacyCategory = data.legacyCategory;
    }
    if (data.legacyUsage && !current.legacyUsage) {
        current.legacyUsage = data.legacyUsage;
    }
    if (data.diagnosticOwner && !current.diagnosticOwner) {
        current.diagnosticOwner = data.diagnosticOwner;
    }

    const incomingReplacementKind = normalizeDeprecatedReplacementKind(data.replacementKind, data.replacement);
    if (
        data.replacement &&
        getReplacementPriority(incomingReplacementKind) >= getReplacementPriority(current.replacementKind)
    ) {
        current.replacement = data.replacement;
        current.replacementKind = incomingReplacementKind;
    } else if (
        current.replacement === undefined &&
        getReplacementPriority(incomingReplacementKind) > getReplacementPriority(current.replacementKind)
    ) {
        current.replacementKind = incomingReplacementKind;
    }

    const incomingType = data.type ?? "unknown";
    const currentPriority = TYPE_PRIORITY.get(current.type) ?? 0;
    const incomingPriority = TYPE_PRIORITY.get(incomingType) ?? 0;
    if (incomingPriority > currentPriority) {
        current.type = incomingType;
    }
}

function normalizeIdentifier(name) {
    return name.trim();
}

function describeManualIdentifierArrayValue(value) {
    return describeValueWithArticle(value, {
        emptyStringLabel: "an empty string"
    });
}

function formatManualIdentifierArrayLabel({ identifier, source }: ManualIdentifierArrayDescriptor) {
    const label = source || identifier;
    return label ? `'${label}'` : "manual identifier array";
}

function assertManualIdentifierArray(values: unknown, { identifier, source }: ManualIdentifierArrayDescriptor) {
    const label = formatManualIdentifierArrayLabel({ identifier, source });

    if (!Array.isArray(values)) {
        const description = describeManualIdentifierArrayValue(values);
        throw new TypeError(
            `Manual identifier array ${label} must evaluate to an array of strings. Received ${description}.`
        );
    }

    values.forEach((value, index) => {
        if (typeof value !== "string") {
            const description = describeManualIdentifierArrayValue(value);
            throw new TypeError(
                `Manual identifier array ${label} must contain only strings. Entry at index ${index} was ${description}.`
            );
        }
    });

    return values;
}

function collectManualArrayIdentifiers(
    identifierMap: Map<string, IdentifierMapEntry>,
    values: unknown,
    { type, source }: ManualIdentifierMetadata,
    { identifier }: ManualIdentifierArrayDescriptor = {}
) {
    const normalizedValues = assertManualIdentifierArray(values, {
        identifier,
        source
    });

    const entry = { type, sources: [source] };

    for (const value of normalizedValues) {
        const identifierText = normalizeIdentifier(value);
        mergeEntry(identifierMap, identifierText, entry);
    }
}

const MANUAL_IDENTIFIER_ARRAYS = Object.freeze([
    {
        identifier: "KEYWORDS",
        parseLabel: "Parsing keyword array",
        collectLabel: "Collecting keywords",
        collectOptions: {
            type: "keyword",
            source: "manual:gml.js:KEYWORDS"
        }
    },
    {
        identifier: "LITERALS",
        parseLabel: "Parsing literal array",
        collectLabel: "Collecting literals",
        collectOptions: {
            type: "literal",
            source: "manual:gml.js:LITERALS"
        }
    },
    {
        identifier: "SYMBOLS",
        parseLabel: "Parsing symbol array",
        collectLabel: "Collecting symbols",
        collectOptions: {
            type: "symbol",
            source: "manual:gml.js:SYMBOLS"
        }
    }
]);

const MANUAL_KEYWORD_SOURCE = "manual:ZeusDocs_keywords.json";
const IDENTIFIER_PATTERN = /^[A-Za-z0-9_$.]+$/;

function parseManualIdentifierArrays({ gmlSource, vmEvalTimeoutMs, verbose }) {
    return MANUAL_IDENTIFIER_ARRAYS.map((descriptor) => ({
        descriptor,
        values: timeSync(
            descriptor.parseLabel,
            () =>
                parseArrayLiteral(gmlSource, descriptor.identifier, {
                    timeoutMs: vmEvalTimeoutMs
                }),
            { verbose }
        )
    }));
}

/**
 * Merge parsed manual identifier arrays into the aggregate metadata map.
 *
 * Keeping the collection logic isolated ensures the orchestrator only sequences
 * high-level steps instead of performing Set/Map bookkeeping inline.
 */
function collectParsedManualIdentifierArrays({ identifierMap, parsedArrays, verbose }) {
    for (const { descriptor, values } of parsedArrays) {
        timeSync(
            descriptor.collectLabel,
            () => collectManualArrayIdentifiers(identifierMap, values, descriptor.collectOptions, descriptor),
            { verbose }
        );
    }
}

/**
 * Parse the manual identifier arrays embedded in gml.js and merge their
 * contents into a single identifier metadata map.
 *
 * Centralizing the parsing and collection steps keeps the main command flow
 * focused on orchestration while preserving the original timeSync reporting.
 */
function buildManualIdentifierMap({ gmlSource, vmEvalTimeoutMs, verbose }) {
    const identifierMap = new Map<string, IdentifierMapEntry>();
    const parsedArrays = parseManualIdentifierArrays({
        gmlSource,
        vmEvalTimeoutMs,
        verbose
    });

    collectParsedManualIdentifierArrays({
        identifierMap,
        parsedArrays,
        verbose
    });

    return identifierMap;
}

function shouldIncludeManualReference(normalizedPath) {
    return normalizedPath.startsWith("3_Scripting");
}

function classifyObsoleteTableIdentifiers(
    table: Element,
    legacyCategory: string,
    explicitUsageHint: DeprecatedLegacyUsage | null
): Array<ObsoleteIdentifierDescriptor> {
    const identifiers: Array<ObsoleteIdentifierDescriptor> = [];

    for (const row of table.querySelectorAll("tr")) {
        for (const cell of getDirectElementChildren(row, "td")) {
            const identifierText = extractCellIdentifierText(cell);
            if (!identifierText) {
                continue;
            }

            const indexedIdentifier = parseIndexedLegacyIdentifier(identifierText);
            const normalizedName = indexedIdentifier ?? identifierText;
            const legacyUsage = indexedIdentifier
                ? "indexed-identifier"
                : (explicitUsageHint ?? inferLegacyUsageFromIdentifierName(normalizedName));

            identifiers.push(
                Object.freeze({
                    name: normalizedName,
                    type: inferLegacyTypeFromUsage(legacyUsage),
                    legacyCategory,
                    legacyUsage
                })
            );
        }
    }

    return identifiers;
}

function inferTableLegacyUsage(paragraphText: string | null): DeprecatedLegacyUsage | null {
    if (!paragraphText) {
        return null;
    }

    const normalizedText = paragraphText.replaceAll("\u00A0", " ").toLowerCase();
    if (normalizedText.includes("variables and functions")) {
        return null;
    }
    if (
        normalizedText.includes("functions are obsolete") ||
        normalizedText.includes("functions are considered obsolete")
    ) {
        return "call";
    }
    if (normalizedText.includes("variables are no longer required") || normalizedText.includes("global variables")) {
        return "identifier";
    }

    return null;
}

function parseObsoleteIdentifierTableEntries(
    obsoleteFunctionsHtml: string
): ReadonlyArray<ObsoleteIdentifierDescriptor> {
    const document = parseManualDocument(obsoleteFunctionsHtml);
    const identifiers: Array<ObsoleteIdentifierDescriptor> = [];
    const seenKeys = new Set<string>();

    for (const headingLink of document.querySelectorAll("a.dropspot[data-target]")) {
        const legacyCategory = headingLink.textContent?.replaceAll("\u00A0", " ").replaceAll(/\s+/g, " ").trim() ?? "";
        if (legacyCategory.length === 0) {
            continue;
        }

        const section = headingLink.parentElement?.nextElementSibling;
        if (!section) {
            continue;
        }

        let currentUsageHint: DeprecatedLegacyUsage | null = null;
        for (const child of getDirectElementChildren(section)) {
            if (child.matches?.("p")) {
                currentUsageHint = inferTableLegacyUsage(child.textContent);
                continue;
            }
            if (!child.matches?.("table")) {
                continue;
            }

            for (const identifier of classifyObsoleteTableIdentifiers(child, legacyCategory, currentUsageHint)) {
                const dedupeKey = `${identifier.legacyUsage}:${identifier.name}`;
                if (seenKeys.has(dedupeKey)) {
                    continue;
                }
                seenKeys.add(dedupeKey);
                identifiers.push(identifier);
            }
        }
    }

    return Object.freeze(identifiers);
}

async function collectManualHtmlBasenames(
    directoryPath: string,
    relativeDirectoryPath = ""
): Promise<Map<string, string | null>> {
    const basenames = new Map<string, string | null>();
    const entries = await readdir(directoryPath, { withFileTypes: true });
    const directoryEntries = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => {
            const absolutePath = path.join(directoryPath, entry.name);
            const relativePath =
                relativeDirectoryPath.length > 0 ? path.posix.join(relativeDirectoryPath, entry.name) : entry.name;

            return {
                absolutePath,
                relativePath
            };
        });
    const childBasenameMaps = await Promise.all(
        directoryEntries.map(async ({ absolutePath, relativePath }) => {
            return await collectManualHtmlBasenames(absolutePath, relativePath);
        })
    );

    for (const childBasenames of childBasenameMaps) {
        for (const [basename, candidatePath] of childBasenames) {
            if (!basenames.has(basename)) {
                basenames.set(basename, candidatePath);
                continue;
            }

            const current = basenames.get(basename) ?? null;
            if (current !== candidatePath) {
                basenames.set(basename, null);
            }
        }
    }

    for (const entry of entries) {
        if (entry.isDirectory()) {
            continue;
        }

        if (path.extname(entry.name).toLowerCase() !== ".htm") {
            continue;
        }

        const relativePath =
            relativeDirectoryPath.length > 0 ? path.posix.join(relativeDirectoryPath, entry.name) : entry.name;
        const basename = path.basename(entry.name, ".htm");
        if (!basenames.has(basename)) {
            basenames.set(basename, relativePath.replaceAll(path.sep, "/"));
            continue;
        }

        const current = basenames.get(basename) ?? null;
        if (current !== relativePath) {
            basenames.set(basename, null);
        }
    }

    return basenames;
}

function extractDeprecatedReplacementFromManualHtml(html: string): ManualDeprecatedReplacement | null {
    const directReplacementMatch = /replaced by\s+(?:<span[^>]*>\s*)?<a[^>]*>([A-Za-z_][A-Za-z0-9_]*)\(\)<\/a>/iu.exec(
        html
    );
    if (!directReplacementMatch?.[1]) {
        return null;
    }

    return Object.freeze({
        replacement: directReplacementMatch[1],
        replacementKind: DIRECT_RENAME_REPLACEMENT_KIND
    });
}

function findManualTagEntry(manualTags, normalizedPath) {
    const tagKeyCandidates = [`${normalizedPath}.html`, `${normalizedPath}/index.html`];

    for (const key of tagKeyCandidates) {
        if (manualTags[key]) {
            return manualTags[key];
        }
    }

    return null;
}

function resolveManualTagsForPath(manualTags, normalizedPath) {
    const entry = findManualTagEntry(manualTags, normalizedPath);
    if (!entry) {
        return [];
    }

    return compactArray(entry.split(",").map((tag) => tag.trim()));
}

function isManualEntryDeprecated(normalizedPath, tags) {
    const lowercasePath = normalizedPath.toLowerCase();
    return tags.some((tag) => tag.toLowerCase().includes("deprecated")) || lowercasePath.includes("deprecated");
}

function classifyManualIdentifiers(identifierMap, manualKeywords, manualTags) {
    for (const [rawIdentifier, manualPath] of Object.entries(manualKeywords)) {
        const identifier = normalizeIdentifier(rawIdentifier);
        if (!IDENTIFIER_PATTERN.test(identifier)) {
            continue;
        }

        if (typeof manualPath !== "string" || manualPath.length === 0) {
            continue;
        }

        const normalizedPath = toPosixPath(manualPath);
        if (!shouldIncludeManualReference(normalizedPath)) {
            continue;
        }

        const tags = resolveManualTagsForPath(manualTags, normalizedPath);
        const type = classifyFromPath(normalizedPath, tags);
        const directReplacementSupplement = DIRECT_REPLACEMENT_SUPPLEMENTS.get(identifier);
        const deprecated = isManualEntryDeprecated(normalizedPath, tags) || Boolean(directReplacementSupplement);

        mergeEntry(identifierMap, identifier, {
            type,
            sources: [MANUAL_KEYWORD_SOURCE],
            manualPath: normalizedPath,
            tags,
            deprecated,
            replacement: directReplacementSupplement?.replacement,
            replacementKind: directReplacementSupplement?.replacementKind,
            legacyCategory: directReplacementSupplement?.legacyCategory,
            legacyUsage: directReplacementSupplement ? "call" : type === "function" ? "call" : "identifier",
            diagnosticOwner: directReplacementSupplement?.diagnosticOwner
        });
    }
}

function mergeLegacyIdentifierSupplements(identifierMap: Map<string, IdentifierMapEntry>) {
    for (const supplement of LEGACY_IDENTIFIER_SUPPLEMENTS) {
        mergeEntry(identifierMap, supplement.name, {
            type: supplement.type,
            sources: ["manual:legacy-supplement"],
            deprecated: supplement.deprecated,
            replacement: supplement.replacement,
            replacementKind: supplement.replacementKind,
            legacyCategory: supplement.legacyCategory,
            legacyUsage: supplement.legacyUsage,
            diagnosticOwner: supplement.diagnosticOwner
        });
    }
}

function mergeObsoleteIdentifierEntries(
    identifierMap: Map<string, IdentifierMapEntry>,
    obsoleteIdentifiers: ReadonlyArray<ObsoleteIdentifierDescriptor>
) {
    for (const identifier of obsoleteIdentifiers) {
        mergeEntry(identifierMap, identifier.name, {
            type: identifier.type,
            sources: ["manual:Obsolete_Functions.htm"],
            manualPath: "Additional_Information/Obsolete_Functions",
            tags: ["obsolete_functions"],
            deprecated: true,
            replacementKind: "manual-migration",
            legacyCategory: identifier.legacyCategory,
            legacyUsage: identifier.legacyUsage
        });
    }
}

async function mergeDeprecatedReplacementMetadataFromManualPages(
    identifierMap: Map<string, IdentifierMapEntry>,
    manualRoot: string
) {
    const manualContentsPath = path.join(manualRoot, "Manual", "contents");
    const manualBasenames = await collectManualHtmlBasenames(manualContentsPath);
    const pageCache = new Map<string, string>();
    const unresolvedDeprecatedEntries = Array.from(identifierMap.entries()).reduce<
        Array<{
            identifier: string;
            type: string;
            legacyUsage: DeprecatedLegacyUsage | undefined;
            relativePagePath: string;
        }>
    >((result, [identifier, entry]) => {
        if (!entry.deprecated || entry.replacement !== undefined) {
            return result;
        }

        const relativePagePath = manualBasenames.get(identifier);
        if (relativePagePath === null || relativePagePath === undefined) {
            return result;
        }

        result.push({
            identifier,
            type: entry.type,
            legacyUsage: entry.legacyUsage,
            relativePagePath
        });
        return result;
    }, []);

    const loadedPageEntries = await Promise.all(
        Array.from(
            new Set(unresolvedDeprecatedEntries.map((entry) => entry.relativePagePath)),
            async (relativePagePath) => {
                const pageHtml = await readFile(path.join(manualContentsPath, relativePagePath), "utf8");
                return [relativePagePath, pageHtml] as const;
            }
        )
    );

    for (const [relativePagePath, pageHtml] of loadedPageEntries) {
        pageCache.set(relativePagePath, pageHtml);
    }

    for (const unresolvedEntry of unresolvedDeprecatedEntries) {
        const pageHtml = pageCache.get(unresolvedEntry.relativePagePath);
        if (pageHtml === undefined) {
            continue;
        }

        const replacement = extractDeprecatedReplacementFromManualHtml(pageHtml);
        if (!replacement) {
            continue;
        }

        mergeEntry(identifierMap, unresolvedEntry.identifier, {
            type: unresolvedEntry.type,
            sources: ["manual:deprecated-page"],
            replacement: replacement.replacement,
            replacementKind: replacement.replacementKind,
            legacyUsage: unresolvedEntry.legacyUsage ?? (unresolvedEntry.type === "function" ? "call" : "identifier")
        });
    }
}

function buildIdentifierMapFromManualPayloads({ payloads, vmEvalTimeoutMs, verbose }) {
    return buildManualIdentifierMap({
        gmlSource: payloads?.gmlSource,
        vmEvalTimeoutMs,
        verbose
    });
}

function decodeManualKeywordAndTagPayloads({
    payloads,
    verbose
}: {
    payloads: ManualPayloads;
    verbose: { parsing?: boolean };
}) {
    if (verbose.parsing) {
        console.log("Merging manual keyword metadata…");
    }

    const manualKeywords = timeSync(
        "Decoding ZeusDocs keywords",
        () =>
            decodeManualKeywordsPayload(payloads?.keywords, {
                source: "ZeusDocs_keywords.json"
            }) as Record<string, string>,
        { verbose }
    );
    const manualTags = timeSync(
        "Decoding ZeusDocs tags",
        () =>
            decodeManualTagsPayload(payloads?.tags, {
                source: "ZeusDocs_tags.json"
            }) as Record<string, string>,
        { verbose }
    );

    return { manualKeywords, manualTags };
}

function classifyManualIdentifierMetadata({
    identifierMap,
    manualKeywords,
    manualTags,
    verbose
}: {
    identifierMap: Map<string, IdentifierMapEntry>;
    manualKeywords: Record<string, string>;
    manualTags: Record<string, string>;
    verbose: { parsing?: boolean };
}) {
    timeSync(
        "Classifying manual identifiers",
        () => classifyManualIdentifiers(identifierMap, manualKeywords, manualTags),
        { verbose }
    );
}

function collectObsoleteIdentifierMetadata({
    identifierMap,
    payloads,
    verbose
}: {
    identifierMap: Map<string, IdentifierMapEntry>;
    payloads: ManualPayloads;
    verbose: { parsing?: boolean };
}) {
    timeSync(
        "Collecting obsolete identifier metadata",
        () => {
            mergeObsoleteIdentifierEntries(
                identifierMap,
                parseObsoleteIdentifierTableEntries(payloads.obsoleteFunctions)
            );
            mergeLegacyIdentifierSupplements(identifierMap);
        },
        { verbose }
    );
}

function createIdentifierArtifactPayload({ identifierMap, manualSource, manualCommitHash, verbose }) {
    const sortedIdentifiers = timeSync("Sorting identifiers", () => sortIdentifierEntries(identifierMap), { verbose });

    const identifiersObject = Object.fromEntries(sortedIdentifiers);
    const normalizedEntries = normalizeIdentifierMetadataEntries({
        identifiers: identifiersObject
    });

    if (normalizedEntries.length !== sortedIdentifiers.length) {
        throw new Error("Generated manual identifier metadata contained invalid entries.");
    }

    const identifiers = Object.fromEntries(normalizedEntries.map(({ name, descriptor }) => [name, descriptor]));

    return {
        payload: {
            meta: {
                manualRoot: getManualRootMetadataPath(manualSource),
                packageName: manualSource.packageName,
                packageVersion: manualSource.packageJson?.version ?? null,
                manualCommitHash
            },
            identifiers
        },
        entryCount: normalizedEntries.length
    };
}

/**
 * Transform the raw manual payloads into the final identifier artefact payload
 * while keeping {@link runGenerateGmlIdentifiers} free from map mutations and
 * tag bookkeeping.
 */
async function buildIdentifierArtifact({ payloads, manualSource, manualCommitHash, vmEvalTimeoutMs, verbose }) {
    const identifierMap = buildIdentifierMapFromManualPayloads({
        payloads,
        vmEvalTimeoutMs,
        verbose
    });

    const { manualKeywords, manualTags } = decodeManualKeywordAndTagPayloads({
        payloads,
        verbose
    });

    classifyManualIdentifierMetadata({
        identifierMap,
        manualKeywords,
        manualTags,
        verbose
    });

    collectObsoleteIdentifierMetadata({
        identifierMap,
        payloads,
        verbose
    });

    if (verbose.parsing) {
        console.log("→ Resolving deprecated replacement metadata");
    }
    const logReplacementMetadataCompletion = createVerboseDurationLogger({
        verbose,
        formatMessage: (duration) => `  Resolving deprecated replacement metadata completed in ${duration}.`
    });
    await mergeDeprecatedReplacementMetadataFromManualPages(identifierMap, manualSource.root);
    logReplacementMetadataCompletion();

    return createIdentifierArtifactPayload({
        identifierMap,
        manualSource,
        manualCommitHash,
        verbose
    });
}

async function writeIdentifierArtifact({ outputPath, payload, entryCount, pathFilter }) {
    await writeJsonArtifact({
        outputPath,
        payload,
        pathFilter,
        onAfterWrite: () => {
            console.log(`Wrote ${entryCount} identifiers to ${outputPath}`);
        }
    });
}

function sortIdentifierEntries(identifierMap) {
    return [...identifierMap.entries()]
        .map(([identifier, data]) => [
            identifier,
            {
                type: data.type,
                sources: data.sources ? [...data.sources].toSorted() : [],
                tags: data.tags ? [...data.tags].toSorted() : [],
                ...(data.manualPath ? { manualPath: data.manualPath } : {}),
                deprecated: data.deprecated,
                ...(data.replacement ? { replacement: data.replacement } : {}),
                ...(data.replacementKind && data.replacementKind !== "none"
                    ? { replacementKind: data.replacementKind }
                    : {}),
                ...(data.legacyCategory ? { legacyCategory: data.legacyCategory } : {}),
                ...(data.legacyUsage ? { legacyUsage: data.legacyUsage } : {}),
                ...(data.diagnosticOwner ? { diagnosticOwner: data.diagnosticOwner } : {})
            }
        ])
        .toSorted(([a], [b]) => a.localeCompare(b));
}

async function loadManualPayloads({
    manualSource,
    manualGmlPath,
    manualKeywordsPath,
    manualTagsPath
}: {
    manualSource: { root: string };
    manualGmlPath: string;
    manualKeywordsPath: string;
    manualTagsPath: string;
}): Promise<ManualPayloads> {
    const [gmlSource, keywords, tags, obsoleteFunctions] = await Promise.all([
        readManualText(manualSource.root, manualGmlPath),
        readManualText(manualSource.root, manualKeywordsPath),
        readManualText(manualSource.root, manualTagsPath),
        readManualText(manualSource.root, DEFAULT_OBSOLETE_FUNCTIONS_PATH)
    ]);

    return { gmlSource, keywords, tags, obsoleteFunctions };
}

/**
 * Execute the manual identifier generation workflow.
 *
 * @param {{
 *   command?: import("commander").Command,
 *   workflow?: {
 *       allowPaths?: Iterable<unknown>,
 *       denyPaths?: Iterable<unknown>,
 *       allowsPath?: (candidate: string) => boolean,
 *       allowsDirectory?: (candidate: string) => boolean
 *   }
 * }} [context]
 * @returns {Promise<number>}
 */
export async function runGenerateGmlIdentifiers({ command, workflow }: RunGenerateIdentifiersContext = {}) {
    assertSupportedNodeVersion();

    const {
        outputPath,
        manualRoot,
        manualPackage,
        manualGmlPath,
        manualKeywordsPath,
        manualTagsPath,
        vmEvalTimeoutMs,
        quiet
    } = resolveGenerateIdentifierOptions(command);

    const verboseState = quiet ? {} : { parsing: true };
    const { workflowPathFilter, manualSource } = await prepareManualWorkflow({
        workflow,
        outputPath,
        manualRoot,
        manualPackage,
        quiet,
        formatManualSourceMessage: ({ manualSourceDescription }) =>
            `Using manual assets from ${manualSourceDescription}`
    });

    const payloads = await loadManualPayloads({
        manualSource,
        manualGmlPath,
        manualKeywordsPath,
        manualTagsPath
    });
    const manualCommitHash = resolveManualSourceCommitHash(manualSource);

    const logCompletion = createVerboseDurationLogger({
        verbose: verboseState
    });

    const { payload, entryCount } = await buildIdentifierArtifact({
        payloads,
        manualSource,
        manualCommitHash,
        vmEvalTimeoutMs,
        verbose: verboseState
    });

    await writeIdentifierArtifact({
        outputPath,
        payload,
        entryCount,
        pathFilter: workflowPathFilter
    });
    logCompletion();
    return 0;
}

export const __test__ = Object.freeze({
    parseArrayLiteral,
    collectManualArrayIdentifiers,
    assertManualIdentifierArray,
    extractDeprecatedReplacementFromManualHtml,
    parseObsoleteIdentifierTableEntries
});

if (isMainModule(import.meta.url)) {
    runAsMainModule({
        programName: "generate-gml-identifiers",
        createCommand: createGenerateIdentifiersCommand,
        run: ({ command }) => runGenerateGmlIdentifiers({ command }),
        errorPrefix: "Failed to generate GML identifiers.",
        env: process.env
    });
}
