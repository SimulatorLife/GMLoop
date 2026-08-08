import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const THIS_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PRINTER_DIRECTORY = path.resolve(THIS_DIRECTORY, "../../src/printer");
const SOURCE_TEXT_PATH = path.resolve(PRINTER_DIRECTORY, "source-text.ts");
const PRINT_PATH = path.resolve(PRINTER_DIRECTORY, "print.ts");
const EXPRESSION_PRINT_UTILS_PATH = path.resolve(PRINTER_DIRECTORY, "expression-print-utils.ts");
const DOC_COMMENT_OUTPUT_PATH = path.resolve(PRINTER_DIRECTORY, "doc-comment-output.ts");
const STATEMENT_TRAVERSAL_SPACING_PATH = path.resolve(PRINTER_DIRECTORY, "statement-traversal-spacing.ts");

void test("printer owns the source-text helpers that previously lived in core", () => {
    assert.strictEqual(
        existsSync(SOURCE_TEXT_PATH),
        true,
        "src/format/src/printer/source-text.ts should hold the printer-specific source-text helpers now that the helpers have been moved out of @gmloop/core."
    );
});

void test("printer call sites import source-text helpers directly from the printer-owned module", async () => {
    const sources = await Promise.all([
        readFile(PRINT_PATH, "utf8"),
        readFile(EXPRESSION_PRINT_UTILS_PATH, "utf8"),
        readFile(DOC_COMMENT_OUTPUT_PATH, "utf8")
    ]);

    for (const source of sources) {
        assert.ok(
            source.includes('from "./source-text.js"'),
            "printer files should import the source-text helpers directly from the printer-owned ./source-text.js module rather than reaching into @gmloop/core."
        );
        assert.ok(
            !source.includes("Core.stripTrailingLineTerminators") &&
                !source.includes("Core.getOriginalTextFromOptions") &&
                !source.includes("Core.sliceOriginalText") &&
                !source.includes("Core.resolvePrinterSourceMetadata") &&
                !source.includes("Core.resolveNodeIndexRangeWithSource") &&
                !source.includes("Core.hasBlankLineBetweenLastCommentAndClosingBrace") &&
                !source.includes("Core.macroTextHasExplicitTrailingBlankLine") &&
                !source.includes("Core.hasBlankLineBeforeLeadingComment"),
            "printer files must no longer route source-text helpers through @gmloop/core; the helpers are owned by the format workspace."
        );
    }
});

void test("statement traversal spacing module routes the macro blank-line helper through the printer-owned module", async () => {
    const source = await readFile(STATEMENT_TRAVERSAL_SPACING_PATH, "utf8");

    assert.ok(
        source.includes('from "./source-text.js"'),
        "statement-traversal-spacing should import macroTextHasExplicitTrailingBlankLine directly from the printer-owned ./source-text.js module."
    );
    assert.ok(
        !source.includes("Core.macroTextHasExplicitTrailingBlankLine"),
        "statement-traversal-spacing must no longer route macroTextHasExplicitTrailingBlankLine through @gmloop/core."
    );
});
