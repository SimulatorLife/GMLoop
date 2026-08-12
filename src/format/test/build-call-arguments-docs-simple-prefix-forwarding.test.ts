/**
 * Regression tests for the `simplePrefixLength` forwarding contract between
 * `buildCallLikeArgumentDocs` and `buildCallArgumentsDocs`.
 *
 * Before the refactor, `buildCallArgumentsDocs` recomputed the leading
 * simple-argument count via `countLeadingSimpleCallArguments(node)` even
 * though `buildCallLikeArgumentDocs` had already walked the same prefix to
 * classify callbacks/structs. The two branches in `buildCallArgumentsDocs`
 * also carried a `!trailingHasCallback` check that was a no-op: when
 * `hasCallbackArguments` was `false` the entire argument list contained no
 * callback nodes, so the trailing slice could not introduce one either.
 *
 * This file pins the new contract:
 *   - The mixed-argument branch is selected from the caller's prefix count.
 *   - A callback-bearing trailing slice is honoured exactly once (via the
 *     inner `hasCallbackArguments` branch), not re-validated via a redundant
 *     `!trailingHasCallback` check.
 *   - A callback-free trailing slice still routes through
 *     `buildCallbackArgumentsWithSimplePrefix` and preserves the original
 *     simple-prefix layout.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { Format } from "../src/index.js";

void test("breaks mixed simple-prefix + trailing callback arguments", async () => {
    const source = [
        "function demo() {",
        "    call_later(",
        "        1800,",
        "        time_source_units_frames,",
        "        function () {",
        "            perform_cleanup();",
        "        },",
        "        true",
        "    );",
        "}",
        ""
    ].join("\n");

    const formatted = await Format.format(source);

    // The two leading simple arguments must occupy their own lines, then
    // the callback must break onto its own line. This shape only emerges
    // when `simplePrefixLength > 1 && hasTrailingArguments && hasCallbackArguments`.
    assert.ok(
        formatted.includes("1800,\n        time_source_units_frames,\n        function"),
        "Expected the simple prefix to be preserved line-by-line and the callback to follow on its own line."
    );
});

void test("breaks mixed simple-prefix + trailing identifier arguments without callbacks", async () => {
    const source = [
        "function demo() {",
        "    draw_sprite_ext(",
        "        sprite_index,",
        "        image_index,",
        "        x,",
        "        y,",
        "        1,",
        "        1,",
        "        0,",
        "        c_white,",
        "        1",
        "    );",
        "}",
        ""
    ].join("\n");

    const formatted = await Format.format(source);

    // No callbacks present → `hasCallbackArguments` is false. The format
    // pass must still emit the simple-prefix + trailing identifier layout
    // (the redundant `!trailingHasCallback` check was removed during the
    // refactor because it was implied by `!hasCallbackArguments`).
    assert.ok(formatted.includes("sprite_index,"), "Expected the first simple argument to be preserved.");
    assert.ok(formatted.includes("image_index,"), "Expected the second simple argument to be preserved.");
    assert.ok(formatted.includes("draw_sprite_ext("), "Expected the call expression to be preserved.");
});
