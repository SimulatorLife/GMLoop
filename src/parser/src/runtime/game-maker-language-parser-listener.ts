import { Core } from "@gmloop/core";

import type { ListenerDelegate, ListenerOptions, ParserContext } from "../types/index.js";
import { VISIT_METHOD_NAMES } from "./game-maker-language-parser-visitor.js";
import {
    getParserListenerBase,
    getParseTreeListenerPrototype,
    type ParserListenerBaseConstructor,
    type ParserListenerPrototype,
    type ParseTreeListenerMethod
} from "./generated-bindings.js";
import { collectPrototypeMethodNames, deriveListenerMethodNames } from "./method-reflection.js";
import { definePrototypeMethods } from "./prototype-builder.js";
import { createWrapperSymbols, ensureHasInstancePatched } from "./symbol-patching.js";

const DEFAULT_LISTENER_DELEGATE: ListenerDelegate = ({ fallback = Core.noop }) => fallback();

export const LISTENER_METHOD_NAMES = Object.freeze(deriveListenerMethodNames(VISIT_METHOD_NAMES));

const GeneratedParserListenerBase: ParserListenerBaseConstructor = getParserListenerBase();

// The antlr4 ParseTreeListener prototype that sits above the generated listener.
// Delegating to it lets a compositional wrapper honour the enterEveryRule /
// exitEveryRule / visitTerminal / visitErrorNode contract without inheriting.
const PARSE_TREE_LISTENER_PROTOTYPE: ParserListenerPrototype = getParseTreeListenerPrototype();

// Collect ParseTreeListener base method names so we can delegate them explicitly.
const INHERITED_LISTENER_METHOD_NAMES = Object.freeze(collectPrototypeMethodNames(PARSE_TREE_LISTENER_PROTOTYPE));

// Symbols used to mark wrapper instances and track patch state, parallel to the
// visitor wrapper symbols. The patch flag prevents double-patching on re-import.
const { instance: WRAPPER_INSTANCE_MARKER, patchFlag: HAS_INSTANCE_PATCHED_MARKER } = createWrapperSymbols(
    "GameMakerLanguageParserListener"
);

// Patch Symbol.hasInstance on the generated base so that compositional wrapper
// instances (carrying WRAPPER_INSTANCE_MARKER) satisfy instanceof checks that
// downstream ANTLR tooling may perform. This mirrors the visitor's patching.
ensureHasInstancePatched(GeneratedParserListenerBase, {
    markerSymbol: WRAPPER_INSTANCE_MARKER,
    patchFlagSymbol: HAS_INSTANCE_PATCHED_MARKER
});

function createListenerDelegate(options: ListenerOptions = {}): ListenerDelegate {
    const { listenerDelegate, listenerHandlers } = options;
    const baseDelegate = typeof listenerDelegate === "function" ? listenerDelegate : DEFAULT_LISTENER_DELEGATE;

    if (!listenerHandlers || typeof listenerHandlers !== "object") {
        return baseDelegate;
    }

    const handlerMap: Record<string, ListenerOptions["listenerHandlers"][string]> = {};

    for (const [methodName, candidate] of Object.entries(listenerHandlers)) {
        if (typeof candidate !== "function") {
            continue;
        }
        handlerMap[methodName] = candidate;
    }

    if (Object.keys(handlerMap).length === 0) {
        return baseDelegate;
    }

    return (payload) => {
        const handler = handlerMap[payload.methodName];
        if (!handler) {
            return baseDelegate(payload);
        }

        return handler(payload.ctx, {
            ...payload,
            fallback: () => baseDelegate(payload)
        });
    };
}

/**
 * Compositional wrapper around the generated ANTLR parse-tree listener.
 *
 * Uses composition rather than inheritance to avoid deepening the generated
 * class hierarchy. The generated base ({@link GeneratedParserListenerBase}) is
 * patched via {@link ensureHasInstancePatched} so this wrapper still satisfies
 * `instanceof` checks that ANTLR tooling may perform at runtime.
 *
 * This mirrors the composition approach already used by
 * {@link GameMakerLanguageParserVisitor}.
 */
export default class GameMakerLanguageParserListener implements ParserListenerPrototype {
    [methodName: string]: ParseTreeListenerMethod;
    [methodSymbol: symbol]: unknown;
    #listenerDelegate: ListenerDelegate;

    constructor(options: ListenerOptions = {}) {
        this.#listenerDelegate = createListenerDelegate(options);
        // Mark this instance so the patched Symbol.hasInstance on the generated
        // base class recognises it as a valid listener without inheritance.
        this[WRAPPER_INSTANCE_MARKER] = true;
    }

    _dispatch(methodName: string, ctx: ParserContext) {
        const phase = methodName.startsWith("enter") ? "enter" : "exit";
        return this.#listenerDelegate({
            methodName,
            phase,
            ctx,
            fallback: Core.noop
        });
    }
}

// Delegate the inherited ParseTreeListener base methods (enterEveryRule,
// exitEveryRule, visitTerminal, visitErrorNode) to the original prototype so
// any ANTLR tooling that calls them observes the same no-op behaviour it
// expects from the generated class hierarchy.
definePrototypeMethods(
    GameMakerLanguageParserListener.prototype,
    INHERITED_LISTENER_METHOD_NAMES,
    (methodName: string) => {
        const inherited =
            typeof PARSE_TREE_LISTENER_PROTOTYPE[methodName] === "function"
                ? PARSE_TREE_LISTENER_PROTOTYPE[methodName]
                : Core.noop;
        return function (this: GameMakerLanguageParserListener, ...args: unknown[]) {
            return inherited.call(this, ...args) as unknown;
        };
    }
);

// Define all enter/exit grammar-rule listener methods to route through _dispatch.
definePrototypeMethods(
    GameMakerLanguageParserListener.prototype,
    LISTENER_METHOD_NAMES,
    (methodName: string) =>
        function (this: GameMakerLanguageParserListener, ctx: ParserContext) {
            return this._dispatch(methodName, ctx);
        }
);
