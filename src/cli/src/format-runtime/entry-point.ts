import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { Core } from "@gmloop/core";

import { resolveFromRepoRoot } from "../shared/workspace-paths.js";

const { compactArray, createListSplitPattern, getNonEmptyTrimmedString, normalizeStringList, toArray, uniqueArray } =
    Core;

/**
 * Abstract shape of the format workspace's module namespace.
 *
 * The high-level CLI orchestration in `commands/format.ts` previously
 * reached into the dynamically imported format module with inline casts
 * like `(moduleValue as { Format?: { normalizeFormattedOutput?: ... } })`,
 * which coupled the CLI to the format workspace's internal namespace
 * shape. Centralising that shape in one contract keeps the CLI
 * dependent on a documented abstraction rather than on the concrete
 * module layout, and lets the runtime expose a single typed entry point
 * for the public surface the CLI actually consumes.
 *
 * Only the methods the CLI needs are declared on the contract — the
 * parser, printer, and comment helpers stay encapsulated inside the
 * format workspace's `Format` namespace, and consumers should reach the
 * rest of the Prettier plugin surface through `@gmloop/format`'s
 * static entry point.
 *
 * (target-state.md §2.3, §3.2 — orchestration depends on abstractions,
 * not concrete adapter layouts.)
 */
export type FormatModuleContract = Readonly<{
    Format?: Readonly<{
        extractProjectFormatOptions?: (config: Record<string, unknown>) => Record<string, unknown>;
        normalizeFormattedOutput?: (formatted: string) => string;
    }>;
}>;

// Default format workspace entry points shipped within the workspace. Additional
// candidates can be provided via environment variables or call-site overrides.
const DEFAULT_CANDIDATE_FORMAT_PATHS = Object.freeze([
    ["src", "format", "dist", "src", "format-entry.js"],
    ["src", "format", "dist", "index.js"],
    ["src", "format", "dist", "src", "index.js"],
    ["src", "format", "src", "format-entry.js"],
    ["src", "format", "src", "index.js"],
    ["src", "format", "index.js"]
]);

const LIST_SPLIT_PATTERN = createListSplitPattern(compactArray([",", path.delimiter]));

// Normalize caller-provided options so destructuring guards against
// `null`/primitive inputs instead of throwing TypeError when accessing
// properties on non-object values.
function normalizeOptionsBag(options) {
    if (!options || typeof options !== "object") {
        return {
            env: process.env,
            candidates: []
        };
    }

    const normalizedOptions = options as { env?: NodeJS.ProcessEnv; candidates?: unknown };

    return {
        env: normalizedOptions.env ?? process.env,
        candidates: toArray(normalizedOptions.candidates)
    };
}

function expandLeadingTilde(candidate) {
    if (typeof candidate !== "string" || candidate[0] !== "~") {
        return candidate;
    }

    const nextCharacter = candidate[1];
    const hasExplicitHomeReference = nextCharacter === undefined || nextCharacter === "/" || nextCharacter === "\\";

    if (!hasExplicitHomeReference) {
        return candidate;
    }

    const homeDirectory = os.homedir();
    if (!homeDirectory) {
        return candidate;
    }

    if (candidate.length === 1) {
        return homeDirectory;
    }

    const remainder = candidate.slice(2);
    const normalizedRemainder = remainder.replace(/^[/\\]+/, "");

    if (!normalizedRemainder) {
        return homeDirectory;
    }

    return path.join(homeDirectory, normalizedRemainder);
}

function getEnvironmentCandidates(env) {
    const rawValue = env?.PRETTIER_PLUGIN_GML_FORMAT_PATHS ?? env?.PRETTIER_PLUGIN_GML_FORMAT_PATH;

    const trimmed = getNonEmptyTrimmedString(rawValue);
    if (!trimmed) {
        return [];
    }

    return normalizeStringList(trimmed, {
        splitPattern: LIST_SPLIT_PATTERN,
        allowInvalidType: true
    });
}

function resolveCandidatePath(candidate) {
    if (!candidate) {
        return null;
    }

    if (Array.isArray(candidate)) {
        return resolveFromRepoRoot(...candidate);
    }

    if (typeof candidate === "string") {
        const trimmed = getNonEmptyTrimmedString(candidate);
        if (!trimmed) {
            return null;
        }

        const expanded = expandLeadingTilde(trimmed);

        if (path.isAbsolute(expanded)) {
            return expanded;
        }

        return resolveFromRepoRoot(expanded);
    }

    return null;
}

function candidateExistsAsFile(candidate) {
    try {
        const stats = fs.statSync(candidate);
        return stats.isFile();
    } catch {
        return false;
    }
}

export function resolveFormatEntryPoint(options = {}) {
    const normalizedOptions = normalizeOptionsBag(options);
    const resolvedCandidates = uniqueArray(
        compactArray(
            [
                ...normalizedOptions.candidates,
                ...getEnvironmentCandidates(normalizedOptions.env),
                ...DEFAULT_CANDIDATE_FORMAT_PATHS
            ].map((candidate) => resolveCandidatePath(candidate))
        )
    );

    for (const candidate of resolvedCandidates) {
        if (candidateExistsAsFile(candidate)) {
            return candidate;
        }
    }

    throw new Error(
        `Unable to locate the Prettier format workspace entry point. Expected one of: ${resolvedCandidates.join(", ")}`
    );
}

export function importFormatModule(options = {}) {
    const formatPath = resolveFormatEntryPoint(options);
    return import(pathToFileURL(formatPath).href);
}

/**
 * Resolve the format workspace's module as the documented
 * {@link FormatModuleContract}.
 *
 * This is the dependency-inversion seam for the CLI's runtime
 * dependency on the format workspace. High-level orchestration code in
 * `commands/format.ts` should depend on this typed contract rather than
 * reaching into the raw module namespace or repeating the inline casts
 * that used to live at every call site.
 *
 * The implementation reuses {@link importFormatModule} so the runtime
 * resolution behaviour (candidate ordering, environment overrides,
 * tilde expansion, missing-file fallback) is preserved exactly; only
 * the return type is narrowed to the contract the CLI actually needs.
 */
export async function resolveFormatModule(options = {}): Promise<FormatModuleContract> {
    const moduleValue = await importFormatModule(options);
    return moduleValue as FormatModuleContract;
}
