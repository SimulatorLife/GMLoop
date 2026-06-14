import assert from "node:assert/strict";
import { beforeEach, describe, it } from "node:test";

import { __formatTest__ } from "../src/commands/format.js";

const { createFormattingCacheKeyForTests, clearFormattingCacheForTests } = __formatTest__;

void describe("formatting cache memory efficiency", () => {
    beforeEach(() => {
        clearFormattingCacheForTests();
    });

    void it("cache keys should use hash instead of full file content to prevent memory bloat", () => {
        // Simulate a large file (1MB of content)
        const largeContent = "x".repeat(1024 * 1024);

        const formattingOptions = {
            parser: "gml",
            tabWidth: 4,
            printWidth: 80,
            semi: true,
            useTabs: false,
            plugins: []
        };

        const cacheKey = createFormattingCacheKeyForTests(largeContent, formattingOptions);

        // The cache key should be much smaller than the original content
        // In the fixed version, it uses a SHA-256 hash (64 hex chars) instead of the full content
        // The old version would have a key size of ~1MB, the new version should be < 200 bytes
        const keySize = Buffer.byteLength(cacheKey, "utf8");

        assert.ok(keySize < 200, `cache key should be small (got ${keySize} bytes), not contain full file content`);

        // The key should not contain the original content
        assert.ok(!cacheKey.includes(largeContent), "cache key should not include the original file content");

        // The key should contain a hash (64 hex characters for SHA-256)
        // Split by '|' and check the last part is a 64-char hex string
        const parts = cacheKey.split("|");
        const hashPart = parts.at(-1) ?? "";
        assert.equal(hashPart.length, 64, "hash should be 64 characters (SHA-256 hex)");
        assert.ok(/^[0-9a-f]{64}$/.test(hashPart), "hash should be valid hex string");
    });

    void it("different files with same options should have different cache keys based on content hash", () => {
        const content1 = "function foo() { return 1; }";
        const content2 = "function bar() { return 2; }";

        const formattingOptions = {
            parser: "gml",
            tabWidth: 4,
            printWidth: 80,
            semi: true,
            useTabs: false,
            plugins: []
        };

        const key1 = createFormattingCacheKeyForTests(content1, formattingOptions);
        const key2 = createFormattingCacheKeyForTests(content2, formattingOptions);

        // Keys should be different because content hashes are different
        assert.notEqual(key1, key2, "cache keys should be different for different content");

        // Both keys should be small
        assert.ok(Buffer.byteLength(key1, "utf8") < 200, "key1 should be small");
        assert.ok(Buffer.byteLength(key2, "utf8") < 200, "key2 should be small");
    });

    void it("identical content with same options should produce identical cache key", () => {
        const content = "function test() { return true; }";

        const formattingOptions = {
            parser: "gml",
            tabWidth: 4,
            printWidth: 80,
            semi: true,
            useTabs: false,
            plugins: []
        };

        const key1 = createFormattingCacheKeyForTests(content, formattingOptions);
        const key2 = createFormattingCacheKeyForTests(content, formattingOptions);

        // Keys should be identical for identical content and options
        assert.equal(key1, key2, "identical content should produce identical cache key");
    });

    void it("same content with different options should have different cache keys", () => {
        const content = "function test() { return true; }";

        const options1 = {
            parser: "gml",
            tabWidth: 4,
            printWidth: 80,
            semi: true,
            useTabs: false,
            plugins: []
        };

        const options2 = {
            parser: "gml",
            tabWidth: 2,
            printWidth: 80,
            semi: true,
            useTabs: false,
            plugins: []
        };

        const key1 = createFormattingCacheKeyForTests(content, options1);
        const key2 = createFormattingCacheKeyForTests(content, options2);

        // Keys should be different because options differ
        assert.notEqual(key1, key2, "different options should produce different cache keys");
    });

    void it("cache key size should be constant regardless of file size", () => {
        const formattingOptions = {
            parser: "gml",
            tabWidth: 4,
            printWidth: 80,
            semi: true,
            useTabs: false,
            plugins: []
        };

        // Test with various file sizes
        const smallContent = "x = 1;";
        const mediumContent = "x".repeat(10 * 1024); // 10KB
        const largeContent = "x".repeat(1024 * 1024); // 1MB

        const smallKey = createFormattingCacheKeyForTests(smallContent, formattingOptions);
        const mediumKey = createFormattingCacheKeyForTests(mediumContent, formattingOptions);
        const largeKey = createFormattingCacheKeyForTests(largeContent, formattingOptions);

        const smallKeySize = Buffer.byteLength(smallKey, "utf8");
        const mediumKeySize = Buffer.byteLength(mediumKey, "utf8");
        const largeKeySize = Buffer.byteLength(largeKey, "utf8");

        // All keys should be approximately the same size (hash-based)
        assert.equal(
            smallKeySize,
            mediumKeySize,
            "key size should be constant regardless of content size (small vs medium)"
        );
        assert.equal(
            mediumKeySize,
            largeKeySize,
            "key size should be constant regardless of content size (medium vs large)"
        );

        // All should be small
        assert.ok(smallKeySize < 200, "key should be small regardless of content size");
    });
});
