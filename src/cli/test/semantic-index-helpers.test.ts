import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    readExclusiveSemanticLocationIndex,
    readSemanticLocationIndex
} from "../src/modules/refactor/semantic-index-helpers.js";

void describe("readSemanticLocationIndex", () => {
    void it("returns a plain number directly", () => {
        assert.equal(readSemanticLocationIndex(42), 42);
        assert.equal(readSemanticLocationIndex(0), 0);
    });

    void it("returns the index property from an object", () => {
        assert.equal(readSemanticLocationIndex({ index: 10 }), 10);
        assert.equal(readSemanticLocationIndex({ index: 0, line: 1, column: 0 }), 0);
    });

    void it("returns null for null", () => {
        assert.equal(readSemanticLocationIndex(null), null);
    });

    void it("returns null for undefined", () => {
        assert.equal(readSemanticLocationIndex(undefined), null);
    });

    void it("returns null for an object without a numeric index property", () => {
        assert.equal(readSemanticLocationIndex({}), null);
        assert.equal(readSemanticLocationIndex({ index: "42" }), null);
        assert.equal(readSemanticLocationIndex({ index: null }), null);
    });

    void it("returns null for non-object, non-number primitives", () => {
        assert.equal(readSemanticLocationIndex("42"), null);
        assert.equal(readSemanticLocationIndex(true), null);
    });
});

void describe("readExclusiveSemanticLocationIndex", () => {
    void it("converts a plain number to one-past-the-end", () => {
        assert.equal(readExclusiveSemanticLocationIndex(41), 42);
        assert.equal(readExclusiveSemanticLocationIndex(0), 1);
    });

    void it("converts an object index to one-past-the-end", () => {
        assert.equal(readExclusiveSemanticLocationIndex({ index: 9 }), 10);
        assert.equal(readExclusiveSemanticLocationIndex({ index: 99, line: 5, column: 3 }), 100);
    });

    void it("returns null for null", () => {
        assert.equal(readExclusiveSemanticLocationIndex(null), null);
    });

    void it("returns null for undefined", () => {
        assert.equal(readExclusiveSemanticLocationIndex(undefined), null);
    });

    void it("returns null for objects without a numeric index property", () => {
        assert.equal(readExclusiveSemanticLocationIndex({}), null);
        assert.equal(readExclusiveSemanticLocationIndex({ index: "5" }), null);
    });
});
