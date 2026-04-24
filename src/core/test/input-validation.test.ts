import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    isValidSourceTextType,
    SourceTextValidationError,
    validateSourceText
} from "../src/text/source-text-validation.js";

void describe("validateSourceText", () => {
    void describe("successful validation", () => {
        void it("should accept valid non-empty strings", () => {
            const input = "x = 42;";
            const result = validateSourceText(input);
            assert.equal(result, input);
        });

        void it("should accept empty strings by default", () => {
            const input = "";
            const result = validateSourceText(input);
            assert.equal(result, input);
        });

        void it("should accept strings with special characters", () => {
            const input = 'var msg = "Hello, 世界! 🚀";';
            const result = validateSourceText(input);
            assert.equal(result, input);
        });

        void it("should accept multiline strings", () => {
            const input = "line1\nline2\rline3\r\nline4";
            const result = validateSourceText(input);
            assert.equal(result, input);
        });

        void it("should accept strings up to the maximum length", () => {
            const maxLength = 1000;
            const input = "x".repeat(maxLength);
            const result = validateSourceText(input, { maxLength });
            assert.equal(result, input);
        });
    });

    void describe("null and undefined handling", () => {
        void it("should reject null with descriptive error", () => {
            assert.throws(
                () => validateSourceText(null as unknown as string),
                (error: unknown) => {
                    return error instanceof SourceTextValidationError && error.message.includes("cannot be null");
                }
            );
        });

        void it("should reject undefined with descriptive error", () => {
            assert.throws(
                () => validateSourceText(undefined as unknown as string),
                (error: unknown) => {
                    return error instanceof SourceTextValidationError && error.message.includes("cannot be undefined");
                }
            );
        });
    });

    void describe("type validation", () => {
        void it("should reject numbers", () => {
            assert.throws(
                () => validateSourceText(123 as unknown as string),
                (error: unknown) => {
                    return (
                        error instanceof SourceTextValidationError &&
                        error.message.includes("must be a string") &&
                        error.message.includes("number")
                    );
                }
            );
        });

        void it("should reject booleans", () => {
            assert.throws(
                () => validateSourceText(true as unknown as string),
                (error: unknown) => {
                    return (
                        error instanceof SourceTextValidationError &&
                        error.message.includes("must be a string") &&
                        error.message.includes("boolean")
                    );
                }
            );
        });

        void it("should reject objects", () => {
            assert.throws(
                () => validateSourceText({ text: "x = 42;" } as unknown as string),
                (error: unknown) => {
                    return (
                        error instanceof SourceTextValidationError &&
                        error.message.includes("must be a string") &&
                        error.message.includes("object")
                    );
                }
            );
        });

        void it("should reject arrays with descriptive type label", () => {
            assert.throws(
                () => validateSourceText(["x = 42;"] as unknown as string),
                (error: unknown) => {
                    return (
                        error instanceof SourceTextValidationError &&
                        error.message.includes("must be a string") &&
                        error.message.includes("array")
                    );
                }
            );
        });

        void it("should reject functions", () => {
            assert.throws(
                () => validateSourceText((() => "x = 42;") as unknown as string),
                (error: unknown) => {
                    return (
                        error instanceof SourceTextValidationError &&
                        error.message.includes("must be a string") &&
                        error.message.includes("function")
                    );
                }
            );
        });

        void it("should reject symbols", () => {
            assert.throws(
                () => validateSourceText(Symbol("test") as unknown as string),
                (error: unknown) => {
                    return (
                        error instanceof SourceTextValidationError &&
                        error.message.includes("must be a string") &&
                        error.message.includes("symbol")
                    );
                }
            );
        });
    });

    void describe("length validation", () => {
        void it("should reject strings exceeding default maximum length", () => {
            const maxLength = 10 * 1024 * 1024;
            const input = "x".repeat(maxLength + 1);

            assert.throws(
                () => validateSourceText(input),
                (error: unknown) => {
                    return (
                        error instanceof SourceTextValidationError &&
                        error.message.includes("exceeds maximum allowed length") &&
                        error.message.includes(String(maxLength))
                    );
                }
            );
        });

        void it("should reject strings exceeding custom maximum length", () => {
            const maxLength = 100;
            const input = "x".repeat(maxLength + 1);

            assert.throws(
                () => validateSourceText(input, { maxLength }),
                (error: unknown) => {
                    return (
                        error instanceof SourceTextValidationError &&
                        error.message.includes("exceeds maximum allowed length") &&
                        error.message.includes(String(maxLength)) &&
                        error.message.includes(String(input.length))
                    );
                }
            );
        });

        void it("should accept strings at exact maximum length boundary", () => {
            const maxLength = 100;
            const input = "x".repeat(maxLength);
            const result = validateSourceText(input, { maxLength });
            assert.equal(result, input);
        });
    });

    void describe("empty string handling", () => {
        void it("should reject empty strings when allowEmpty is false", () => {
            assert.throws(
                () => validateSourceText("", { allowEmpty: false }),
                (error: unknown) => {
                    return error instanceof SourceTextValidationError && error.message.includes("cannot be empty");
                }
            );
        });

        void it("should accept empty strings when allowEmpty is true", () => {
            const result = validateSourceText("", { allowEmpty: true });
            assert.equal(result, "");
        });

        void it("should accept whitespace-only strings even when allowEmpty is false", () => {
            const input = "   \n\t  ";
            const result = validateSourceText(input, { allowEmpty: false });
            assert.equal(result, input);
        });
    });

    void describe("combined options", () => {
        void it("should enforce both maxLength and allowEmpty constraints", () => {
            const maxLength = 50;
            const input = "x".repeat(maxLength + 1);

            assert.throws(
                () => validateSourceText(input, { maxLength, allowEmpty: false }),
                (error: unknown) => {
                    return (
                        error instanceof SourceTextValidationError &&
                        error.message.includes("exceeds maximum allowed length")
                    );
                }
            );
        });

        void it("should validate empty string rejection before length check", () => {
            assert.throws(
                () => validateSourceText("", { maxLength: 100, allowEmpty: false }),
                (error: unknown) => {
                    return error instanceof SourceTextValidationError && error.message.includes("cannot be empty");
                }
            );
        });
    });
});

void describe("isValidSourceTextType", () => {
    void it("should return true for non-empty strings", () => {
        assert.equal(isValidSourceTextType("x = 42;"), true);
    });

    void it("should return true for empty strings", () => {
        assert.equal(isValidSourceTextType(""), true);
    });

    void it("should return false for null", () => {
        assert.equal(isValidSourceTextType(null), false);
    });

    void it("should return false for undefined", () => {
        assert.equal(isValidSourceTextType(undefined), false);
    });

    void it("should return false for numbers", () => {
        assert.equal(isValidSourceTextType(123), false);
    });

    void it("should return false for booleans", () => {
        assert.equal(isValidSourceTextType(true), false);
    });

    void it("should return false for objects", () => {
        assert.equal(isValidSourceTextType({ text: "x = 42;" }), false);
    });

    void it("should return false for arrays", () => {
        assert.equal(isValidSourceTextType(["x = 42;"]), false);
    });

    void it("should narrow type in conditional branches", () => {
        const input: unknown = "x = 42;";
        if (isValidSourceTextType(input)) {
            const length: number = input.length;
            assert.equal(typeof length, "number");
        }
    });
});

void describe("SourceTextValidationError", () => {
    void it("should be an instance of TypeError", () => {
        const error = new SourceTextValidationError("test error");
        assert.ok(error instanceof TypeError);
    });

    void it("should have correct error name", () => {
        const error = new SourceTextValidationError("test error");
        assert.equal(error.name, "SourceTextValidationError");
    });

    void it("should preserve error message", () => {
        const message = "custom validation failure";
        const error = new SourceTextValidationError(message);
        assert.equal(error.message, message);
    });

    void it("should be catchable as Error", () => {
        try {
            throw new SourceTextValidationError("test");
        } catch (error) {
            assert.ok(error instanceof Error);
        }
    });
});
