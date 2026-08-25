import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    DEFAULT_BYTE_FORMAT_RADIX,
    formatBytes,
    formatByteSize,
    formatByteSizeDisplay,
    getDefaultByteFormatRadix,
    setDefaultByteFormatRadix
} from "../src/shared/byte-format.js";

// Prefer `assert.strictEqual` to document Node's supported assertion helper. The
// surrounding expectations exercise the same byte-formatting paths, providing
// regression coverage for the migration away from the deprecated `assert.equal`
// shim.

void describe("byte-format", () => {
    void describe("formatByteSize", () => {
        void it("formats byte counts with default options", () => {
            assert.strictEqual(formatByteSize(0), "0B");
            assert.strictEqual(formatByteSize(512), "512B");
            assert.strictEqual(formatByteSize(2048), "2.0KB");
        });

        void it("supports custom separators and precision", () => {
            assert.strictEqual(
                formatByteSize(512, {
                    decimals: 2,
                    decimalsForBytes: 2,
                    separator: " "
                }),
                "512.00 B"
            );
            assert.strictEqual(
                formatByteSize(5 * 1024 * 1024, {
                    decimals: 2,
                    separator: " ",
                    trimTrailingZeros: true
                }),
                "5 MB"
            );
        });

        void it("formats extremely large bigint values without collapsing to zero", () => {
            const oversizedValue = 10n ** 400n;
            assert.strictEqual(formatByteSize(oversizedValue), "8192.0PB");
        });

        void it("treats non-finite decimal options as zero instead of throwing", () => {
            assert.strictEqual(
                formatByteSize(1536, {
                    decimals: Number.NaN
                }),
                "2KB"
            );

            assert.strictEqual(
                formatByteSize(512, {
                    decimalsForBytes: Number.POSITIVE_INFINITY
                }),
                "512B"
            );
        });

        void it("accepts per-call radix overrides", () => {
            assert.strictEqual(formatByteSize(1000, { radix: 1000 }), "1.0KB");
            assert.strictEqual(formatByteSize(1000, { radix: "invalid" }), "1000B");
        });

        void it("allows adjusting the default radix", () => {
            const originalRadix = getDefaultByteFormatRadix();

            try {
                assert.strictEqual(originalRadix, DEFAULT_BYTE_FORMAT_RADIX);
                setDefaultByteFormatRadix(1000);
                assert.strictEqual(getDefaultByteFormatRadix(), 1000);
                assert.strictEqual(formatByteSize(1000), "1.0KB");
            } finally {
                setDefaultByteFormatRadix(originalRadix);
            }
        });

        void it("clamps counts beyond the largest unit instead of indexing past it", () => {
            // 1024^5 bytes is larger than the largest configured unit (PB), so the
            // implementation must clamp to that unit rather than reading past the
            // end of its unit table.
            assert.strictEqual(formatByteSize(1024 ** 5), "1.0PB");
        });

        void it("clamps negative and non-finite counts to zero bytes", () => {
            assert.strictEqual(formatByteSize(-1024), "0B");
            assert.strictEqual(formatByteSize(Number.NaN), "0B");
            assert.strictEqual(formatByteSize(Number.POSITIVE_INFINITY), "0B");
        });

        void it("keeps values on the correct side of a unit boundary", () => {
            assert.strictEqual(formatByteSize(1023.9, { decimals: 1, decimalsForBytes: 1 }), "1023.9B");
            assert.strictEqual(formatByteSize(1024.1, { decimals: 1 }), "1.0KB");
        });
    });

    void describe("formatByteSizeDisplay", () => {
        void it("reports an invalid-value placeholder for negative, NaN, and Infinity input", () => {
            assert.strictEqual(formatByteSizeDisplay(-1024), "N/A");
            assert.strictEqual(formatByteSizeDisplay(Number.NaN), "N/A");
            assert.strictEqual(formatByteSizeDisplay(Number.POSITIVE_INFINITY), "N/A");
        });

        void it("signs negative values when negatives are explicitly allowed", () => {
            assert.strictEqual(formatByteSizeDisplay(-1024, { allowNegative: true }), "-1.00KB");
        });
    });

    void describe("formatBytes", () => {
        void it("formats string sizes using byte counts", () => {
            assert.strictEqual(formatBytes(""), "0B");
            assert.strictEqual(formatBytes("hello"), "5B");
            assert.strictEqual(formatBytes("a".repeat(2048)), "2.0KB");
        });
    });
});
