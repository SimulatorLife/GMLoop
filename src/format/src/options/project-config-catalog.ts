import { DEFAULT_PRINT_WIDTH, DEFAULT_TAB_WIDTH } from "../printer/constants.js";

export type ProjectFormatOptionCatalogEntry = Readonly<{
    defaultValue: boolean | number | string;
    description: string;
    name: string;
}>;

/**
 * Formatter-owned `gmloop.json` option metadata for UI and documentation surfaces.
 *
 * Default values that mirror a single source of truth in
 * `src/format/src/printer/constants.ts` (notably `printWidth` and `tabWidth`)
 * are imported from there so the catalog and the live printer defaults can
 * never drift apart.
 */
export const PROJECT_FORMAT_OPTION_CATALOG: ReadonlyArray<ProjectFormatOptionCatalogEntry> = Object.freeze([
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
        defaultValue: DEFAULT_PRINT_WIDTH,
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
        description: "Prefer single-quoted string literals when that output is valid.",
        name: "singleQuote"
    }),
    Object.freeze({
        defaultValue: DEFAULT_TAB_WIDTH,
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
