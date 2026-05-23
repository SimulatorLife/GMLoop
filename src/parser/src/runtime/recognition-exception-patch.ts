import { Core } from "@gmloop/core";
import antlr4, { type RecognitionException, type Recognizer, type Token, type TokenStream } from "antlr4";

import type { TokenMetadataOptions } from "../types/index.js";

type RecognitionExceptionConstructor = new (...args: unknown[]) => object;
type DefaultErrorStrategyConstructor = new (...args: unknown[]) => object;

const typedAntlr4 = antlr4 as typeof antlr4 & {
    error?: {
        RecognitionException?: RecognitionExceptionConstructor;
        DefaultErrorStrategy?: DefaultErrorStrategyConstructor;
    };
};

const INVALID_INDEX_FALLBACK = -1;

function hasOffendingTokenProbe(value?: any): boolean {
    if (value?.offendingToken !== undefined) {
        return true;
    }

    if (value?.offendingSymbol !== undefined) {
        return true;
    }

    return Core.hasFunction(value, "getOffendingToken");
}

function hasExpectedTokensProbe(value?: any): boolean {
    if (value?.expectedTokens !== undefined) {
        return true;
    }

    return Core.hasFunction(value, "getExpectedTokens");
}

function hasContextProbe(value?: any): boolean {
    const context = value?.ctx ?? value?.context ?? null;
    if (Core.isObjectLike(context)) {
        return true;
    }

    if (Core.isObjectLike(value?.input)) {
        return true;
    }

    return typeof value?.offendingState === "number";
}

/**
 * Check whether {@link value} mirrors the surface area exposed by ANTLR's
 * `RecognitionException`. Parser recoverability helpers need to gracefully
 * inspect both native ANTLR errors and thin wrappers thrown by downstream
 * tooling, so this guard deliberately checks multiple field names instead of
 * relying on `instanceof`.
 *
 * @param {unknown} value Arbitrary error-like object.
 * @returns {boolean}
 *          `true` when {@link value} appears to expose the expected token,
 *          offending token, and context metadata provided by ANTLR.
 */
export function isRecognitionExceptionLike(value?: unknown): boolean {
    if (!value || !Core.isErrorLike(value)) {
        return false;
    }

    if (!hasExpectedTokensProbe(value)) {
        return false;
    }

    if (!hasOffendingTokenProbe(value)) {
        return false;
    }

    if (!hasContextProbe(value)) {
        return false;
    }

    return true;
}

function firstNumber(...values) {
    for (const value of values) {
        if (typeof value === "number") {
            return value;
        }
    }
}

function getTokenStream(recognizer: Recognizer | null | undefined): TokenStream | null {
    if (recognizer && typeof recognizer.getTokenStream === "function") {
        return recognizer.getTokenStream();
    }

    return recognizer?._input ?? null;
}

function ensureTokenMetadata(
    token: Token | number | null | undefined,
    { fallbackCandidates = [], stream }: TokenMetadataOptions = {}
) {
    if (!token || typeof token !== "object") {
        return null;
    }

    const candidates = Core.toArray(fallbackCandidates);
    const fallback = candidates.find((candidate) => candidate && typeof candidate === "object");

    if (typeof token.type !== "number") {
        token.type =
            typeof fallback === "object" && typeof fallback.type === "number"
                ? fallback.type
                : antlr4.Token.INVALID_TYPE;
    }

    if (typeof token.tokenIndex !== "number") {
        const fallbackIndex = firstNumber(
            typeof fallback === "object" ? fallback.tokenIndex : undefined,
            token.index,
            token.startIndex
        );

        token.tokenIndex = fallbackIndex ?? (typeof stream?.index === "number" ? stream.index : INVALID_INDEX_FALLBACK);
    }

    if (typeof token.line !== "number") {
        token.line =
            firstNumber(
                typeof fallback === "object" ? fallback.line : undefined,
                typeof fallback === "object"
                    ? typeof fallback.start === "number"
                        ? fallback.start
                        : fallback.start?.line
                    : undefined,
                typeof token.start === "number" ? token.start : token.start?.line
            ) ?? INVALID_INDEX_FALLBACK;
    }

    if (typeof token.column !== "number") {
        token.column =
            firstNumber(
                typeof fallback === "object" ? fallback.column : undefined,
                typeof fallback === "object"
                    ? typeof fallback.start === "number"
                        ? fallback.start
                        : fallback.start?.column
                    : undefined,
                typeof token.start === "number" ? token.start : token.start?.column
            ) ?? INVALID_INDEX_FALLBACK;
    }

    return token;
}

function ensureOffendingToken(
    recognizer: Recognizer | null | undefined,
    exception: RecognitionException | null | undefined
) {
    if (!exception || typeof exception !== "object") {
        return;
    }

    const stream = getTokenStream(recognizer);
    const context = exception.ctx ?? exception.context ?? recognizer?._ctx ?? null;

    const offendingTokenSources = [
        () => exception.offendingToken ?? exception.offendingSymbol ?? null,
        () => (typeof exception.getOffendingToken === "function" ? exception.getOffendingToken() : null),
        () => context?.stop ?? null,
        () => context?.start ?? null,
        () => (typeof recognizer?.getCurrentToken === "function" ? recognizer.getCurrentToken() : null),
        () => (stream?.LT ? stream.LT(1) : null),
        () => ({
            type: antlr4.Token.INVALID_TYPE,
            tokenIndex: INVALID_INDEX_FALLBACK,
            line: INVALID_INDEX_FALLBACK,
            column: INVALID_INDEX_FALLBACK
        })
    ] as const;

    const offendingToken = offendingTokenSources.map((resolveToken) => resolveToken()).find(Boolean) ?? null;

    exception.offendingToken = ensureTokenMetadata(offendingToken, {
        fallbackCandidates: [context?.stop, context?.start],
        stream
    });

    if (typeof exception.getOffendingToken !== "function") {
        Object.defineProperty(exception, "getOffendingToken", {
            configurable: true,
            value() {
                return this.offendingToken ?? null;
            }
        });
    }
}

function ensureStartToken(
    recognizer: Recognizer | null | undefined,
    exception: RecognitionException | null | undefined
) {
    if (!exception || typeof exception !== "object") {
        return;
    }

    const stream = getTokenStream(recognizer);
    const context = exception.ctx ?? exception.context ?? recognizer?._ctx ?? null;

    const startTokenSources = [
        () => exception.startToken ?? context?.start ?? exception.offendingToken ?? context?.stop ?? null,
        () => (typeof recognizer?.getCurrentToken === "function" ? recognizer.getCurrentToken() : null),
        () => {
            if (!stream?.LT) {
                return null;
            }

            const previous = stream.LT(-1);
            return previous ?? stream.LT(1);
        },
        () => ({
            type:
                typeof exception.offendingToken?.type === "number"
                    ? exception.offendingToken.type
                    : antlr4.Token.INVALID_TYPE,
            tokenIndex:
                typeof exception.offendingToken?.tokenIndex === "number"
                    ? exception.offendingToken.tokenIndex
                    : INVALID_INDEX_FALLBACK,
            line:
                typeof exception.offendingToken?.line === "number"
                    ? exception.offendingToken.line
                    : INVALID_INDEX_FALLBACK,
            column:
                typeof exception.offendingToken?.column === "number"
                    ? exception.offendingToken.column
                    : INVALID_INDEX_FALLBACK
        })
    ] as const;

    const startToken = startTokenSources.map((resolveToken) => resolveToken()).find(Boolean) ?? null;

    exception.startToken = ensureTokenMetadata(startToken, {
        fallbackCandidates: [context?.start, exception.offendingToken],
        stream
    });
}

let isPatched = false;

/**
 * Installs runtime guards that normalize ANTLR recognition exceptions.
 *
 * @remarks
 * The patch is intentionally idempotent because parser modules call this during
 * import-time setup. Reapplying `Symbol.hasInstance` or
 * `reportNoViableAlternative` wrappers would stack behavior and distort parser
 * diagnostics, so repeated calls become no-ops after the first successful
 * installation.
 *
 * @returns Returns immediately when ANTLR's runtime constructors are missing or
 *          when the guard has already been installed for this process.
 */
export function installRecognitionExceptionLikeGuard() {
    if (isPatched) {
        return;
    }

    const recognitionException = typedAntlr4.error?.RecognitionException;
    if (typeof recognitionException !== "function") {
        return;
    }

    const originalHasInstance = recognitionException[Symbol.hasInstance];

    Object.defineProperty(recognitionException, Symbol.hasInstance, {
        configurable: true,
        value(candidate) {
            if (typeof originalHasInstance === "function" && originalHasInstance.call(this, candidate)) {
                return true;
            }

            return isRecognitionExceptionLike(candidate);
        }
    });

    const defaultErrorStrategy = typedAntlr4.error?.DefaultErrorStrategy;
    if (typeof defaultErrorStrategy === "function") {
        const originalReportNoViable = defaultErrorStrategy.prototype.reportNoViableAlternative;
        Object.defineProperty(defaultErrorStrategy.prototype, "reportNoViableAlternative", {
            configurable: true,
            value(recognizer, exception) {
                if (exception && typeof exception === "object") {
                    ensureOffendingToken(recognizer, exception);
                    ensureStartToken(recognizer, exception);
                }

                return originalReportNoViable.call(this, recognizer, exception);
            }
        });
    }

    isPatched = true;
}
