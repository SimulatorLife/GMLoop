import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Core } from "@gmloop/core";

import { Parser } from "../src/index.js";

const { GMLParser } = Parser;
const { validateSourceText } = Core;

void describe("GMLParser constructor input validation", () => {
    void describe("valid input", () => {
        void it("should accept valid GML source code", () => {
            const parser = new GMLParser("x = 42;");
            assert.ok(parser);
            assert.equal(parser.originalText, "x = 42;");
        });

        void it("should accept empty source", () => {
            const parser = new GMLParser("");
            assert.ok(parser);
            assert.equal(parser.originalText, "");
        });

        void it("should accept complex multiline source", () => {
            const source = `
function test() {
    var x = 10;
    return x * 2;
}
`;
            const parser = new GMLParser(source);
            assert.ok(parser);
            assert.equal(parser.originalText, source);
        });
    });

    void describe("invalid input types", () => {
        void it("should reject null input", () => {
            assert.throws(
                () => new GMLParser(null),
                (error: unknown) => {
                    return (
                        error instanceof TypeError &&
                        error.name === "SourceTextValidationError" &&
                        error.message.includes("cannot be null")
                    );
                }
            );
        });

        void it("should reject undefined input", () => {
            assert.throws(
                () => new GMLParser(undefined),
                (error: unknown) => {
                    return (
                        error instanceof TypeError &&
                        error.name === "SourceTextValidationError" &&
                        error.message.includes("cannot be undefined")
                    );
                }
            );
        });

        void it("should reject numeric input", () => {
            assert.throws(
                () => new GMLParser(123 as unknown as string),
                (error: unknown) => {
                    return (
                        error instanceof TypeError &&
                        error.name === "SourceTextValidationError" &&
                        error.message.includes("must be a string")
                    );
                }
            );
        });

        void it("should reject object input", () => {
            assert.throws(
                () => new GMLParser({ source: "x = 42;" } as unknown as string),
                (error: unknown) => {
                    return (
                        error instanceof TypeError &&
                        error.name === "SourceTextValidationError" &&
                        error.message.includes("must be a string")
                    );
                }
            );
        });

        void it("should reject array input", () => {
            assert.throws(
                () => new GMLParser(["x = 42;"] as unknown as string),
                (error: unknown) => {
                    return (
                        error instanceof TypeError &&
                        error.name === "SourceTextValidationError" &&
                        error.message.includes("array")
                    );
                }
            );
        });
    });

    void describe("length validation", () => {
        void it("should accept source at default limit", () => {
            const maxLength = 10 * 1024 * 1024;
            const source = "x".repeat(maxLength);
            const parser = new GMLParser(source);
            assert.ok(parser);
        });

        void it("should reject source exceeding default limit", () => {
            const maxLength = 10 * 1024 * 1024;
            const source = "x".repeat(maxLength + 1);
            assert.throws(
                () => new GMLParser(source),
                (error: unknown) => {
                    return (
                        error instanceof TypeError &&
                        error.name === "SourceTextValidationError" &&
                        error.message.includes("exceeds maximum allowed length")
                    );
                }
            );
        });
    });

    void describe("static parse method validation", () => {
        void it("should validate input before parsing", () => {
            assert.throws(
                () => GMLParser.parse(null),
                (error: unknown) => {
                    return (
                        error instanceof TypeError &&
                        error.name === "SourceTextValidationError" &&
                        error.message.includes("cannot be null")
                    );
                }
            );
        });

        void it("should successfully parse valid input", () => {
            const ast = GMLParser.parse("x = 42;");
            assert.ok(ast);
            assert.equal(ast.type, "Program");
        });

        void it("should parse large additive call chains without exhausting memory", () => {
            const repeatedSegments = Array.from(
                { length: 420 },
                (_, index) => `string_format(value_${index}, 1, 10)`
            ).join(" + ");
            const source = [`function stress_trace() {`, `    return ${repeatedSegments};`, `}`, ""].join("\n");

            const ast = GMLParser.parse(source, { getComments: false });
            assert.ok(ast);
            assert.equal(ast.type, "Program");
        });
    });

    void describe("error message clarity", () => {
        void it("should provide actionable error for null", () => {
            try {
                new GMLParser(null);
                assert.fail("Should have thrown");
            } catch (error) {
                assert.ok(error instanceof Error);
                assert.ok(error.message.includes("Provide a string"));
            }
        });

        void it("should include actual type in error message", () => {
            try {
                new GMLParser(123 as unknown as string);
                assert.fail("Should have thrown");
            } catch (error) {
                assert.ok(error instanceof Error);
                assert.ok(error.message.includes("number"));
            }
        });

        void it("should include length details in overflow error", () => {
            const maxLength = 100;
            const source = "x".repeat(maxLength + 1);
            try {
                validateSourceText(source, { maxLength });
                assert.fail("Should have thrown");
            } catch (error) {
                assert.ok(error instanceof Error);
                assert.ok(error.message.includes(String(maxLength)));
                assert.ok(error.message.includes(String(source.length)));
            }
        });
    });
});
