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
export type GmlCanAttachComment = NonNullable<GmlPrinter["canAttachComment"]>;
export type GmlIsBlockComment = NonNullable<GmlPrinter["isBlockComment"]>;

export type LogicalOperatorsStyleMap = Readonly<{
    KEYWORDS: string;
    SYMBOLS: string;
}>;

/**
 * Minimal dependency-injection contract for the formatter's high-level
 * Prettier plugin wiring. The contract only surfaces the helpers required to
 * compose the parser and printer bundles. Concrete AST comment predicates stay
 * behind this boundary alongside the parser, printer, and comment callbacks.
 *
 * Helpers that the printer workspace consumes internally — the dangling
 * comment printers — are imported directly from
 * `../comments/comment-printer.js` by the high-level printer modules.
 * (target-state.md §2.3, §3.2)
 */
export type GmlFormatComponentContract = Readonly<{
    gmlParserAdapter: GmlParserAdapter;
    print: GmlPrintFunction;
    handleComments: GmlHandleComments;
    printComment: GmlPrintCommentFunction;
    canAttachComment: GmlCanAttachComment;
    isBlockComment: GmlIsBlockComment;
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
