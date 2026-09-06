import assert from "node:assert/strict";
import test from "node:test";

import antlr4 from "antlr4";

import {
    installRecognitionExceptionLikeGuard,
    isRecognitionExceptionLike,
    resolveTokenPosition
} from "../src/runtime/recognition-exception-patch.js";

type RecognitionExceptionConstructor = new (...args: unknown[]) => object;

const typedAntlr4 = antlr4 as typeof antlr4 & {
    error?: {
        RecognitionException?: RecognitionExceptionConstructor;
    };
};

const RecognitionException = typedAntlr4.error?.RecognitionException;
if (!RecognitionException) {
    throw new Error("ANTLR RecognitionException class is required for the recognition guard tests");
}

class RecognitionAdapter extends Error {
    readonly ctx: object;
    readonly expectedTokens: object;
    readonly offendingToken: object;

    constructor(message = "adapter failure") {
        super(message);
        this.ctx = {};
        this.expectedTokens = {};
        this.offendingToken = {};
    }
}

void test("isRecognitionExceptionLike rejects non-error values", () => {
    assert.strictEqual(isRecognitionExceptionLike(null), false);
    assert.strictEqual(isRecognitionExceptionLike(), false);
    assert.strictEqual(isRecognitionExceptionLike(42), false);
    assert.strictEqual(isRecognitionExceptionLike("error"), false);
});

void test("isRecognitionExceptionLike rejects plain Error instances", () => {
    const error = new Error("failure");
    assert.strictEqual(isRecognitionExceptionLike(error), false);
});

void test("isRecognitionExceptionLike accepts objects with expected token probes", () => {
    const candidate = new RecognitionAdapter();
    assert.strictEqual(isRecognitionExceptionLike(candidate), true);
});

void test("isRecognitionExceptionLike accepts method-based adapters", () => {
    class RecognitionDelegate extends Error {
        readonly ctx: object;

        constructor() {
            super("delegate failure");
            this.ctx = {};
        }

        getExpectedTokens() {
            return {};
        }

        getOffendingToken() {
            return {};
        }
    }

    const candidate = new RecognitionDelegate();
    assert.strictEqual(isRecognitionExceptionLike(candidate), true);
});

void test("isRecognitionExceptionLike requires contextual hints", () => {
    class MissingContextError extends Error {
        getExpectedTokens() {
            return {};
        }

        getOffendingToken() {
            return {};
        }
    }

    const candidate = new MissingContextError("missing");
    assert.strictEqual(isRecognitionExceptionLike(candidate), false);
});

void test("installRecognitionExceptionLikeGuard augments instanceof checks", () => {
    const candidate = new RecognitionAdapter();

    assert.strictEqual(candidate instanceof RecognitionException, false);

    installRecognitionExceptionLikeGuard();

    assert.strictEqual(candidate instanceof RecognitionException, true);
});

void test("resolveTokenPosition prefers the fallback's matching field", () => {
    const token: Record<string, unknown> = {};
    const fallback: Record<string, unknown> = { line: 12, column: 4 };

    assert.strictEqual(resolveTokenPosition(token, fallback, "line"), 12);
    assert.strictEqual(resolveTokenPosition(token, fallback, "column"), 4);
});

void test("resolveTokenPosition falls back to a numeric fallback.start", () => {
    const token: Record<string, unknown> = {};
    const fallback: Record<string, unknown> = { start: 7 };

    assert.strictEqual(resolveTokenPosition(token, fallback, "line"), 7);
    assert.strictEqual(resolveTokenPosition(token, fallback, "column"), 7);
});

void test("resolveTokenPosition falls back to a nested fallback.start", () => {
    const token: Record<string, unknown> = {};
    const fallback: Record<string, unknown> = { start: { line: 3, column: 9 } };

    assert.strictEqual(resolveTokenPosition(token, fallback, "line"), 3);
    assert.strictEqual(resolveTokenPosition(token, fallback, "column"), 9);
});

void test("resolveTokenPosition falls back to a numeric token.start", () => {
    const token: Record<string, unknown> = { start: 5 };
    const fallback: Record<string, unknown> = {};

    assert.strictEqual(resolveTokenPosition(token, fallback, "line"), 5);
    assert.strictEqual(resolveTokenPosition(token, fallback, "column"), 5);
});

void test("resolveTokenPosition falls back to a nested token.start", () => {
    const token: Record<string, unknown> = { start: { line: 2, column: 8 } };
    const fallback: Record<string, unknown> = {};

    assert.strictEqual(resolveTokenPosition(token, fallback, "line"), 2);
    assert.strictEqual(resolveTokenPosition(token, fallback, "column"), 8);
});

void test("resolveTokenPosition returns -1 when no candidates are available", () => {
    const token: Record<string, unknown> = {};
    const fallback: Record<string, unknown> = {};

    assert.strictEqual(resolveTokenPosition(token, fallback, "line"), -1);
    assert.strictEqual(resolveTokenPosition(token, fallback, "column"), -1);
});

void test("resolveTokenPosition tolerates missing or malformed candidates", () => {
    const token: Record<string, unknown> = {};

    assert.strictEqual(resolveTokenPosition(token, undefined, "line"), -1);
    assert.strictEqual(resolveTokenPosition(token, null, "line"), -1);
    assert.strictEqual(resolveTokenPosition(token, { start: "oops" }, "line"), -1);
});

void test("resolveTokenPosition prefers fallback over token.start", () => {
    const token: Record<string, unknown> = { start: 99 };
    const fallback: Record<string, unknown> = { line: 1, column: 2 };

    assert.strictEqual(resolveTokenPosition(token, fallback, "line"), 1);
    assert.strictEqual(resolveTokenPosition(token, fallback, "column"), 2);
});
