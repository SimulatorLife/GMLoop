import assert from "node:assert/strict";
import test from "node:test";

import {
    GRAPH_RENDER_LABEL_MODE_VALUES,
    GRAPH_RENDER_LABEL_MODES,
    isGraphRenderLabelMode,
    parseGraphRenderLabelMode
} from "../src/graph/graph-render-label-modes.js";
import { shouldRenderGraphLabels } from "../src/graph/graph-render-viewport.js";

void test("GRAPH_RENDER_LABEL_MODES exposes every supported mode in the canonical order", () => {
    assert.deepEqual([...GRAPH_RENDER_LABEL_MODES], ["always", "auto", "hidden"]);
});

void test("GRAPH_RENDER_LABEL_MODE_VALUES tracks GRAPH_RENDER_LABEL_MODES membership exactly", () => {
    assert.equal(GRAPH_RENDER_LABEL_MODE_VALUES.size, GRAPH_RENDER_LABEL_MODES.length);
    for (const mode of GRAPH_RENDER_LABEL_MODES) {
        assert.ok(
            GRAPH_RENDER_LABEL_MODE_VALUES.has(mode),
            `expected GRAPH_RENDER_LABEL_MODE_VALUES to contain ${mode}`
        );
    }
});

void test("isGraphRenderLabelMode accepts every canonical mode", () => {
    for (const mode of GRAPH_RENDER_LABEL_MODES) {
        assert.ok(isGraphRenderLabelMode(mode), `expected "${mode}" to be a valid GraphRenderLabelMode`);
    }
});

void test("isGraphRenderLabelMode rejects lookalike and out-of-vocabulary strings", () => {
    // Common confusion vectors — anything not in the canonical set must be rejected.
    const invalidStrings = [
        "Always", // wrong case
        "ALWAYS",
        "off", // not a supported mode (use "hidden" instead)
        "on", // not a supported mode (use "always" instead)
        "true",
        "false",
        " always", // leading whitespace
        "always ",
        "always\n",
        ""
    ];

    for (const candidate of invalidStrings) {
        assert.equal(isGraphRenderLabelMode(candidate), false, `expected "${candidate}" to be rejected`);
    }
});

void test("isGraphRenderLabelMode rejects non-string values without throwing", () => {
    const nonStrings: ReadonlyArray<unknown> = [null, undefined, 0, 1, true, false, {}, [], Symbol("always")];
    for (const candidate of nonStrings) {
        assert.equal(isGraphRenderLabelMode(candidate), false);
    }
});

void test("parseGraphRenderLabelMode returns the validated mode for valid input", () => {
    assert.equal(parseGraphRenderLabelMode("always"), "always");
    assert.equal(parseGraphRenderLabelMode("auto"), "auto");
    assert.equal(parseGraphRenderLabelMode("hidden"), "hidden");
});

void test("parseGraphRenderLabelMode returns null for invalid input", () => {
    assert.equal(parseGraphRenderLabelMode("ALWAYS"), null);
    assert.equal(parseGraphRenderLabelMode("on"), null);
    assert.equal(parseGraphRenderLabelMode("off"), null);
    assert.equal(parseGraphRenderLabelMode(""), null);
    assert.equal(parseGraphRenderLabelMode(undefined), null);
    assert.equal(parseGraphRenderLabelMode(null), null);
    assert.equal(parseGraphRenderLabelMode(42), null);
});

void test("shouldRenderGraphLabels returns the documented value for every supported mode", () => {
    // "always" — labels are rendered regardless of zoom.
    assert.equal(shouldRenderGraphLabels("always", 0.1), true);
    assert.equal(shouldRenderGraphLabels("always", 8), true);

    // "hidden" — labels are suppressed regardless of zoom.
    assert.equal(shouldRenderGraphLabels("hidden", 0.1), false);
    assert.equal(shouldRenderGraphLabels("hidden", 8), false);

    // "auto" — labels are gated on the zoom threshold.
    assert.equal(shouldRenderGraphLabels("auto", 0.5), false);
    assert.equal(shouldRenderGraphLabels("auto", 1), true);
});

void test("shouldRenderGraphLabels fails fast on invalid string values", () => {
    // Cast through `unknown` so the runtime check is the only thing standing between
    // the caller and an invalid mode. Without the guard, the previous implementation
    // silently fell through to the "auto" zoom heuristic — this regression test pins
    // the new fail-fast behaviour in place.
    const invalidInputs: ReadonlyArray<unknown> = ["Always", "ALWAYS", "on", "off", "", "always ", " always"];

    for (const invalid of invalidInputs) {
        assert.throws(
            () => shouldRenderGraphLabels(invalid as never, 1),
            (error: unknown) => {
                assert.ok(
                    error instanceof RangeError,
                    `expected RangeError, got ${error instanceof Error ? error.message : JSON.stringify(error)}`
                );
                assert.match(
                    error.message,
                    /Unsupported graph label mode/,
                    `expected the error message to call out the offending mode, got: ${error.message}`
                );
                return true;
            },
            `expected shouldRenderGraphLabels to throw on invalid mode ${JSON.stringify(invalid)}`
        );
    }
});
