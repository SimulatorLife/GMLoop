import assert from "node:assert/strict";
import { test } from "node:test";

import { Core } from "@gmloop/core";
import { Lsp } from "@gmloop/lsp";

const { normalizeWorkerErrorPayload, coerceToError } = Lsp.Intelligence;

void test("normalizeWorkerErrorPayload extracts message and name from a real Error", () => {
    const payload = normalizeWorkerErrorPayload(new TypeError("boom"));

    assert.equal(payload.message, "boom");
    assert.equal(payload.name, "TypeError");
    assert.ok(
        payload.stack === undefined || payload.stack.includes("boom"),
        "Stack should be omitted when absent, or present and reference the message"
    );
});

void test("normalizeWorkerErrorPayload preserves stack when present", () => {
    const error = new Error("with-stack");
    error.stack = "Error: with-stack\n    at <anonymous>:1:1";
    const payload = normalizeWorkerErrorPayload(error);

    assert.equal(payload.message, "with-stack");
    assert.equal(payload.name, "Error");
    assert.equal(payload.stack, "Error: with-stack\n    at <anonymous>:1:1");
});

void test("normalizeWorkerErrorPayload recognizes cross-realm error-like objects", () => {
    // Simulate an error that arrived from a foreign realm (worker thread, native
    // addon, structured-clone deserialization). It is NOT `instanceof Error`
    // because it does not share the current realm's prototype chain, but it
    // exposes the same contract fields any error-like value should.
    const crossRealmError: Record<string, unknown> = Object.create(null);
    crossRealmError.message = "Cross-realm failure";
    crossRealmError.name = "WorkerError";
    crossRealmError.stack = "WorkerError: Cross-realm failure\n    at worker:1:1";

    const payload = normalizeWorkerErrorPayload(crossRealmError);

    assert.equal(payload.message, "Cross-realm failure");
    assert.equal(payload.name, "WorkerError");
    assert.equal(payload.stack, "WorkerError: Cross-realm failure\n    at worker:1:1");
});

void test("normalizeWorkerErrorPayload falls back to Error name when the field is missing", () => {
    const payload = normalizeWorkerErrorPayload({ message: "no-name" });

    assert.equal(payload.message, "no-name");
    assert.equal(payload.name, "Error");
    assert.equal(payload.stack, undefined);
});

void test("normalizeWorkerErrorPayload handles non-string fields defensively", () => {
    const payload = normalizeWorkerErrorPayload({
        message: 42,
        name: { nested: "object" },
        stack: { not: "a string" }
    });

    assert.equal(payload.message, "Unknown error");
    assert.equal(payload.name, "Error");
    assert.equal(payload.stack, undefined);
});

void test("normalizeWorkerErrorPayload normalizes non-error throw values via the message fallback", () => {
    // Strings are passed through as messages; non-string primitives fall back
    // to the "Unknown error" sentinel so downstream consumers never have to
    // re-implement the discriminant logic.
    assert.equal(normalizeWorkerErrorPayload("plain string").message, "plain string");
    assert.equal(normalizeWorkerErrorPayload(123).message, "Unknown error");
    assert.equal(normalizeWorkerErrorPayload(null).message, "Unknown error");
    assert.equal(normalizeWorkerErrorPayload(undefined).message, "Unknown error");
    assert.equal(normalizeWorkerErrorPayload(true).message, "Unknown error");
});

void test("coerceToError forwards a real Error instance unchanged", () => {
    const original = new RangeError("out of range");
    const result = coerceToError(original);

    assert.equal(result, original, "Real Error should be forwarded, not wrapped");
    assert.equal(result.name, "RangeError");
    assert.equal(result.message, "out of range");
});

void test("coerceToError forwards cross-realm error-like objects without instanceof Error", () => {
    // Cross-realm error: structurally identical to Error, but not an instance
    // of the current realm's Error class. The capability-probe contract means
    // the LSP layer can substitute any error-like collaborator here.
    const crossRealm: Record<string, unknown> = { message: "Cross-realm boom", name: "WorkerError" };

    const result = coerceToError(crossRealm);

    assert.ok(Core.isErrorLike(result), "Result must satisfy the error-like contract");
    assert.equal(result.message, "Cross-realm boom");
    assert.equal(result.name, "WorkerError");
});

void test("coerceToError forwards plain objects carrying a message as-is when they satisfy the error contract", () => {
    // The error-like contract (Core.isErrorLike) accepts any object with a
    // string message. coerceToError forwards these unchanged so downstream
    // code can rely on the contract without re-checking the prototype.
    const result = coerceToError({ message: "facade error" });

    assert.ok(Core.isErrorLike(result));
    assert.equal(result.message, "facade error");
});

void test("coerceToError wraps plain objects that lack a message", () => {
    const result = coerceToError({ reason: "no-message-here" });

    assert.ok(result instanceof Error, "Wrapping must produce a real Error for objects missing the message field");
    assert.match(result.message, /no-message-here|Unknown/);
});

void test("coerceToError wraps primitive throw values in a fresh Error", () => {
    // Strings are forwarded as the resulting Error's message because that is
    // the most useful mapping when a callback throws a string. Non-string
    // primitives fall back to "Unknown error" via the Core helper.
    assert.equal(coerceToError("plain string").message, "plain string");
    assert.ok(coerceToError(404) instanceof Error);
    assert.equal(coerceToError(404).message, "Unknown error");
    assert.ok(coerceToError(null) instanceof Error);
    assert.ok(coerceToError(undefined) instanceof Error);
});

void test("coerceToError tolerates arbitrary Error subclasses from any realm", () => {
    class CustomError extends Error {
        constructor(message: string) {
            super(message);
            this.name = "CustomError";
        }
    }

    const original = new CustomError("custom failure");
    const result = coerceToError(original);

    assert.equal(result, original, "Subclasses of Error should be forwarded unchanged");
    assert.equal(result.name, "CustomError");
});
