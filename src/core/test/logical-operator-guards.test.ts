import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isLogicalAndOperator, isLogicalOrOperator } from "../src/ast/node-helpers/index.js";

void describe("isLogicalAndOperator", () => {
    void it("returns true for the symbol form &&", () => {
        assert.equal(isLogicalAndOperator("&&"), true);
    });

    void it("returns true for the keyword form and", () => {
        assert.equal(isLogicalAndOperator("and"), true);
    });

    void it("returns false for the OR symbol ||", () => {
        assert.equal(isLogicalAndOperator("||"), false);
    });

    void it("returns false for the OR keyword or", () => {
        assert.equal(isLogicalAndOperator("or"), false);
    });

    void it("returns false for comparison operators", () => {
        assert.equal(isLogicalAndOperator("=="), false);
        assert.equal(isLogicalAndOperator("!="), false);
        assert.equal(isLogicalAndOperator("<"), false);
    });

    void it("returns false for arithmetic operators", () => {
        assert.equal(isLogicalAndOperator("+"), false);
        assert.equal(isLogicalAndOperator("*"), false);
    });

    void it("returns false for empty string", () => {
        assert.equal(isLogicalAndOperator(""), false);
    });
});

void describe("isLogicalOrOperator", () => {
    void it("returns true for the symbol form ||", () => {
        assert.equal(isLogicalOrOperator("||"), true);
    });

    void it("returns true for the keyword form or", () => {
        assert.equal(isLogicalOrOperator("or"), true);
    });

    void it("returns false for the AND symbol &&", () => {
        assert.equal(isLogicalOrOperator("&&"), false);
    });

    void it("returns false for the AND keyword and", () => {
        assert.equal(isLogicalOrOperator("and"), false);
    });

    void it("returns false for comparison operators", () => {
        assert.equal(isLogicalOrOperator("=="), false);
        assert.equal(isLogicalOrOperator("!="), false);
        assert.equal(isLogicalOrOperator(">"), false);
    });

    void it("returns false for arithmetic operators", () => {
        assert.equal(isLogicalOrOperator("+"), false);
        assert.equal(isLogicalOrOperator("/"), false);
    });

    void it("returns false for empty string", () => {
        assert.equal(isLogicalOrOperator(""), false);
    });
});
