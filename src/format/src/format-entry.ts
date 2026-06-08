/**
 * Entry point wiring the GameMaker Language formatter into Prettier.
 *
 * Centralizes the language, parser, printer, and option metadata exports so
 * consumers can register the formatter without reaching into internal modules.
 */

import prettier, { type SupportLanguage, type SupportOptions } from "prettier";

import {
    defaultGmlFormatComponentImplementations,
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
 * parser, printer, comment, and output-normalization adapters. Default runtime
 * exports call this factory with the canonical provider, while tests can inject
 * a provider to verify the high-level plugin only depends on the abstraction.
 */
export function createGmlFormat(provider: GmlFormatProvider = defaultGmlFormatProvider): GmlFormat {
    // Inject comment-subsystem helpers into the plugin options so the printer
    // can retrieve them via `options.gml.<helper>` without directly importing
    // from `../comments/comment-printer.js` or `../comments/description-doc.js`.
    // This keeps the printer decoupled from the comment subsystem boundary
    // (target-state.md §2.3) and aligns the printer with the dependency
    // inversion pattern already used for `buildPrintableDocCommentLines`.
    const { buildPrintableDocCommentLines, printDanglingComments, printDanglingCommentsAsGroup, printComment } =
        defaultGmlFormatComponentImplementations;

    const rawDefaultOptions = createDefaultOptions(provider);
    const defaultOptions: GmlFormatDefaultOptions = Object.freeze({
        ...rawDefaultOptions,
        // Canonical injectables for the printer's comment subsystems. These
        // are part of the GmlFormatComponentContract and are retrieved by
        // `src/format/src/printer/doc-comment-output.ts` (already) and the
        // new `src/format/src/printer/comment-print-boundary.ts` boundary
        // from `options.gml`, keeping those modules free of direct
        // cross-subsystem imports.
        gml: Object.freeze({
            buildPrintableDocCommentLines,
            printDanglingComments,
            printDanglingCommentsAsGroup,
            printComment
        })
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
        async format(source: string, options: SupportOptions = {}) {
            const prettierFormatOptions: Record<string, unknown> = {
                ...options,
                parser: "gml-parse",
                plugins: [plugin]
            };

            const formatted = await prettier.format(source, prettierFormatOptions);

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
