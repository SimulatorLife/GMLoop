/**
 * Regression guard for the slim `GmlFormatComponentContract`.
 *
 * History
 * -------
 * The contract used to list nine fields, but only six of them were ever
 * consumed through the dependency-injection boundary
 * (`printer/comment-print-boundary.ts`). The remaining three
 * (`buildPrintableDocCommentLines`, `countTrailingBlankLines`,
 * `getNextNonWhitespaceCharacter`) were declared and assigned on
 * `defaultGmlFormatComponentImplementations` purely as documentation,
 * while their actual call sites imported the canonical implementations
 * directly. Listing them in the contract implied configurable behavior
 * that did not exist.
 *
 * The companion
 * `printer-comment-print-boundary-removed.test.ts` removed the
 * `printer/comment-print-boundary.ts` shim itself; the dangling-comment
 * helpers (`printDanglingComments`, `printDanglingCommentsAsGroup`) are
 * now imported directly by the printer modules and have been removed
 * from the contract.
 *
 * The contract is now slimmed to only the keys the high-level Prettier
 * plugin wiring needs: the parser adapter, the printer entry point,
 * the `printComment`/`handleComments` Prettier callbacks, and the
 * `LogicalOperatorsStyle` map. The tests in this file prevent
 * accidental re-expansion: if anyone re-adds a dead field, these
 * assertions fail loudly so the simplification can be re-applied.
 * (target-state.md §2.3, §3.2)
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
    assert.equal(
        "printDanglingComments" in bundle,
        false,
        "printDanglingComments must not be re-added to the contract; the printer imports it directly"
    );
    assert.equal(
        "printDanglingCommentsAsGroup" in bundle,
        false,
        "printDanglingCommentsAsGroup must not be re-added to the contract; the printer imports it directly"
    );
});

void test("default implementation bundle surfaces only the keys the high-level Prettier wiring consumes", () => {
    // The contract is the dependency-injection surface for the
    // high-level Prettier plugin entry point in
    // `format-entry.ts`. The set of keys here must match the keys the
    // Prettier plugin wiring and the `printers` bundle require.
    const expectedKeys = [
        "LogicalOperatorsStyle",
        "canAttachComment",
        "gmlParserAdapter",
        "handleComments",
        "isBlockComment",
        "print",
        "printComment"
    ];

    assert.deepStrictEqual(
        Object.keys(defaultGmlFormatComponentImplementations).toSorted(),
        expectedKeys.toSorted(),
        "defaultGmlFormatComponentImplementations must expose only the keys the contract and the high-level Prettier wiring actually use"
    );
});

void test("slim contract still satisfies the high-level Prettier wiring in createGmlFormat", async () => {
    // The factory builds the bundle, resolves the structural pieces
    // (parsers, printers, options) from the contract, and forwards the
    // Prettier `printComment`/`handleComments` callbacks into the
    // printer bundle. After the slimming, those keys must still be
    // present and wired correctly.
    const bundle = defaultGmlFormatComponentImplementations;

    assert.ok(bundle.gmlParserAdapter, "gmlParserAdapter must remain on the contract");
    assert.strictEqual(typeof bundle.gmlParserAdapter.parse, "function");
    assert.strictEqual(typeof bundle.print, "function");
    assert.strictEqual(typeof bundle.printComment, "function");
    assert.ok(bundle.handleComments, "handleComments helper must remain on the contract");
    assert.ok(bundle.LogicalOperatorsStyle, "LogicalOperatorsStyle map must remain on the contract");
});
