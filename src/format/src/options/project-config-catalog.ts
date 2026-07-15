import {
    DEFAULT_GML_PRINTER_LAYOUT_DEFAULTS,
    type GmlPrinterLayoutDefaults
} from "../components/printer-layout-defaults.js";

export type ProjectFormatOptionCatalogEntry = Readonly<{
    defaultValue: boolean | number | string;
    description: string;
    name: string;
}>;

/**
 * Build the formatter-owned `gmloop.json` option catalog from a printer
 * layout defaults seam.
 *
 * `printWidth` and `tabWidth` are the canonical defaults owned by the
 * printer workspace. This module previously imported them directly from
 * `../printer/constants.js`, which violated the dependency-inversion
 * principle: high-level orchestration code should depend on
 * abstractions, not on concrete adapter constants. The defaults are now
 * consumed through the dedicated
 * {@link DEFAULT_GML_PRINTER_LAYOUT_DEFAULTS} seam in
 * `components/printer-layout-defaults.ts` so the catalog and the live
 * printer can never drift apart while the high-level glue remains free
 * of low-level adapter imports.
 *
 * Tests and embedders that need to substitute non-canonical defaults
 * (for example, a different `printWidth`) can pass an explicit
 * `layoutDefaults` argument.
 *
 * (target-state.md §2.3, §3.2 — orchestration depends on abstractions,
 * not concrete adapters.)
 */
export function createProjectFormatOptionCatalog(
    layoutDefaults: GmlPrinterLayoutDefaults = DEFAULT_GML_PRINTER_LAYOUT_DEFAULTS
): ReadonlyArray<ProjectFormatOptionCatalogEntry> {
    return Object.freeze([
        Object.freeze({
            defaultValue: false,
            description:
                "Keep `if`, `for`, and similar braced control-flow blocks on one line only when the full statement is short and comment-free.",
            name: "allowInlineControlFlowBlocks"
        }),
        Object.freeze({
            defaultValue: 0,
            description:
                "Buffer (in characters) added to the inline-length estimate for control-flow blocks before it is compared to `printWidth`. Positive values make the formatter more conservative (requires additional headroom before a block is kept inline); negative values make it more aggressive (allows the inline form to exceed `printWidth` by the configured amount). Has no effect when `allowInlineControlFlowBlocks` is `false`.",
            name: "inlineControlFlowBlockMargin"
        }),
        Object.freeze({
            defaultValue: false,
            description: "Insert spaces inside struct literal braces.",
            name: "bracketSpacing"
        }),
        Object.freeze({
            defaultValue: "lf",
            description: "Normalize output line endings.",
            name: "endOfLine"
        }),
        Object.freeze({
            defaultValue: "keywords",
            description: "Choose whether logical operators are printed as keywords or symbols.",
            name: "logicalOperatorsStyle"
        }),
        Object.freeze({
            defaultValue: "preserve",
            description: "Control whether multi-line object and struct wrapping is preserved or collapsed when safe.",
            name: "objectWrap"
        }),
        Object.freeze({
            defaultValue: layoutDefaults.printWidth,
            description: "Preferred maximum line width for formatting decisions.",
            name: "printWidth"
        }),
        Object.freeze({
            defaultValue: true,
            description: "Emit semicolons where the formatter considers them canonical.",
            name: "semi"
        }),
        Object.freeze({
            defaultValue: false,
            description:
                "GML strings must use double quotes only, so the formatter preserves the source's original quote style and this option has no effect on string literal output.",
            name: "singleQuote"
        }),
        Object.freeze({
            defaultValue: layoutDefaults.tabWidth,
            description: "Indentation width used when tabs are not enabled.",
            name: "tabWidth"
        }),
        Object.freeze({
            defaultValue: "none",
            description: "Trailing commas are locked to `none` because GML argument commas are positional.",
            name: "trailingComma"
        }),
        Object.freeze({
            defaultValue: false,
            description: "Indent with tabs instead of spaces.",
            name: "useTabs"
        })
    ]);
}

/**
 * Formatter-owned `gmloop.json` option metadata for UI and documentation surfaces.
 *
 * Built once at module load time using
 * {@link DEFAULT_GML_PRINTER_LAYOUT_DEFAULTS}. The factory form
 * ({@link createProjectFormatOptionCatalog}) is the dependency-injection
 * seam — embedders or tests can call it with an explicit
 * `layoutDefaults` argument to override the catalog without mutating
 * the shared defaults reference.
 */
export const PROJECT_FORMAT_OPTION_CATALOG: ReadonlyArray<ProjectFormatOptionCatalogEntry> = Object.freeze(
    createProjectFormatOptionCatalog()
);
