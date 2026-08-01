import assert from "node:assert/strict";
import { test } from "node:test";

import { Format } from "../src/index.js";

void test("formatter preserves bit-shift assignments without inventing unsupported compound syntax", async () => {
    const source = ["_decoded_colour = _decoded_colour << 4;", ""].join("\n");

    const formatted = await Format.format(source);

    assert.equal(formatted, source);
    assert.doesNotMatch(formatted, /<<=/u);
});
