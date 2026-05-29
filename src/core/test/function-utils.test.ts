import assert from "node:assert/strict";
import { test } from "node:test";

import { callWithFallback } from "../src/utils/function.js";

void test("callWithFallback returns callback result when successful", () => {
    const result = callWithFallback(() => 42);
    assert.strictEqual(result, 42);
});

void test("callWithFallback returns fallback value when callback throws", () => {
    const result = callWithFallback(
        () => {
            throw new Error("failure");
        },
        { fallback: "fallback" }
    );

    assert.strictEqual(result, "fallback");
});

void test("callWithFallback invokes fallback function with the thrown error", () => {
    const error = new Error("failure");
    let receivedError = null;

    const result = callWithFallback(
        () => {
            throw error;
        },
        {
            fallback: (caught) => {
                receivedError = caught;
                return 7;
            }
        }
    );

    assert.strictEqual(receivedError, error);
    assert.strictEqual(result, 7);
});

void test("callWithFallback notifies the error handler before returning the fallback", () => {
    const error = new Error("failure");
    let handledError = null;

    const result = callWithFallback(
        () => {
            throw error;
        },
        {
            fallback: null,
            onError: (caught) => {
                handledError = caught;
            }
        }
    );

    assert.strictEqual(handledError, error);
    assert.strictEqual(result, null);
});

void test("callWithFallback defaults to undefined when no fallback is provided", () => {
    const result = callWithFallback(() => {
        throw new Error("failure");
    });

    assert.strictEqual(result, undefined);
});
