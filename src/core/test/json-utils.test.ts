import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isErrorLike } from "../src/utils/capability-probes.js";
import {
    isJsonParseError,
    type JsonParseError,
    parseJsonWithContext,
    stringifyJsonForFile
} from "../src/utils/json.js";

void describe("parseJsonWithContext", () => {
    void it("parses JSON payloads with optional revivers", () => {
        const payload = '{"value": 2}';
        const parsed = parseJsonWithContext(payload, {
            reviver(key, value) {
                return key === "value" ? (value as number) * 3 : value;
            }
        });

        assert.deepStrictEqual(parsed, { value: 6 });
    });

    void it("annotates errors with contextual metadata", () => {
        let error: unknown;
        try {
            parseJsonWithContext("{ invalid", {
                source: "demo.json",
                description: "project metadata"
            });
        } catch (error_) {
            error = error_;
        }

        assert.ok(isJsonParseError(error));
        const jsonError = error as JsonParseError;
        assert.equal(jsonError.name, "JsonParseError");
        assert.equal(jsonError.source, "demo.json");
        assert.equal(jsonError.description, "project metadata");
        assert.match(jsonError.message, /Failed to parse project metadata from demo\.json: .+/);
        const cause = jsonError.cause;
        if (!isErrorLike(cause)) {
            throw new Error("Expected parse error cause to be an Error");
        }

        assert.equal(cause.name, "SyntaxError");
        assert.equal(isJsonParseError(new Error("nope")), false);
        assert.equal(isJsonParseError({ message: "fail", name: "JsonParseError" }), false);
    });

    void it("detects structural JsonParseError facades without relying on names", () => {
        const facade = {
            message: "Failed to parse resource document from demo.json: nope",
            description: "resource document",
            source: "demo.json",
            cause: new Error("nope"),
            name: "CustomJsonError"
        };

        assert.equal(isJsonParseError(facade), true);
    });

    void it("honours explicit JsonParseError capability branding", () => {
        const brand = Symbol.for("gmloop.json-parse-error");
        const facade = {
            message: "boom",
            cause: new Error("boom"),
            [brand]: true
        };

        assert.equal(isJsonParseError(facade), true);
    });

    void it("normalizes whitespace-only descriptions and error messages", () => {
        let error: unknown;
        try {
            parseJsonWithContext('{"value": 1}', {
                description: "   custom   ",
                source: {
                    toString() {
                        return "demo.json";
                    }
                },
                reviver() {
                    throw new SyntaxError("  spaced message  ");
                }
            });
        } catch (error_) {
            error = error_;
        }

        assert.ok(isJsonParseError(error));
        const jsonError = error as JsonParseError;
        assert.equal(jsonError.description, "custom");
        assert.equal(jsonError.source, "demo.json");
        assert.match(jsonError.message, /Failed to parse custom from demo\.json: spaced message/);
    });
});

void describe("stringifyJsonForFile", () => {
    void it("serializes objects with a trailing newline by default", () => {
        const contents = stringifyJsonForFile({ value: 1 }, { space: 2 });
        assert.equal(contents, '{\n  "value": 1\n}\n');
    });

    void it("respects newline suppression requests", () => {
        const contents = stringifyJsonForFile(
            { value: 1 },
            {
                space: 2,
                includeTrailingNewline: false
            }
        );

        assert.equal(contents, '{\n  "value": 1\n}');
    });

    void it("honours custom newline tokens without duplicating them", () => {
        const contents = stringifyJsonForFile(
            { value: 1 },
            {
                space: 2,
                newline: "\r\n"
            }
        );

        assert.ok(contents.endsWith("\r\n"));
        assert.ok(!contents.endsWith("\r\n\r\n"));
    });

    void it("falls back to standard newlines when provided an invalid terminator", () => {
        const contents = stringifyJsonForFile(
            { value: 1 },
            {
                space: 0,
                newline: ""
            }
        );

        assert.ok(contents.endsWith("\n"));
    });

    void it("throws a descriptive error when the payload cannot be serialized", () => {
        assert.throws(
            () => stringifyJsonForFile(),
            (error: TypeError) => {
                assert.equal(error instanceof TypeError, true);
                assert.match(error.message, /Unable to serialize .* JSON\. JSON\.stringify returned undefined\./);
                return true;
            }
        );
    });
});
