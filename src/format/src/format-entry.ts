/**
 * Entry point wiring the GameMaker Language formatter into Prettier.
 *
 * Centralizes the language, parser, printer, and option metadata exports so
 * consumers can register the formatter without reaching into internal modules.
 */

import prettier, { type SupportLanguage, type SupportOptions } from "prettier";

import { gmlFormatComponents } from "./components/default-format-components.js";
import type { GmlFormat, GmlFormatDefaultOptions } from "./components/format-types.js";
import { resolveCoreOptionOverrides } from "./options/core-option-overrides.js";
import { extractProjectFormatOptions } from "./options/project-config.js";
import { listProjectFormatOptionCatalogEntries } from "./options/project-config-catalog.js";
import { DEFAULT_PRINT_WIDTH, DEFAULT_TAB_WIDTH } from "./printer/constants.js";
import { normalizeFormattedOutput } from "./printer/normalize-formatted-output.js";

export const parsers = gmlFormatComponents.parsers;
export const printers = gmlFormatComponents.printers;
export const formatOptions = gmlFormatComponents.options;

export const languages: SupportLanguage[] = [
    {
        name: "GameMaker Language",
        extensions: [".gml"],
        parsers: ["gml-parse"],
        vscodeLanguageIds: ["gml-gms2", "gml"]
    }
];

const BASE_PRETTIER_DEFAULTS: Record<string, unknown> = {
    tabWidth: DEFAULT_TAB_WIDTH,
    semi: true,
    printWidth: DEFAULT_PRINT_WIDTH,
    bracketSpacing: false, // Keep false to match existing GML formatting expectations.
    singleQuote: false
};

function extractOptionDefaults(optionConfigMap: SupportOptions): Record<string, unknown> {
    return Object.fromEntries(
        Object.entries(optionConfigMap)
            .filter(([, config]) => config && Object.hasOwn(config, "default"))
            .map(([name, config]) => [name, (config as { default?: unknown }).default])
    );
}

const coreOptionOverrides = resolveCoreOptionOverrides();
const formatOptionDefaults = extractOptionDefaults(formatOptions);

export const defaultOptions: GmlFormatDefaultOptions = Object.freeze({
    // Merge order:
    // GML Prettier defaults -> option defaults -> fixed overrides
    ...BASE_PRETTIER_DEFAULTS,
    ...formatOptionDefaults,
    ...coreOptionOverrides
});

/**
 * Utility function and entry point to format GML source code.
 *
 * This is a thin, deterministic wrapper around `prettier.format()` using the
 * GML plugin. It must not inspect `source` to patch the result — doing so
 * would make formatting non-deterministic (same logical structure, different
 * source text → different output), violating target-state.md §3.2.
 *
 * Post-processing that normalises whitespace-only layout details (blank-line
 * collapsing, trailing-newline normalisation, etc.) belongs in
 * `normalizeFormattedOutput`, which operates solely on the already-formatted
 * string and therefore remains deterministic.
 */
async function format(source: string, options: SupportOptions = {}) {
    const prettierFormatOptions: Record<string, unknown> = {
        ...options,
        parser: "gml-parse",
        plugins: [Format]
    };

    const formatted = await prettier.format(source, prettierFormatOptions);

    if (typeof formatted !== "string") {
        throw new TypeError("Expected Prettier to return a string result.");
    }

    return formatted;
}

export const Format: GmlFormat = {
    languages,
    parsers,
    printers,
    options: formatOptions,
    defaultOptions,
    extractProjectFormatOptions,
    listProjectFormatOptionCatalogEntries,
    format,
    normalizeFormattedOutput
};
export default Format;
