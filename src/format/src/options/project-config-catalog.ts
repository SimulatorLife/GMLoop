export type ProjectFormatOptionCatalogEntry = Readonly<{
    defaultValue: boolean | number | string;
    description: string;
    name: string;
}>;

const PROJECT_FORMAT_OPTION_CATALOG: ReadonlyArray<ProjectFormatOptionCatalogEntry> = Object.freeze([
    Object.freeze({
        defaultValue: false,
        description:
            "Keep `if`, `for`, and similar braced control-flow blocks on one line only when the full statement is short and comment-free.",
        name: "allowInlineControlFlowBlocks"
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
        defaultValue: 100,
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
        defaultValue: 4,
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
    }),
    Object.freeze({
        defaultValue: 4,
        description:
            "Minimum number of consecutive variable declarations before inserting blank-line padding before a loop statement. Set to a higher value to reduce automatic padding, or a lower value to increase it.",
        name: "variableDeclarationsBeforeLoopPadding"
    })
]);

/**
 * List formatter-owned `gmloop.json` option metadata for UI and documentation surfaces.
 */
export function listProjectFormatOptionCatalogEntries(): ReadonlyArray<ProjectFormatOptionCatalogEntry> {
    return PROJECT_FORMAT_OPTION_CATALOG;
}
