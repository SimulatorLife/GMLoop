/**
 * Regression guard for the comment-predicate dependency-inversion seam.
 *
 * History
 * -------
 * The high-level format orchestration module
 * (`default-format-components.ts`) previously reached directly into
 * `@gmloop/core` to forward `Core.isBlockComment` and
 * `Core.canAttachComment` into the Prettier printer bundle. Those
 * classification predicates are adapter-shaped behaviours (they decide
 * where Prettier is allowed to attach comments in the AST), so they
 * belong behind the same dependency-inversion seam that already governs
 * the parser, printer, and comment handlers. The factory in
 * `default-format-components.ts` now consumes a
 * `GmlFormatAdapterResolver.resolveCommentPredicates()` hook instead of
 * importing `@gmloop/core` directly.
 *
 * The assertions in this file pin down that contract:
 *  - The resolver surfaces a `resolveCommentPredicates` method returning
 *    a frozen bundle whose `isBlockComment` and `canAttachComment`
 *    fields are the canonical helpers exported from `@gmloop/core`.
 *  - `createDefaultGmlFormatComponents` forwards those predicates into
 *    the `gml-ast` printer bundle, so the printer keeps the same
 *    behavioural contract as before the seam was introduced.
 *  - The default wiring remains the singleton provided by the resolver,
 *    so hot reloads and test overrides share a stable reference shape.
 *
 * (target-state.md §2.3, §3.2 — orchestration depends on abstractions,
 * not concrete adapters.)
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { Core } from "@gmloop/core";

import {
    defaultGmlFormatAdapterResolver,
    type GmlFormatCommentPredicates
} from "../src/components/default-format-adapters.js";
import { createDefaultGmlFormatComponents, gmlFormatComponents } from "../src/components/default-format-components.js";

void test("resolver exposes resolveCommentPredicates returning a frozen bundle", () => {
    const predicates = defaultGmlFormatAdapterResolver.resolveCommentPredicates();

    assert.ok(
        Object.isFrozen(predicates),
        "default comment predicate bundle should be frozen so consumers cannot mutate the shared reference"
    );

    assert.strictEqual(
        predicates.isBlockComment,
        Core.isBlockComment,
        "default resolver should forward Core.isBlockComment"
    );
    assert.strictEqual(
        predicates.canAttachComment,
        Core.canAttachComment,
        "default resolver should forward Core.canAttachComment"
    );
});

void test("resolver returns a stable comment-predicate reference between calls", () => {
    const first = defaultGmlFormatAdapterResolver.resolveCommentPredicates();
    const second = defaultGmlFormatAdapterResolver.resolveCommentPredicates();

    assert.strictEqual(first, second, "default resolver should hand out the same singleton bundle on every invocation");
});

void test("default component factory wires comment predicates into the printer bundle", () => {
    const printer = gmlFormatComponents.printers["gml-ast"];

    assert.ok(printer, "gml-ast printer should be registered on the default component bundle");
    assert.strictEqual(
        printer?.isBlockComment,
        Core.isBlockComment,
        "printer should expose the resolver-supplied isBlockComment predicate"
    );
    assert.strictEqual(
        printer?.canAttachComment,
        Core.canAttachComment,
        "printer should expose the resolver-supplied canAttachComment predicate"
    );
});

function sentinelIsBlockComment(): boolean {
    return true;
}

function sentinelCanAttachComment(): boolean {
    return false;
}

void test("createDefaultGmlFormatComponents forwards custom resolver predicates", () => {
    const customPredicates: GmlFormatCommentPredicates = Object.freeze({
        isBlockComment: sentinelIsBlockComment,
        canAttachComment: sentinelCanAttachComment
    });
    const seenAdapters = new Set<unknown>();

    const customResolver = {
        resolveAdapters: () => {
            seenAdapters.add("adapters");
            return defaultGmlFormatAdapterResolver.resolveAdapters();
        },
        resolvePrettierDefaults: () => defaultGmlFormatAdapterResolver.resolvePrettierDefaults(),
        resolvePrinterLayoutDefaults: () => defaultGmlFormatAdapterResolver.resolvePrinterLayoutDefaults(),
        resolveNormalizeFormattedOutput: () => defaultGmlFormatAdapterResolver.resolveNormalizeFormattedOutput(),
        resolveCommentPredicates: () => {
            seenAdapters.add("commentPredicates");
            return customPredicates;
        }
    };

    const components = createDefaultGmlFormatComponents(customResolver);
    const printer = components.printers["gml-ast"];

    assert.ok(printer, "custom resolver should still yield a registered printer");
    assert.strictEqual(printer?.isBlockComment, sentinelIsBlockComment);
    assert.strictEqual(printer?.canAttachComment, sentinelCanAttachComment);
    assert.ok(seenAdapters.has("adapters"), "factory should request the adapter bundle from the resolver");
    assert.ok(seenAdapters.has("commentPredicates"), "factory should request the comment predicates from the resolver");
});
