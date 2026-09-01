import assert from "node:assert/strict";
import test from "node:test";

import { getUiErrorMessage, getUiNetworkErrorMessage } from "../src/app/error-message.js";

const FALLBACK = "Fallback message.";

void test("getUiErrorMessage returns the message of a standard Error", () => {
    assert.equal(getUiErrorMessage(new Error("boom"), FALLBACK), "boom");
});

void test("getUiErrorMessage returns the message of a custom Error subclass", () => {
    class CustomError extends Error {
        public override name = "CustomError";
    }
    assert.equal(getUiErrorMessage(new CustomError("custom failure"), FALLBACK), "custom failure");
});

void test("getUiErrorMessage returns trimmed string errors verbatim", () => {
    assert.equal(getUiErrorMessage("  something went wrong  ", FALLBACK), "something went wrong");
});

void test("getUiErrorMessage falls back when string error is whitespace only", () => {
    assert.equal(getUiErrorMessage("   ", FALLBACK), FALLBACK);
});

void test("getUiErrorMessage falls back when Error message is whitespace only", () => {
    assert.equal(getUiErrorMessage(new Error("   "), FALLBACK), FALLBACK);
});

void test("getUiErrorMessage falls back when Error has no message property", () => {
    const value: unknown = { name: "AnonymousError" };
    assert.equal(getUiErrorMessage(value, FALLBACK), FALLBACK);
});

void test("getUiErrorMessage falls back for nullish values", () => {
    assert.equal(getUiErrorMessage(null, FALLBACK), FALLBACK);
    assert.equal(getUiErrorMessage(undefined, FALLBACK), FALLBACK);
});

void test("getUiErrorMessage falls back for non-string, non-error primitives", () => {
    assert.equal(getUiErrorMessage(42, FALLBACK), FALLBACK);
    assert.equal(getUiErrorMessage(true, FALLBACK), FALLBACK);
    assert.equal(getUiErrorMessage(false, FALLBACK), FALLBACK);
});

void test("getUiErrorMessage returns the fallback for plain objects without a message", () => {
    assert.equal(getUiErrorMessage({ code: "EACCES" }, FALLBACK), FALLBACK);
});

void test("getUiErrorMessage handles error-like values from other realms", () => {
    // Simulate a cross-realm error-like value (e.g. raised inside a Web Worker
    // or iframe) which fails `instanceof Error` checks but exposes the same
    // shape. The capability probe inside `Core.getErrorMessageOrFallback`
    // accepts these uniformly.
    const crossRealmError: unknown = {
        message: "remote failure",
        name: "RemoteError"
    };
    assert.equal(getUiErrorMessage(crossRealmError, FALLBACK), "remote failure");
});

void test("getUiErrorMessage ignores cross-realm objects with a non-string message", () => {
    const crossRealmShape: unknown = {
        message: 42,
        name: "WeirdError"
    };
    assert.equal(getUiErrorMessage(crossRealmShape, FALLBACK), FALLBACK);
});

void test("getUiNetworkErrorMessage identifies browser fetch failures", () => {
    assert.equal(
        getUiNetworkErrorMessage(new TypeError("Failed to fetch"), "the graph server", "Live reload startup failed."),
        "Unable to reach the graph server. Check that the server is running and try again."
    );
});

void test("getUiNetworkErrorMessage preserves server-side errors", () => {
    assert.equal(
        getUiNetworkErrorMessage(new Error("worker failed"), "the graph server", "Live reload startup failed."),
        "worker failed"
    );
});

void test("getUiNetworkErrorMessage preserves server errors that reuse a browser network message", () => {
    assert.equal(
        getUiNetworkErrorMessage(new Error("Failed to fetch"), "the graph server", "Live reload startup failed."),
        "Failed to fetch"
    );
});
