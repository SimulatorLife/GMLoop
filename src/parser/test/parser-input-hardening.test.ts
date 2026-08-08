import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Parser } from "../src/index.js";

const { GMLParser, extractGmlFunctionNames, tokenizeGmlIdentifierRanges } = Parser;

function isSourceTextValidationError(error: unknown): boolean {
    return (
        error instanceof TypeError &&
        error.name === "SourceTextValidationError" &&
        typeof error.message === "string" &&
        error.message.length > 0
    );
}

function expectSourceTextValidationError(callable: () => unknown, expectedSubstring: string): void {
    assert.throws(callable, (error: unknown) => {
        return isSourceTextValidationError(error) && (error as Error).message.includes(expectedSubstring);
    });
}

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
});

void describe("extractGmlFunctionNames input validation", () => {
    void describe("valid input", () => {
        void it("accepts source containing named functions", () => {
            const source = ["function first() {}", "function second() {}", ""].join("\n");
            assert.deepEqual(extractGmlFunctionNames(source), ["first", "second"]);
        });

        void it("accepts an empty string and returns no names", () => {
            assert.deepEqual(extractGmlFunctionNames(""), []);
        });
    });

    void describe("invalid input types", () => {
        void it("rejects null input", () => {
            expectSourceTextValidationError(() => extractGmlFunctionNames(null), "cannot be null");
        });

        void it("rejects undefined input", () => {
            expectSourceTextValidationError(() => extractGmlFunctionNames(undefined), "cannot be undefined");
        });

        void it("rejects numeric input", () => {
            expectSourceTextValidationError(
                () => extractGmlFunctionNames(123 as unknown as string),
                "must be a string"
            );
        });

        void it("rejects object input", () => {
            expectSourceTextValidationError(
                () => extractGmlFunctionNames({ source: "function f() {}" } as unknown as string),
                "must be a string"
            );
        });

        void it("rejects array input", () => {
            expectSourceTextValidationError(
                () => extractGmlFunctionNames(["function f() {}"] as unknown as string),
                "array"
            );
        });
    });

    void describe("length validation", () => {
        void it("rejects source exceeding the default limit", () => {
            const maxLength = 10 * 1024 * 1024;
            const source = "x".repeat(maxLength + 1);
            expectSourceTextValidationError(() => extractGmlFunctionNames(source), "exceeds maximum allowed length");
        });
    });
});

void describe("tokenizeGmlIdentifierRanges input validation", () => {
    void describe("valid input", () => {
        void it("accepts source containing identifiers", () => {
            const source = "var value = 1;";
            const ranges = tokenizeGmlIdentifierRanges(source);
            assert.deepEqual(
                ranges.map((range) => range.name),
                ["value"]
            );
        });

        void it("accepts an empty string and returns no ranges", () => {
            assert.deepEqual(tokenizeGmlIdentifierRanges(""), []);
        });
    });

    void describe("invalid input types", () => {
        void it("rejects null input", () => {
            expectSourceTextValidationError(() => tokenizeGmlIdentifierRanges(null), "cannot be null");
        });

        void it("rejects undefined input", () => {
            expectSourceTextValidationError(() => tokenizeGmlIdentifierRanges(undefined), "cannot be undefined");
        });

        void it("rejects numeric input", () => {
            expectSourceTextValidationError(
                () => tokenizeGmlIdentifierRanges(42 as unknown as string),
                "must be a string"
            );
        });

        void it("rejects object input", () => {
            expectSourceTextValidationError(
                () => tokenizeGmlIdentifierRanges({ source: "var x = 1;" } as unknown as string),
                "must be a string"
            );
        });

        void it("rejects array input", () => {
            expectSourceTextValidationError(
                () => tokenizeGmlIdentifierRanges(["var x = 1;"] as unknown as string),
                "array"
            );
        });
    });

    void describe("length validation", () => {
        void it("rejects source exceeding the default limit", () => {
            const maxLength = 10 * 1024 * 1024;
            const source = "x".repeat(maxLength + 1);
            expectSourceTextValidationError(
                () => tokenizeGmlIdentifierRanges(source),
                "exceeds maximum allowed length"
            );
        });
    });
});
