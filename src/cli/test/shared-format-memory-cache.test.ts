import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
    applyMaxFormattingCacheEntriesEnvOverride,
    getDefaultMaxFormattingCacheEntries,
    setDefaultMaxFormattingCacheEntries
} from "../src/runtime-options/format-memory-cache.js";
import {
    DEFAULT_MAX_FORMATTING_CACHE_ENTRIES,
    MAX_FORMATTING_CACHE_ENTRIES_ENV_VAR
} from "../src/runtime-options/format-memory-constants.js";

const originalEnvValue = process.env[MAX_FORMATTING_CACHE_ENTRIES_ENV_VAR];

afterEach(() => {
    if (originalEnvValue === undefined) {
        delete process.env[MAX_FORMATTING_CACHE_ENTRIES_ENV_VAR];
    } else {
        process.env[MAX_FORMATTING_CACHE_ENTRIES_ENV_VAR] = originalEnvValue;
    }

    setDefaultMaxFormattingCacheEntries(DEFAULT_MAX_FORMATTING_CACHE_ENTRIES);
    applyMaxFormattingCacheEntriesEnvOverride();
});

void describe("format memory cache runtime options", () => {
    void it("exposes the default cache entry cap", () => {
        assert.equal(getDefaultMaxFormattingCacheEntries(), DEFAULT_MAX_FORMATTING_CACHE_ENTRIES);
    });

    void it("allows overriding the default cache entry cap", () => {
        setDefaultMaxFormattingCacheEntries(16);
        assert.equal(getDefaultMaxFormattingCacheEntries(), 16);
    });

    void it("applies environment overrides", () => {
        process.env[MAX_FORMATTING_CACHE_ENTRIES_ENV_VAR] = "12";
        applyMaxFormattingCacheEntriesEnvOverride();

        assert.equal(getDefaultMaxFormattingCacheEntries(), 12);
    });

    void it("ignores invalid environment values", () => {
        process.env[MAX_FORMATTING_CACHE_ENTRIES_ENV_VAR] = "invalid";
        applyMaxFormattingCacheEntriesEnvOverride();

        assert.equal(getDefaultMaxFormattingCacheEntries(), DEFAULT_MAX_FORMATTING_CACHE_ENTRIES);
    });
});
