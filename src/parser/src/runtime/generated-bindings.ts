/**
 * Stable abstraction layer for generated ANTLR parser classes.
 *
 * This module provides a clean facade over the generated ANTLR parser code,
 * allowing runtime code to depend on stable constructors and prototypes rather
 * than importing directly from the generated output.
 *
 * Architectural boundaries:
 * - Parser/generated owns: ANTLR-generated lexer, parser, listener, and visitor
 * - Parser/runtime owns: Custom parse tree traversal, AST building, and runtime logic
 * - This facade: Provides stable handles to generated classes without exposing internals
 *
 * The deep relative imports (../../generated/) are acceptable here because:
 * 1. They're internal to the parser workspace
 * 2. The generated code location is fixed and predictable
 * 3. This file IS the abstraction layer that shields other code from these details
 *
 * All other parser code should import from this facade, not from generated/ directly.
 */

import GameMakerLanguageParserListenerBase from "../../generated/GameMakerLanguageParserListener.js";
import GameMakerLanguageParserVisitorBase from "../../generated/GameMakerLanguageParserVisitor.js";
import type { ParserContext } from "../types/index.js";

export type ParseTreeListenerMethod = (...args: unknown[]) => unknown;

export type ParseTreeVisitorMethod = (...args: unknown[]) => unknown;

export interface ParserListenerBase {
    _dispatch?(methodName: string, ctx: ParserContext): unknown;
    [methodName: string]: ParseTreeListenerMethod;
}

export interface ParserListenerBaseConstructor {
    new (): ParserListenerBase;
    readonly prototype: ParserListenerBase;
}

/**
 * The structural shape of a compositional parse-tree listener wrapper.
 *
 * Mirrors {@link ParserVisitorPrototype} for the listener side. Includes a
 * symbol index signature so wrapper instances can carry the
 * WRAPPER_INSTANCE_MARKER used by {@link ensureHasInstancePatched}.
 */
export interface ParserListenerPrototype {
    _dispatch?(methodName: string, ctx: ParserContext): unknown;
    [methodName: string]: ParseTreeListenerMethod;
    [methodSymbol: symbol]: unknown;
}

export interface ParserVisitorPrototype {
    visitChildren: ParseTreeVisitorMethod;
    [methodName: string]: ParseTreeVisitorMethod;
    [methodSymbol: symbol]: unknown;
}

export interface ParserVisitorBaseConstructor {
    new (): ParserVisitorPrototype;
    readonly prototype: ParserVisitorPrototype;
}

function coerceParserListenerBaseConstructor(value: unknown): ParserListenerBaseConstructor {
    return value as ParserListenerBaseConstructor;
}

function coerceParserVisitorBaseConstructor(value: unknown): ParserVisitorBaseConstructor {
    return value as ParserVisitorBaseConstructor;
}

/**
 * Provides a stable handle to the generated parser listener base class so
 * runtime code can depend on an injected constructor rather than reaching into
 * the generated output directly.
 */
export function getParserListenerBase(): ParserListenerBaseConstructor {
    return coerceParserListenerBaseConstructor(GameMakerLanguageParserListenerBase);
}

/**
 * Provides a stable handle to the generated parser visitor base class so
 * runtime code can depend on an injected constructor rather than reaching into
 * the generated output directly.
 */
export function getParserVisitorBase(): ParserVisitorBaseConstructor {
    return coerceParserVisitorBaseConstructor(GameMakerLanguageParserVisitorBase);
}

/**
 * Exposes the shared parse tree listener prototype used by the generated base
 * class so wrappers can delegate inherited behaviour without relying on the
 * generated module layout.
 *
 * The returned prototype is the {@link https://antlr.org | antlr4}
 * `ParseTreeListener` prototype that sits one level above the generated
 * `GameMakerLanguageParserListener.prototype`. Delegating to it lets a
 * compositional wrapper honour the `enterEveryRule` / `exitEveryRule` /
 * `visitTerminal` / `visitErrorNode` contract without inheriting the
 * generated class.
 */
export function getParseTreeListenerPrototype(): ParserListenerPrototype {
    return Object.getPrototypeOf(getParserListenerBase().prototype) as ParserListenerPrototype;
}

/**
 * Exposes the shared parse tree visitor prototype used by the generated base
 * class so wrappers can delegate inherited behaviour without relying on the
 * generated module layout.
 */
export function getParseTreeVisitorPrototype(): ParserVisitorPrototype {
    return Object.getPrototypeOf(getParserVisitorBase().prototype) as ParserVisitorPrototype;
}
