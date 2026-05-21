import type { MutableGameMakerAstNode } from "@gmloop/core";
import type { Parser, Plugin as PrettierPlugin, Printer, SupportOptions } from "prettier";

export type GmlAst = MutableGameMakerAstNode;

export type GmlParserAdapter = Parser<GmlAst>;
export type GmlPrinter = Printer<GmlAst>;

export type GmlPrintFunction = NonNullable<GmlPrinter["print"]>;
export type GmlPrintCommentFunction = NonNullable<GmlPrinter["printComment"]>;
export type GmlHandleComments = NonNullable<GmlPrinter["handleComments"]>;

export type LogicalOperatorsStyleMap = Readonly<{
    KEYWORDS: string;
    SYMBOLS: string;
}>;

export type GmlFormatComponentContract = Readonly<{
    gmlParserAdapter: GmlParserAdapter;
    print: GmlPrintFunction;
    handleComments: GmlHandleComments;
    printComment: GmlPrintCommentFunction;
    LogicalOperatorsStyle: LogicalOperatorsStyleMap;
}>;

export type GmlFormatComponentBundle = Readonly<{
    parsers: Readonly<Record<string, GmlParserAdapter>>;
    printers: Readonly<Record<string, GmlPrinter>>;
    options: SupportOptions;
}>;

export type GmlFormatDefaultOptions = Record<string, unknown>;

export type ProjectFormatOptionCatalogEntry = Readonly<{
    defaultValue: boolean | number | string;
    description: string;
    name: string;
}>;

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
