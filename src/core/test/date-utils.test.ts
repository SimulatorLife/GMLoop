import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatGeneratedDate } from "../src/utils/capability-probes.js";

void describe("date-utils", () => {
    void it("formats Date instances using only the YYYY-MM-DD portion", () => {
        const utcTimestamp = Date.UTC(2024, 0, 15, 8, 30);
        assert.equal(formatGeneratedDate(new Date(utcTimestamp)), "2024-01-15");
    });

    void it("formats numeric timestamps identically to Date instances", () => {
        const utcTimestamp = Date.UTC(1999, 11, 31);
        assert.equal(formatGeneratedDate(utcTimestamp), "1999-12-31");
    });

    void it("produces a 10-character date string when no value is provided", () => {
        const generated = formatGeneratedDate();
        assert.equal(generated.length, 10);
        assert.ok(generated.includes("-"));
    });
});
