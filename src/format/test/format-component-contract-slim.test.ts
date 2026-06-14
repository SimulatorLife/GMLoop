/**
 * Regression guard for the slim `GmlFormatComponentContract`.
 *
 * History
 * -------
 * The contract used to list ten fields, but only six of them were ever
 * consumed through the dependency-injection boundary
 * (`printer/comment-print-boundary.ts`). The remaining three
 * (`buildPrintableDocCommentLines`, `countTrailingBlankLines`,
 * `getNextNonWhitespaceCharacter`) were declared and assigned on
 * `defaultGmlFormatComponentImplementations` purely as documentation,
 * while their actual call sites imported the canonical implementations
 * directly. Listing them in the contract implied configurable behavior
 * that did not exist.
 *
 * The contract is now slimmed to only the keys the boundary actually
 * resolves from `options.gml`. The tests in this file prevent accidental
 * re-expansion: if anyone re-adds a dead field, these assertions fail
 * loudly so the simplification can be re-applied.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { defaultGmlFormatComponentImplementations } from "../src/components/default-format-components.js";

void test("default implementation bundle does not re-expose direct-import helpers on the contract", () => {
    const bundle = defaultGmlFormatComponentImplementations;

    // These helpers are imported directly by the printer/comments modules
    // (statement-traversal-spacing.ts, comment-printer.ts, doc-comment-output.ts)
    // and have no consumers in the boundary. They used to be exposed on
    // the contract; re-introducing them would invite a shim that nothing
    // calls.
    assert.equal(
        "buildPrintableDocCommentLines" in bundle,
        false,
        "buildPrintableDocCommentLines must not be re-added to the contract; the doc-comment printer imports it directly"
    );
    assert.equal(
        "countTrailingBlankLines" in bundle,
        false,
        "countTrailingBlankLines must not be re-added to the contract; the layout helpers are imported directly"
    );
    assert.equal(
        "getNextNonWhitespaceCharacter" in bundle,
        false,
        "getNextNonWhitespaceCharacter must not be re-added to the contract; the layout helpers are imported directly"
    );
});

void test("default implementation bundle surfaces only the keys the boundary actually consumes", () => {
    // The contract is the dependency-injection surface for
    // `printer/comment-print-boundary.ts`. The set of keys here must
    // match the set of keys the boundary resolves from `options.gml`,
    // plus the keys the high-level Prettier wiring needs.
    const expectedKeys = [
        "LogicalOperatorsStyle",
        "gmlParserAdapter",
        "handleComments",
        "print",
        "printComment",
        "printDanglingComments",
        "printDanglingCommentsAsGroup"
    ];

    assert.deepStrictEqual(
        Object.keys(defaultGmlFormatComponentImplementations).toSorted(),
        expectedKeys.toSorted(),
        "defaultGmlFormatComponentImplementations must expose only the keys the contract and the high-level Prettier wiring actually use"
    );
});

void test("slim contract still satisfies the high-level Prettier wiring in createGmlFormat", async () => {
    // The factory builds the bundle, injects dangling-comment helpers
    // into defaultOptions.gml, and resolves structural pieces (parsers,
    // printers, options) from the contract. After the slimming, those
    // four required keys must still be present and wired correctly.
    const bundle = defaultGmlFormatComponentImplementations;

    assert.ok(bundle.gmlParserAdapter, "gmlParserAdapter must remain on the contract");
    assert.strictEqual(typeof bundle.gmlParserAdapter.parse, "function");
    assert.strictEqual(typeof bundle.print, "function");
    assert.strictEqual(typeof bundle.printComment, "function");
    assert.ok(bundle.handleComments, "handleComments helper must remain on the contract");
    assert.strictEqual(typeof bundle.printDanglingComments, "function");
    assert.strictEqual(typeof bundle.printDanglingCommentsAsGroup, "function");
    assert.ok(bundle.LogicalOperatorsStyle, "LogicalOperatorsStyle map must remain on the contract");
});
