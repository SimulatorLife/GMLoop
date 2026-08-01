import assert from "node:assert/strict";
import { describe, it } from "node:test";

import createGameMakerParseErrorListener, { GameMakerSyntaxError } from "../src/ast/gml-syntax-error.js";

type ParserStub = {
    getRuleInvocationStack: () => Array<string>;
};

void describe("GameMaker parse error listener", () => {
    void it("guards against missing rule stack entries", () => {
        const { syntaxError } = createGameMakerParseErrorListener();
        const parser: ParserStub = {
            getRuleInvocationStack: () => []
        };

        assert.throws(
            () => {
                syntaxError(parser, undefined, 1, 0, "unexpected token", undefined);
            },
            (error) => {
                assert.ok(error instanceof GameMakerSyntaxError, "Expected a GameMakerSyntaxError instance");
                assert.match(
                    error.message,
                    /while matching rule unknown rule/i,
                    "Expected a fallback rule name for empty rule stacks"
                );
                return true;
            }
        );
    });

    void it("falls back to unknown rule when recognizer omits getRuleInvocationStack", () => {
        const { syntaxError } = createGameMakerParseErrorListener();

        assert.throws(
            () => {
                syntaxError({}, undefined, 4, 2, "unexpected token", undefined);
            },
            (error) => {
                assert.ok(error instanceof GameMakerSyntaxError, "Expected a GameMakerSyntaxError instance");
                assert.match(
                    error.message,
                    /while matching rule unknown rule/i,
                    "Expected a fallback rule name when recognizer stack lookup is unavailable"
                );
                return true;
            }
        );
    });
});
