import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const THIS_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PRINTER_DIRECTORY = path.resolve(THIS_DIRECTORY, "../../src/printer");
const SOURCE_TEXT_SHIM_PATH = path.resolve(PRINTER_DIRECTORY, "source-text.ts");
const PRINTER_INDEX_PATH = path.resolve(PRINTER_DIRECTORY, "index.ts");
const PRINT_PATH = path.resolve(PRINTER_DIRECTORY, "print.ts");
const EXPRESSION_PRINT_UTILS_PATH = path.resolve(PRINTER_DIRECTORY, "expression-print-utils.ts");
const DOC_COMMENT_OUTPUT_PATH = path.resolve(PRINTER_DIRECTORY, "doc-comment-output.ts");
const STATEMENT_TRAVERSAL_SPACING_PATH = path.resolve(PRINTER_DIRECTORY, "statement-traversal-spacing.ts");

void test("printer workspace does not retain a source-text re-export shim", () => {
    assert.strictEqual(
        existsSync(SOURCE_TEXT_SHIM_PATH),
        false,
        "src/format/src/printer/source-text.ts should be removed; call sites should import source-text helpers from @gmloop/core instead of a pass-through re-export shim."
    );
});

void test("printer index.ts does not re-export the removed SourceText namespace", async () => {
    const printerIndexSource = await readFile(PRINTER_INDEX_PATH, "utf8");

    assert.ok(
        !printerIndexSource.includes("export * as SourceText"),
        "Printer index.ts should not re-export a SourceText namespace; consumers should import the helpers directly from @gmloop/core."
    );
});

void test("printer call sites that need source-text helpers reach into Core directly", async () => {
    const sources = await Promise.all([
        readFile(PRINT_PATH, "utf8"),
        readFile(EXPRESSION_PRINT_UTILS_PATH, "utf8"),
        readFile(DOC_COMMENT_OUTPUT_PATH, "utf8"),
        readFile(STATEMENT_TRAVERSAL_SPACING_PATH, "utf8")
    ]);

    for (const source of sources) {
        assert.ok(
            !source.includes('from "./source-text.js"'),
            "printer files should not import from the removed ./source-text.js shim; route through @gmloop/core instead."
        );
    }

    // The helpers exposed by the deleted shim must still be reachable through
    // the Core namespace so call sites keep working without the indirection.
    // Only helpers actually consumed by printer call sites are required; the
    // remaining shim-only helpers (for example, hasBlankLineBeforeLeadingComment)
    // are not exercised by the printer itself and so are not asserted here.
    const requiredCoreHelpers = [
        "getOriginalTextFromOptions",
        "hasBlankLineBetweenLastCommentAndClosingBrace",
        "macroTextHasExplicitTrailingBlankLine",
        "resolveNodeIndexRangeWithSource",
        "resolvePrinterSourceMetadata",
        "sliceOriginalText",
        "stripTrailingLineTerminators"
    ];

    for (const helper of requiredCoreHelpers) {
        const reachedThroughCore = sources.some((source) => source.includes(`Core.${helper}`));
        assert.ok(reachedThroughCore, `Expected at least one printer call site to use Core.${helper}.`);
    }
});
