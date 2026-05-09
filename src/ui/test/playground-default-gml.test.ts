import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_PLAYGROUND_GML_SOURCE, resolveInitialPlaygroundGmlSource } from "../src/app/playground-default-gml.js";

void test("resolveInitialPlaygroundGmlSource falls back to the shared demo for missing persisted input", () => {
    assert.equal(resolveInitialPlaygroundGmlSource(null), DEFAULT_PLAYGROUND_GML_SOURCE);
});

void test("resolveInitialPlaygroundGmlSource falls back to the shared demo for blank persisted input", () => {
    assert.equal(resolveInitialPlaygroundGmlSource(""), DEFAULT_PLAYGROUND_GML_SOURCE);
    assert.equal(resolveInitialPlaygroundGmlSource("   \n\t  "), DEFAULT_PLAYGROUND_GML_SOURCE);
});

void test("resolveInitialPlaygroundGmlSource preserves non-empty persisted input", () => {
    const savedInput = 'show_debug_message("custom demo");';

    assert.equal(resolveInitialPlaygroundGmlSource(savedInput), savedInput);
});
