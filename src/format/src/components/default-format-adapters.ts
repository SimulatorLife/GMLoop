import prettier from "prettier";

import { handleComments, printComment } from "../comments/index.js";
import { LogicalOperatorsStyle } from "../options/logical-operators-style.js";
import { gmlParserAdapter } from "../parsers/index.js";
import { DEFAULT_PRINT_WIDTH, DEFAULT_TAB_WIDTH } from "../printer/constants.js";
import { print } from "../printer/index.js";
import { normalizeFormattedOutput } from "../printer/normalize-formatted-output.js";
import type { GmlFormatComponentContract, GmlSourceFormatter } from "./format-types.js";
import { DEFAULT_GML_PRINTER_LAYOUT_DEFAULTS, type GmlPrinterLayoutDefaults } from "./printer-layout-defaults.js";

/**
 * Default Prettier option overrides shared by the formatter orchestration.
 *
 * Centralised here so the resolver owns every low-level constant import;
 * the high-level orchestration in `default-format-components.ts` consumes
 * the resolver abstraction and never reaches into the printer/constants
 * module directly.
 */
export type GmlFormatPrettierDefaults = Readonly<{
    tabWidth: number;
    semi: boolean;
    printWidth: number;
    bracketSpacing: boolean;
    singleQuote: boolean;
}>;

export type { GmlPrinterLayoutDefaults } from "./printer-layout-defaults.js";

/**
 * Dependency-inversion seam for the concrete adapters that back the
 * default GML format provider.
 *
 * The high-level orchestration layer (`default-format-components.ts`) and
 * `format-entry.ts` previously reached into low-level directories
 * (`../parsers/`, `../printer/`, `../comments/`) directly to assemble the
 * Prettier plugin. That coupling violated the dependency-inversion
 * principle: orchestration code should depend on abstractions, not on
 * concrete adapter implementations.
 *
 * Resolvers own the concrete selection so the orchestration layer can
 * stay free of those low-level imports. The default implementation lives
 * next to this type so swapping in an alternative resolver (e.g. for
 * tests or alternate embedding contexts) does not require touching the
 * high-level glue that consumes the resolved adapters.
 *
 * (target-state.md §2.3, §3.2 — formatter boundaries stay layout-focused
 * and orchestrated through abstractions.)
 */
export type GmlFormatAdapterResolver = Readonly<{
    resolveAdapters: () => GmlFormatComponentContract;
    resolvePrettierDefaults: () => GmlFormatPrettierDefaults;
    resolvePrinterLayoutDefaults: () => GmlPrinterLayoutDefaults;
    resolveSourceFormatter: () => GmlSourceFormatter;
    resolveNormalizeFormattedOutput: () => (formatted: string) => string;
}>;

const DEFAULT_PRETTIER_OPTIONS: GmlFormatPrettierDefaults = Object.freeze({
    tabWidth: DEFAULT_TAB_WIDTH,
    semi: true,
    printWidth: DEFAULT_PRINT_WIDTH,
    bracketSpacing: false, // Keep false to match existing GML formatting expectations.
    singleQuote: false
});

const DEFAULT_ADAPTERS: GmlFormatComponentContract = Object.freeze({
    gmlParserAdapter,
    print,
    handleComments,
    printComment,
    LogicalOperatorsStyle
});

const DEFAULT_SOURCE_FORMATTER: GmlSourceFormatter = (source, options) => prettier.format(source, options);

/**
 * Default concrete-adapter resolver used by the high-level Prettier
 * plugin wiring.
 *
 * Every low-level import from `../parsers/`, `../printer/`,
 * `../comments/`, `../options/logical-operators-style.js`, and the Prettier
 * runtime is scoped to this module so the orchestration layer can depend on
 * the `GmlFormatAdapterResolver` contract instead. Keeping the concrete
 * selections in one place also makes it obvious where an embedder or test
 * would swap in an alternative resolver.
 */
export const defaultGmlFormatAdapterResolver: GmlFormatAdapterResolver = Object.freeze({
    resolveAdapters: () => DEFAULT_ADAPTERS,
    resolvePrettierDefaults: () => DEFAULT_PRETTIER_OPTIONS,
    resolvePrinterLayoutDefaults: () => DEFAULT_GML_PRINTER_LAYOUT_DEFAULTS,
    resolveSourceFormatter: () => DEFAULT_SOURCE_FORMATTER,
    resolveNormalizeFormattedOutput: () => normalizeFormattedOutput
});
