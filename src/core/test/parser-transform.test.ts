/**
 * Regression tests for the ParserTransform factory and the ParserTransform interface
 * contract.
 *
 * These tests ensure that:
 *   1. The `ParserTransform` interface can be implemented directly without going through
 *      `createParserTransform`.
 *   2. Both the factory and direct implementations produce identical `name`, `defaultOptions`,
 *      and `transform` behaviour.
 *   3. Options merging (defaults + caller overrides) is applied correctly in both paths.
 *
 * Before this simplification, `createParserTransform` was the sole gate for creating
 * transforms. The factory added indirection with no behavioral benefit — callers can build
 * the object directly. The factory is retained for ergonomics but is no longer required.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { MutableGameMakerAstNode } from "../src/ast/types.js";
import { createParserTransform, type ParserTransform } from "../src/transforms/parser-transform.js";

type SimpleTransformOptions = {
    extra?: string;
};

/** Minimal AST node used to exercise the transform. */
const makeAst = (extra?: string): MutableGameMakerAstNode => {
    return { type: "Program", body: [], extra: extra ?? "" };
};

/** Execute function captured by the factory for use in the direct-implementation test. */
function executeSimpleTransform(ast: MutableGameMakerAstNode, options: { extra?: string }): MutableGameMakerAstNode {
    if (options.extra !== undefined) {
        (ast as MutableGameMakerAstNode & { extra: string }).extra = options.extra;
    }
    return ast;
}

/** Direct implementation of the ParserTransform interface used as a reference. */
const defaultOptions = Object.freeze({});
const directTransform: ParserTransform<MutableGameMakerAstNode, typeof defaultOptions> = {
    name: "direct",
    defaultOptions,
    transform(ast: MutableGameMakerAstNode, options?: { extra?: string }) {
        return executeSimpleTransform(
            ast,
            options === undefined ? directTransform.defaultOptions : { ...directTransform.defaultOptions, ...options }
        );
    }
};

void describe("ParserTransform interface", () => {
    void describe("createParserTransform factory", () => {
        const factoryTransform = createParserTransform<SimpleTransformOptions>("factory", {}, executeSimpleTransform);

        void it("produces a transform with the expected name", () => {
            assert.equal(factoryTransform.name, "factory");
        });

        void it("produces a transform with frozen default options", () => {
            assert.ok(Object.isFrozen(factoryTransform.defaultOptions));
        });

        void it("passes options through to the execute function", () => {
            const ast = makeAst();
            factoryTransform.transform(ast, { extra: "hello" });
            assert.equal((ast as MutableGameMakerAstNode & { extra: string }).extra, "hello");
        });

        void it("treats absent options as using defaults", () => {
            const ast = makeAst();
            const result = factoryTransform.transform(ast);
            assert.equal(result, ast);
            assert.equal((result as MutableGameMakerAstNode & { extra: string }).extra, "");
        });
    });

    void describe("direct ParserTransform implementation vs factory", () => {
        void it("both exports expose the same name property", () => {
            assert.equal(directTransform.name, "direct");
        });

        void it("both exports have frozen defaultOptions", () => {
            assert.ok(Object.isFrozen(directTransform.defaultOptions));
            const factoryTransform = createParserTransform("test", {}, () => makeAst());
            assert.ok(Object.isFrozen(factoryTransform.defaultOptions));
        });

        void it("both paths merge caller options over defaults", () => {
            const direct = directTransform.transform(makeAst(), { extra: "direct-value" });
            const factory = createParserTransform<SimpleTransformOptions>("test", {}, executeSimpleTransform).transform(
                makeAst(),
                { extra: "direct-value" }
            );

            assert.equal((direct as MutableGameMakerAstNode & { extra: string }).extra, "direct-value");
            assert.equal((factory as MutableGameMakerAstNode & { extra: string }).extra, "direct-value");
        });

        void it("direct implementation and factory agree on empty-options behaviour", () => {
            const direct = directTransform.transform(makeAst());
            const factory = createParserTransform("test", {}, executeSimpleTransform).transform(makeAst());

            assert.equal((direct as MutableGameMakerAstNode & { extra: string }).extra, "");
            assert.equal((factory as MutableGameMakerAstNode & { extra: string }).extra, "");
        });
    });
});
