import assert from "node:assert/strict";
import { test } from "node:test";

import GameMakerLanguageParserListenerBase from "../generated/GameMakerLanguageParserListener.js";
import GameMakerLanguageParserListener, {
    LISTENER_METHOD_NAMES
} from "../src/runtime/game-maker-language-parser-listener.js";

void test("listener methods default to no-op behaviour", () => {
    const listener = new GameMakerLanguageParserListener();

    for (const methodName of LISTENER_METHOD_NAMES) {
        assert.equal(typeof listener[methodName], "function");
        assert.equal(listener[methodName]({}), undefined);
    }
});

void test("listener delegate receives metadata for each call", () => {
    let callCount = 0;
    let lastPayload = null;

    const listener = new GameMakerLanguageParserListener({
        listenerDelegate: (payload) => {
            callCount += 1;
            lastPayload = payload;
        }
    });

    const context = { key: "value" };
    listener.enterProgram(context);

    assert.equal(callCount, 1);
    assert.equal(lastPayload.methodName, "enterProgram");
    assert.equal(lastPayload.phase, "enter");
    assert.equal(lastPayload.ctx, context);
    assert.equal(typeof lastPayload.fallback, "function");
});

void test("method-specific handlers can wrap the delegate", () => {
    let handlerCalls = 0;
    let delegateCalls = 0;

    const listener = new GameMakerLanguageParserListener({
        listenerDelegate: () => {
            delegateCalls += 1;
        },
        listenerHandlers: {
            exitBlock: (ctx, payload) => {
                handlerCalls += 1;
                assert.equal(payload.methodName, "exitBlock");
                assert.equal(payload.phase, "exit");
                assert.equal(payload.ctx, ctx);
                payload.fallback();
            }
        }
    });

    listener.exitBlock({});

    assert.equal(handlerCalls, 1);
    assert.equal(delegateCalls, 1);
});

void test("unhandled methods still route to the delegate", () => {
    let delegateCalls = 0;
    let handlerCalls = 0;

    const listener = new GameMakerLanguageParserListener({
        listenerDelegate: () => {
            delegateCalls += 1;
        },
        listenerHandlers: {
            exitBlock: () => {
                handlerCalls += 1;
            }
        }
    });

    listener.enterProgram({});

    assert.equal(handlerCalls, 0);
    assert.equal(delegateCalls, 1);
});

void test("non-function method handlers are ignored", () => {
    let delegateCalls = 0;

    const listener = new GameMakerLanguageParserListener({
        listenerDelegate: () => {
            delegateCalls += 1;
        },
        listenerHandlers: {
            enterProgram: "not a function" as never
        }
    });

    listener.enterProgram({});

    assert.equal(delegateCalls, 1);
});

void test("empty handler bags fall back to the delegate", () => {
    let delegateCalls = 0;

    const listener = new GameMakerLanguageParserListener({
        listenerDelegate: () => {
            delegateCalls += 1;
        },
        listenerHandlers: {}
    });

    listener.enterProgram({});

    assert.equal(delegateCalls, 1);
});

void test("non-function listener delegates fall back to the default no-op delegate", () => {
    const listener = new GameMakerLanguageParserListener({
        listenerDelegate: "not callable" as never
    });

    assert.equal(listener.enterProgram({}), undefined);
});

void test("listener instances satisfy instanceof checks against the base listener", () => {
    const listener = new GameMakerLanguageParserListener();

    assert.equal(listener instanceof GameMakerLanguageParserListenerBase, true);
});
