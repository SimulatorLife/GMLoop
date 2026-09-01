import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { toContextualError } from "../src/utils/error.js";

void describe("toContextualError", () => {
    void it("wraps an Error with a colon-separated context and preserves cause", () => {
        const original = new Error("ENOENT: no such file");
        const wrapped = toContextualError("Failed to read file", original);

        assert.ok(wrapped instanceof Error);
        assert.equal(wrapped.name, "Error");
        assert.equal(wrapped.message, "Failed to read file: ENOENT: no such file");
        assert.equal(wrapped.cause, original);
        assert.ok(wrapped.stack, "should keep a stack trace on the wrapped error");
    });

    void it("wraps a non-Error string throw value into a real Error", () => {
        const wrapped = toContextualError("Operation failed", "string was thrown");

        assert.ok(wrapped instanceof Error);
        assert.equal(wrapped.message, "Operation failed: string was thrown");
        assert.equal(wrapped.cause, "string was thrown");
    });

    void it("wraps a non-Error, non-string throw value (e.g. object) using the unknown fallback", () => {
        const wrapped = toContextualError("Failed", { reason: 42 });

        assert.ok(wrapped instanceof Error);
        assert.equal(wrapped.message, "Failed: Unknown error");
        assert.deepEqual(wrapped.cause, { reason: 42 });
    });

    void it("uses parentheses wrap style when requested", () => {
        const original = new Error("permission denied");
        const wrapped = toContextualError("Manual root '/x' is unavailable", original, { wrap: "parentheses" });

        assert.equal(wrapped.message, "Manual root '/x' is unavailable. (permission denied)");
        assert.equal(wrapped.cause, original);
    });

    void it("honours a custom error name", () => {
        const original = new SyntaxError("Unexpected token");
        const wrapped = toContextualError("Failed to parse JSON", original, { name: "SyntaxError" });

        assert.equal(wrapped.name, "SyntaxError");
        assert.equal(wrapped.message, "Failed to parse JSON: Unexpected token");
        assert.equal(wrapped.cause, original);
    });

    void it("always yields a non-empty message even when the cause has no message", () => {
        const wrapped = toContextualError("Context", undefined);

        assert.equal(wrapped.message, "Context: Unknown error");
        assert.equal(wrapped.cause, undefined);
    });

    void it("composes the message correctly with a real Node.js fs error", () => {
        const fsError = new Error("ENOENT: no such file or directory, open '/missing.txt'") as NodeJS.ErrnoException;
        fsError.code = "ENOENT";

        const wrapped = toContextualError("Failed to open '/missing.txt'", fsError);

        assert.equal(
            wrapped.message,
            "Failed to open '/missing.txt': ENOENT: no such file or directory, open '/missing.txt'"
        );
        assert.equal(wrapped.cause, fsError);
        assert.equal(fsError.code, "ENOENT");
    });

    void it("preserves the underlying error class when the cause is a subclass", () => {
        class DomainError extends Error {
            constructor(message: string) {
                super(message);
                this.name = "DomainError";
            }
        }

        const original = new DomainError("boom");
        const wrapped = toContextualError("Wrapping", original);

        assert.equal(wrapped.cause, original);
        assert.ok(original instanceof DomainError);
        assert.equal(original.name, "DomainError");
    });
});
