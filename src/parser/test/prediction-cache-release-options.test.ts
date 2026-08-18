import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GMLParser } from "../src/gml-parser.js";
import {
    DEFAULT_PREDICTION_CACHE_RELEASE_INTERVAL,
    DEFAULT_PREDICTION_CACHE_RELEASE_MAX_SOURCE_LENGTH,
    DEFAULT_SLL_PREDICTION_MAX_SOURCE_LENGTH,
    defaultParserOptions
} from "../src/types/index.js";

void describe("parser prediction-cache release configuration", () => {
    void it("exposes the canonical defaults alongside the SLL threshold", () => {
        assert.equal(DEFAULT_PREDICTION_CACHE_RELEASE_MAX_SOURCE_LENGTH, 8000);
        assert.equal(DEFAULT_PREDICTION_CACHE_RELEASE_INTERVAL, 16);
        assert.equal(DEFAULT_PREDICTION_CACHE_RELEASE_MAX_SOURCE_LENGTH, DEFAULT_SLL_PREDICTION_MAX_SOURCE_LENGTH);
    });

    void it("bakes the new defaults into the default option bag", () => {
        assert.equal(
            defaultParserOptions.predictionCacheReleaseMaxSourceLength,
            DEFAULT_PREDICTION_CACHE_RELEASE_MAX_SOURCE_LENGTH
        );
        assert.equal(defaultParserOptions.predictionCacheReleaseInterval, DEFAULT_PREDICTION_CACHE_RELEASE_INTERVAL);
    });

    void it("accepts a custom source-length threshold override", () => {
        const parser = new GMLParser("var counter = 1;", {
            predictionCacheReleaseMaxSourceLength: 256
        });

        assert.equal(parser.options.predictionCacheReleaseMaxSourceLength, 256);
        assert.equal(
            parser.options.predictionCacheReleaseInterval,
            defaultParserOptions.predictionCacheReleaseInterval
        );
    });

    void it("accepts a custom release interval override", () => {
        const parser = new GMLParser("var counter = 1;", {
            predictionCacheReleaseInterval: 3
        });

        assert.equal(parser.options.predictionCacheReleaseInterval, 3);
        assert.equal(
            parser.options.predictionCacheReleaseMaxSourceLength,
            defaultParserOptions.predictionCacheReleaseMaxSourceLength
        );
    });

    void it("accepts both overrides simultaneously without mutating the caller-provided bag", () => {
        const overrides = {
            predictionCacheReleaseInterval: 5,
            predictionCacheReleaseMaxSourceLength: 1024
        };

        const parser = new GMLParser("var counter = 1;", overrides);

        assert.equal(parser.options.predictionCacheReleaseMaxSourceLength, 1024);
        assert.equal(parser.options.predictionCacheReleaseInterval, 5);
        assert.deepStrictEqual(overrides, {
            predictionCacheReleaseInterval: 5,
            predictionCacheReleaseMaxSourceLength: 1024
        });
    });

    void it("falls back to the canonical source-length default when the override is zero", () => {
        const parser = new GMLParser("var counter = 1;", {
            predictionCacheReleaseMaxSourceLength: 0
        });

        assert.equal(
            parser.options.predictionCacheReleaseMaxSourceLength,
            DEFAULT_PREDICTION_CACHE_RELEASE_MAX_SOURCE_LENGTH
        );
    });

    void it("falls back to the canonical interval default when the override is zero", () => {
        const parser = new GMLParser("var counter = 1;", {
            predictionCacheReleaseInterval: 0
        });

        assert.equal(parser.options.predictionCacheReleaseInterval, DEFAULT_PREDICTION_CACHE_RELEASE_INTERVAL);
    });

    void it("falls back to the canonical source-length default when the override is invalid", () => {
        const parser = new GMLParser("var counter = 1;", {
            predictionCacheReleaseMaxSourceLength: Number.NaN
        });

        assert.equal(
            parser.options.predictionCacheReleaseMaxSourceLength,
            DEFAULT_PREDICTION_CACHE_RELEASE_MAX_SOURCE_LENGTH
        );
    });

    void it("falls back to the canonical interval default when the override is invalid", () => {
        const parser = new GMLParser("var counter = 1;", {
            predictionCacheReleaseInterval: Number.NaN
        });

        assert.equal(parser.options.predictionCacheReleaseInterval, DEFAULT_PREDICTION_CACHE_RELEASE_INTERVAL);
    });

    void it("starts the per-instance invocation counter at zero", () => {
        const parser = new GMLParser("var counter = 1;");

        assert.equal(parser.getParserInvocationCount(), 0);
    });

    void it("increments the per-instance invocation counter on every parse() call", () => {
        const parser = new GMLParser("var counter = 1;");

        parser.parse();
        assert.equal(parser.getParserInvocationCount(), 1);

        parser.parse();
        parser.parse();
        assert.equal(parser.getParserInvocationCount(), 3);
    });

    void it("isolates the invocation counter between parser instances", () => {
        const first = new GMLParser("var first = 1;");
        const second = new GMLParser("var second = 2;");

        first.parse();
        first.parse();
        second.parse();

        assert.equal(first.getParserInvocationCount(), 2);
        assert.equal(second.getParserInvocationCount(), 1);

        const third = new GMLParser("var third = 3;");

        assert.equal(
            third.getParserInvocationCount(),
            0,
            "Newly constructed parser must start with a zero counter regardless of prior activity."
        );
    });
});
