/**
 * Regression guard: the `printer/comment-print-boundary.ts` shim has been
 * removed in favour of direct imports from the canonical comments
 * subsystem.
 *
 * Why this guard exists
 * ---------------------
 * The boundary module was a backward-compatibility shim that read the
 * `printComment`, `printDanglingComments`, and `printDanglingCommentsAsGroup`
 * helpers from `options.gml` (injected by `format-entry.ts`) and fell
 * back to a direct import of the canonical comments module when the
 * bag was not populated. The shim served no real workload:
 *
 *  - The high-level printer modules (`print.ts`,
 *    `expression-print-utils.ts`) always run through `createGmlFormat`,
 *    so the fallback path was never taken.
 *  - The injection side (`defaultOptions.gml.printDanglingComments`,
 *    …) only existed to feed the read-side shim, and removing the shim
 *    retires the injection alongside it.
 *  - The companion regression guard
 *    `doc-comment-output-legacy-shim-removed.test.ts` already removed the
 *    analogous `buildPrintableDocCommentLines` shim; this test closes
 *    the same loop for the dangling comment printers.
 *
 * If anyone re-introduces a `comment-print-boundary.ts` shim, re-asserts
 * the `options.gml.<helper>` indirection, or stops importing the
 * canonical comment helpers directly, the assertions below fail loudly
 * so the cleanup can be re-applied.
 *
 * (target-state.md §2.3, §3.2 — no backward-compatibility shims; printer
 * depends on the comments subsystem through direct import boundaries.)
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import * as CanonicalComments from "../src/comments/comment-printer.js";
import { defaultGmlFormatComponentImplementations } from "../src/components/default-format-components.js";
import { createGmlFormat, Format } from "../src/format-entry.js";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const FORMAT_PRINTER_DIRECTORY = path.resolve(REPOSITORY_ROOT, "src/format/src/printer");
const FORMAT_ENTRY_PATH = path.resolve(REPOSITORY_ROOT, "src/format/src/format-entry.ts");
const PRINTER_MODULE_NAMES = ["print.ts", "expression-print-utils.ts"];

void test("printer/comment-print-boundary.ts shim file is removed", async () => {
    const shimPath = path.join(FORMAT_PRINTER_DIRECTORY, "comment-print-boundary.ts");
    const shimSource = await readFile(shimPath, "utf8").catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") {
            return null;
        }
        throw error;
    });

    assert.equal(
        shimSource,
        null,
        "printer/comment-print-boundary.ts must not be re-introduced; the canonical comment helpers are imported directly"
    );
});

void test("format-entry no longer injects the dangling-comment helpers into defaultOptions.gml", async () => {
    const source = await readFile(FORMAT_ENTRY_PATH, "utf8");

    assert.doesNotMatch(
        source,
        /printDanglingComments/u,
        "format-entry.ts must not reference printDanglingComments; the injection is retired alongside the read-side shim"
    );
    assert.doesNotMatch(
        source,
        /printDanglingCommentsAsGroup/u,
        "format-entry.ts must not reference printDanglingCommentsAsGroup; the injection is retired alongside the read-side shim"
    );
    assert.doesNotMatch(
        source,
        /defaultOptions\.gml/u,
        "format-entry.ts must not populate defaultOptions.gml; the read-side shim that consumed the bag is gone"
    );
});

void test("printer modules import the canonical comment helpers directly from the comments subsystem", async () => {
    for (const moduleName of PRINTER_MODULE_NAMES) {
        const modulePath = path.join(FORMAT_PRINTER_DIRECTORY, moduleName);
        const source = await readFile(modulePath, "utf8");

        assert.doesNotMatch(
            source,
            /from\s+["']\.\/comment-print-boundary\.js["']/u,
            `${moduleName} must not import the removed shim; import the canonical comment helpers directly`
        );
        assert.match(
            source,
            /from\s+["']\.\.\/comments\/comment-printer\.js["']/u,
            `${moduleName} must import the canonical comment helpers from ../comments/comment-printer.js`
        );
    }
});

void test("defaultGmlFormatComponentImplementations no longer exposes the shim-only helpers", () => {
    const bundle = defaultGmlFormatComponentImplementations;

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

void test("createGmlFormat produces a defaultOptions bag without the retired gml sub-bag", () => {
    const plugin = createGmlFormat();
    const gmlBag = (plugin.defaultOptions as { gml?: Record<string, unknown> } | undefined)?.gml;

    assert.equal(
        gmlBag,
        undefined,
        "defaultOptions.gml must not be populated; the read-side shim that consumed it has been removed"
    );
});

void test("canonical comment helpers are still exported from the comments subsystem", () => {
    // The direct-import path in the printer modules must continue to
    // resolve to the canonical implementations. This test guards against
    // a future rename of the helpers without updating the printer
    // modules in the same change.
    assert.strictEqual(typeof CanonicalComments.printComment, "function");
    assert.strictEqual(typeof CanonicalComments.printDanglingComments, "function");
    assert.strictEqual(typeof CanonicalComments.printDanglingCommentsAsGroup, "function");
});

void test("end-to-end formatting still exercises the canonical comment path", async () => {
    // Round-trip a small GML program that contains a comment through
    // Format.format so the canonical helpers are exercised by the real
    // plugin call path. The previous shim would have allowed callers
    // to override the helpers by populating `options.gml`; with the
    // shim removed, the canonical implementations are the only path
    // and must still produce the expected output.
    const source = [
        "// header comment",
        "var x = 1; // trailing comment",
        "var y = 2;",
        "show_debug_message(x + y);",
        ""
    ].join("\n");

    const formatted = await Format.format(source);

    assert.match(formatted, /\/\/ header comment/u);
    assert.match(formatted, /\/\/ trailing comment/u);
    assert.match(formatted, /var x = 1;/u);
    assert.match(formatted, /var y = 2;/u);
    assert.match(formatted, /show_debug_message\(x \+ y\);/u);
});
