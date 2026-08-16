import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatByteSize } from "../src/shared/byte-format.js";

void describe("formatByteSize precision boundaries", () => {
    void it("clamps finite values beyond the supported display range", () => {
        assert.strictEqual(formatByteSize(Number.MAX_VALUE), "8192.0PB");
        assert.strictEqual(formatByteSize(2 ** 63), "8192.0PB");
    });

    void it("formats exact binary unit boundaries without crossing units", () => {
        assert.strictEqual(formatByteSize(1024), "1.0KB");
        assert.strictEqual(formatByteSize(1024 ** 2), "1.0MB");
        assert.strictEqual(formatByteSize(1024 ** 3), "1.0GB");
    });
});
