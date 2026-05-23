import assert from "node:assert/strict";
import { test } from "node:test";

import GameMakerLanguageParserVisitorBase from "../generated/GameMakerLanguageParserVisitor.js";
import GameMakerLanguageParserVisitor, {
    VISIT_METHOD_NAMES
} from "../src/runtime/game-maker-language-parser-visitor.js";

void test("default visitor delegates to visitChildren", () => {
    const visitor = new GameMakerLanguageParserVisitor();
    const context = {
        children: [{ accept: () => "alpha" }, { accept: () => "beta" }]
    };

    assert.deepEqual(visitor.visitProgram(context), ["alpha", "beta"]);
});

void test("delegate receives method metadata and can alter the result", () => {
    let callCount = 0;
    let receivedMethodName = null;
    let receivedContext = null;

    const visitor = new GameMakerLanguageParserVisitor({
        visitChildrenDelegate: ({ methodName, ctx, fallback }) => {
            callCount += 1;
            receivedMethodName = methodName;
            receivedContext = ctx;
            const results = fallback();
            return { methodName, results };
        }
    });

    const context = {
        children: [{ accept: () => "value" }]
    };

    assert.deepEqual(visitor.visitBlock(context), {
        methodName: "visitBlock",
        results: ["value"]
    });
    assert.equal(callCount, 1);
    assert.equal(receivedMethodName, "visitBlock");
    assert.equal(receivedContext, context);
});

void test("non-function delegates fall back to the default visitor behavior", () => {
    const visitor = new GameMakerLanguageParserVisitor({ visitChildrenDelegate: null });
    const context = {
        children: [{ accept: () => "omega" }]
    };

    assert.deepEqual(visitor.visitProgram(context), ["omega"]);
});

void test("all visit methods are exposed on the visitor instance", () => {
    const visitor = new GameMakerLanguageParserVisitor();

    for (const methodName of VISIT_METHOD_NAMES) {
        assert.equal(typeof visitor[methodName], "function", `${methodName} should be a function`);
    }
});

void test("visitor instances satisfy instanceof checks against the base visitor", () => {
    const visitor = new GameMakerLanguageParserVisitor();

    assert.equal(visitor instanceof GameMakerLanguageParserVisitorBase, true);
});
