/**
 * Entry point wiring the GameMaker Language formatter into Prettier.
 *
 * Centralizes the language, parser, printer, and option metadata exports so
 * consumers can register the formatter without reaching into internal modules.
 */

import type { Options as PrettierOptions, SupportLanguage, SupportOptions } from "prettier";

import {
    defaultGmlFormatProvider,
    type GmlFormat,
    type GmlFormatDefaultOptions,
    type GmlFormatProvider
} from "./components/index.js";
import { DEFAULT_CORE_OPTION_OVERRIDES } from "./options/core-option-overrides.js";
import { extractProjectFormatOptions } from "./options/project-config.js";
import { PROJECT_FORMAT_OPTION_CATALOG } from "./options/project-config-catalog.js";

export const languages: SupportLanguage[] = [
    {
        name: "GameMaker Language",
        extensions: [".gml"],
        parsers: ["gml-parse"],
        vscodeLanguageIds: ["gml-gms2", "gml"]
    }
];

function extractOptionDefaults(optionConfigMap: SupportOptions): Record<string, unknown> {
    return Object.fromEntries(
        Object.entries(optionConfigMap)
            .filter(([, config]) => config && Object.hasOwn(config, "default"))
            .map(([name, config]) => [name, (config as { default?: unknown }).default])
    );
}

function createDefaultOptions(provider: GmlFormatProvider): GmlFormatDefaultOptions {
    const coreOptionOverrides = DEFAULT_CORE_OPTION_OVERRIDES;
    const formatOptionDefaults = extractOptionDefaults(provider.components.options);

    return Object.freeze({
        // Merge order:
        // GML Prettier defaults -> option defaults -> fixed overrides
        ...provider.prettierDefaults,
        ...formatOptionDefaults,
        ...coreOptionOverrides
    });
}

/**
 * Create a GML Prettier plugin from an abstract formatter provider.
 *
 * The provider boundary keeps orchestration code independent from concrete
 * parser, printer, comment, Prettier runtime, and output-normalization adapters.
 * Default runtime exports call this factory with the canonical provider, while
 * tests can inject a provider to verify the high-level plugin only depends on
 * the abstraction.
 */
export function createGmlFormat(provider: GmlFormatProvider = defaultGmlFormatProvider): GmlFormat {
    const rawDefaultOptions = createDefaultOptions(provider);
    const defaultOptions: GmlFormatDefaultOptions = Object.freeze({
        ...rawDefaultOptions
    });

    const plugin: GmlFormat = {
        languages,
        parsers: provider.components.parsers,
        printers: provider.components.printers,
        options: provider.components.options,
        defaultOptions,
        extractProjectFormatOptions,
        projectFormatOptionCatalog: PROJECT_FORMAT_OPTION_CATALOG,
        /**
         * Utility function and entry point to format GML source code.
         *
         * This is a thin, deterministic wrapper around the injected Prettier
         * runtime using the GML plugin. It must not inspect `source` to patch the
         * result — doing so would make formatting non-deterministic (same logical
         * structure, different source text → different output), violating
         * target-state.md §3.2.
         *
         * Post-processing that normalises whitespace-only layout details (blank-line
         * collapsing, trailing-newline normalisation, etc.) belongs in
         * `normalizeFormattedOutput`, which operates solely on the already-formatted
         * string and therefore remains deterministic.
         */
        async format(source: string, options: PrettierOptions = {}) {
            const prettierFormatOptions: PrettierOptions = {
                ...options,
                parser: "gml-parse",
                plugins: [plugin]
            };

            const formatted = await provider.formatSource(source, prettierFormatOptions);

            if (typeof formatted !== "string") {
                throw new TypeError("Expected Prettier to return a string result.");
            }

            return formatted;
        },
        normalizeFormattedOutput: provider.normalizeFormattedOutput
    };

    return Object.freeze(plugin);
}

export const Format: GmlFormat = createGmlFormat();
export const parsers = Format.parsers;
export const printers = Format.printers;
export const formatOptions = Format.options;
export const defaultOptions: GmlFormatDefaultOptions = Format.defaultOptions ?? Object.freeze({});
export default Format;
