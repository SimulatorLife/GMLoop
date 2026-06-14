import type { MutableGameMakerAstNode } from "@gmloop/core";
import type { Parser, Plugin as PrettierPlugin, Printer, SupportOptions } from "prettier";

import type { ProjectFormatOptionCatalogEntry } from "../options/project-config-catalog.js";

export type { ProjectFormatOptionCatalogEntry } from "../options/project-config-catalog.js";

export type GmlAst = MutableGameMakerAstNode;

export type GmlParserAdapter = Parser<GmlAst>;
export type GmlPrinter = Printer<GmlAst>;

export type GmlPrintFunction = NonNullable<GmlPrinter["print"]>;
export type GmlPrintCommentFunction = NonNullable<GmlPrinter["printComment"]>;
export type GmlHandleComments = NonNullable<GmlPrinter["handleComments"]>;

/**
 * Loose, dependency-inverted alias for the comment-printer helpers that
 * the printer workspace consumes. The signatures are intentionally
 * permissive because the GML comment helpers operate over loose `path`
 * and `options` shapes; the boundary module in `printer/comment-print-boundary.ts`
 * re-types the injection point so the contract is the single source of
 * truth for what the printer may call.
 */
export type GmlPrintDanglingCommentsFunction = (path: unknown, options: unknown, filter?: unknown) => unknown;
export type GmlPrintDanglingCommentsAsGroupFunction = (path: unknown, options: unknown, filter?: unknown) => unknown;

export type LogicalOperatorsStyleMap = Readonly<{
    KEYWORDS: string;
    SYMBOLS: string;
}>;

/**
 * Minimal dependency-injection contract for the formatter's comment-printer
 * boundary. Only the comment helpers that the printer actively resolves
 * from `options.gml` (see `printer/comment-print-boundary.ts`) belong here.
 * Helpers that the printer imports directly — `buildPrintableDocCommentLines`,
 * `countTrailingBlankLines`, `getNextNonWhitespaceCharacter` — are not
 * listed: they were previously exposed on the contract but no consumer ever
 * resolved them through the injection path, so listing them implied
 * configurable behavior that did not exist.
 */
export type GmlFormatComponentContract = Readonly<{
    gmlParserAdapter: GmlParserAdapter;
    print: GmlPrintFunction;
    handleComments: GmlHandleComments;
    printComment: GmlPrintCommentFunction;
    /**
     * Print a flat list of dangling comments attached to the current node.
     * Wired through the contract so the printer can resolve the helper from
     * `options.gml` instead of importing the concrete comments adapter.
     * (target-state.md §2.3)
     */
    printDanglingComments: GmlPrintDanglingCommentsFunction;
    /**
     * Print a group of dangling comments with preserved leading whitespace
     * and separators. Wired through the contract so the printer can resolve
     * the helper from `options.gml` instead of importing the concrete
     * comments adapter. (target-state.md §2.3)
     */
    printDanglingCommentsAsGroup: GmlPrintDanglingCommentsAsGroupFunction;
    LogicalOperatorsStyle: LogicalOperatorsStyleMap;
}>;

export type GmlFormatComponentBundle = Readonly<{
    parsers: Readonly<Record<string, GmlParserAdapter>>;
    printers: Readonly<Record<string, GmlPrinter>>;
    options: SupportOptions;
}>;

export type GmlFormatDefaultOptions = Record<string, unknown>;

export type GmlFormat = Omit<PrettierPlugin<GmlAst>, "defaultOptions"> & {
    defaultOptions?: GmlFormatDefaultOptions;
    formatOptions?: SupportOptions;
    format: (source: string, options?: Record<string, unknown>) => Promise<string>;
    extractProjectFormatOptions: (config: Record<string, unknown>) => Record<string, unknown>;
    projectFormatOptionCatalog: ReadonlyArray<ProjectFormatOptionCatalogEntry>;
    /**
     * Layout-only post-processing pass applied after Prettier formats the GML
     * source. Owned by the format workspace because all of its
     * transforms are purely layout-level (blank-line collapsing, whitespace
     * normalization, etc.). Content/semantic rewrites are never applied here;
     * those belong in the `@gmloop/lint` workspace.
     */
    normalizeFormattedOutput: (formatted: string) => string;
};
