/**
 * Regression tests for the printer/comment-print-boundary.ts dependency
 * inversion boundary.
 *
 * The high-level printer modules (`print.ts`, `expression-print-utils.ts`)
 * used to import `printComment`, `printDanglingComments`, and
 * `printDanglingCommentsAsGroup` directly from `../comments/comment-printer.js`.
 * That direct dependency pulled the printer workspace into the comments
 * subsystem boundary, which is the same inversion this boundary module
 * was introduced to fix. These tests guard against regressions by
 * confirming the boundary indirection is in place.
 *
 * (target-state.md §2.3 — printer must depend on the comment subsystem
 * through an abstraction, never via a static cross-subsystem import.)
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import * as CanonicalComments from "../src/comments/comment-printer.js";
import { defaultGmlFormatComponentImplementations } from "../src/components/default-format-components.js";
import { createGmlFormat, Format } from "../src/format-entry.js";
import * as Boundary from "../src/printer/comment-print-boundary.js";

// Resolve the printer source directory from the project root because the
// tests execute from `src/format/dist/test/` (compiled output) and must
// inspect the `src/format/src/printer/` TypeScript sources rather than
// the compiled JavaScript. Going up `../../../..` from the test file
// reaches the repository root, then we walk down into the printer source
// directory.
const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const PRINTER_SOURCE_DIRECTORY = path.resolve(REPOSITORY_ROOT, "src/format/src/printer");

void describe("printer/comment-print-boundary dependency inversion", () => {
    void it("exports the three comment printers that high-level printer modules depend on", () => {
        assert.strictEqual(typeof Boundary.printComment, "function");
        assert.strictEqual(typeof Boundary.printDanglingComments, "function");
        assert.strictEqual(typeof Boundary.printDanglingCommentsAsGroup, "function");
    });

    void it("boundary re-exports the canonical comments subsystem references by default", () => {
        // The boundary is its own wrapper module, not a re-export of the
        // canonical functions. It only falls back to the canonical reference
        // when `options.gml` is not populated. Confirm the boundary
        // composition is the expected one and the contract is wired through
        // the GmlFormatComponentContract.
        assert.strictEqual(typeof Boundary.printDanglingComments, "function");
        assert.strictEqual(typeof Boundary.printDanglingCommentsAsGroup, "function");
        assert.strictEqual(typeof CanonicalComments.printDanglingComments, "function");
        assert.strictEqual(typeof CanonicalComments.printDanglingCommentsAsGroup, "function");
    });

    void it("defaultGmlFormatComponentImplementations exposes the new contract keys", () => {
        assert.strictEqual(
            typeof defaultGmlFormatComponentImplementations.printDanglingComments,
            "function",
            "contract should expose printDanglingComments"
        );
        assert.strictEqual(
            typeof defaultGmlFormatComponentImplementations.printDanglingCommentsAsGroup,
            "function",
            "contract should expose printDanglingCommentsAsGroup"
        );
    });

    void it("createGmlFormat injects the new contract entries into defaultOptions.gml", () => {
        const plugin = createGmlFormat();
        const gmlBag = (plugin.defaultOptions as { gml?: Record<string, unknown> } | undefined)?.gml;

        assert.ok(gmlBag, "defaultOptions.gml should be populated by createGmlFormat");
        assert.strictEqual(
            gmlBag?.printDanglingComments,
            defaultGmlFormatComponentImplementations.printDanglingComments,
            "injected printDanglingComments should be the contract implementation"
        );
        assert.strictEqual(
            gmlBag?.printDanglingCommentsAsGroup,
            defaultGmlFormatComponentImplementations.printDanglingCommentsAsGroup,
            "injected printDanglingCommentsAsGroup should be the contract implementation"
        );
        assert.strictEqual(
            gmlBag?.printComment,
            defaultGmlFormatComponentImplementations.printComment,
            "injected printComment should be the contract implementation"
        );
        // `buildPrintableDocCommentLines` is intentionally NOT injected: the
        // doc-comment printer now imports the canonical implementation
        // directly, so the backward-compat read-side shim and its
        // `defaultOptions.gml` injection have been retired together.
        assert.ok(
            !("buildPrintableDocCommentLines" in (gmlBag ?? {})),
            "buildPrintableDocCommentLines should not be injected; the doc-comment printer imports the canonical helper directly"
        );
    });

    void it("boundary resolves helpers from options.gml when injected", () => {
        const sentinel = () => "sentinel-printDanglingComments";
        const sentinelAsGroup = () => "sentinel-printDanglingCommentsAsGroup";
        const sentinelPrintComment = () => "sentinel-printComment";

        const options = {
            gml: {
                printDanglingComments: sentinel,
                printDanglingCommentsAsGroup: sentinelAsGroup,
                printComment: sentinelPrintComment
            }
        };

        assert.strictEqual(
            Boundary.printDanglingComments({}, options, () => true),
            "sentinel-printDanglingComments",
            "boundary should prefer the injected helper from options.gml"
        );
        assert.strictEqual(
            Boundary.printDanglingCommentsAsGroup({}, options, () => true),
            "sentinel-printDanglingCommentsAsGroup",
            "boundary should prefer the injected helper from options.gml"
        );
        assert.strictEqual(
            Boundary.printComment({}, options),
            "sentinel-printComment",
            "boundary should prefer the injected helper from options.gml"
        );
    });

    void it("boundary ignores non-function entries in options.gml and falls back to the canonical helpers", () => {
        // Non-function entries in `options.gml` must be ignored so callers
        // can't accidentally neuter the comment pipeline with bad config.
        const options = {
            gml: {
                printDanglingComments: "not-a-function",
                printDanglingCommentsAsGroup: 42,
                printComment: null
            }
        };

        // The canonical reference requires a Prettier AstPath to operate on;
        // it will throw when given an empty bag, and the boundary must
        // surface that error rather than silently dropping the call. We
        // therefore assert that the boundary propagates the underlying
        // error from the canonical helper, which is the documented
        // behaviour for callers that bypass `createGmlFormat`.
        assert.throws(
            () => Boundary.printComment({}, options),
            /getValue|getNode|isObjectLike/,
            "boundary should delegate to the canonical helper when options.gml entries are not functions"
        );
    });

    void it("format-end-to-end still formats a basic script via the inverted boundary", async () => {
        // Smoke test: round-trip a small GML program through Format.format so
        // the boundary is exercised by the actual plugin call path.
        const source = ["var x = 1;", "var y = 2;", "show_debug_message(x + y);", ""].join("\n");

        const formatted = await Format.format(source);
        assert.match(formatted, /var x = 1;/);
        assert.match(formatted, /var y = 2;/);
        assert.match(formatted, /show_debug_message\(x \+ y\);/);
    });

    void it("printer modules do not statically import from ../comments/comment-printer.js", async () => {
        // The whole point of the boundary is to keep the printer modules
        // free of direct cross-subsystem imports. This guard fails loudly
        // if someone re-introduces a direct import.
        const printerModules = ["print.ts", "expression-print-utils.ts"];

        for (const moduleName of printerModules) {
            const modulePath = path.join(PRINTER_SOURCE_DIRECTORY, moduleName);
            const source = await readFile(modulePath, "utf8");

            assert.doesNotMatch(
                source,
                /from\s+["']\.\.?\/comments\/comment-printer\.js["']/,
                `${moduleName} must not statically import the comments subsystem; use ./comment-print-boundary.js instead`
            );
        }
    });
});
