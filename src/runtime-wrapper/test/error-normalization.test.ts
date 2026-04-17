import assert from "node:assert/strict";
import test from "node:test";

import {
    DEFAULT_RUNTIME_ERROR_MESSAGE,
    resolveRuntimeErrorFallbackMessage,
    resolveRuntimeErrorMessage
} from "../src/runtime/error-normalization.js";

void test("resolveRuntimeErrorMessage uses default fallback for nullish errors", () => {
    assert.strictEqual(resolveRuntimeErrorMessage(null), DEFAULT_RUNTIME_ERROR_MESSAGE);
    assert.strictEqual(resolveRuntimeErrorMessage(undefined), DEFAULT_RUNTIME_ERROR_MESSAGE);
});

void test("resolveRuntimeErrorMessage preserves primitive non-error throws", () => {
    assert.strictEqual(resolveRuntimeErrorMessage(404), "404");
    assert.strictEqual(resolveRuntimeErrorMessage(false), "false");
});

void test("resolveRuntimeErrorMessage uses caller fallback for nullish errors", () => {
    assert.strictEqual(resolveRuntimeErrorMessage(undefined, "Missing socket error"), "Missing socket error");
});

void test("resolveRuntimeErrorFallbackMessage marks object throws as non-error", () => {
    assert.strictEqual(
        resolveRuntimeErrorFallbackMessage({ source: "network" }, "fallback"),
        "Non-Error object thrown"
    );
});
