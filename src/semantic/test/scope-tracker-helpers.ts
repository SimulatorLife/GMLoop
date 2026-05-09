import type ScopeTracker from "../src/scopes/scope-tracker.js";

export type SourceLocation = {
    line: number;
    index: number;
};

export type SourceRange = {
    start: SourceLocation;
    end: SourceLocation;
};

/**
 * Wraps a ScopeTracker instance with a spy on {@link normalizeTrackedPath} that
 * records how many times each path string is presented for normalization.
 * Callers use the returned `repeatedPathNormalizations` counter to assert that
 * the batch API normalizes each distinct input at most once.
 *
 * @example
 * ```ts
 * const { tracker, repeatedPathNormalizations } = wrapNormalizedPathSpy(tracker);
 * tracker.getBatchFilePathsDeclaringSymbols(["alpha", "beta"]);
 * assert.equal(repeatedPathNormalizations, 0, "each source path normalized at most once");
 * ```
 */
export function wrapNormalizedPathSpy(target: ScopeTracker): {
    tracker: ScopeTracker;
    repeatedPathNormalizations: number;
} {
    const trackerPrototype = Object.getPrototypeOf(target) as {
        normalizeTrackedPath(path: string): string;
    };
    const original = trackerPrototype.normalizeTrackedPath.bind(target);
    const seenInputs = new Set<string>();
    let repeatedPathNormalizations = 0;

    Object.defineProperty(target, "normalizeTrackedPath", {
        value: (path: string): string => {
            if (seenInputs.has(path)) {
                repeatedPathNormalizations += 1;
            } else {
                seenInputs.add(path);
            }
            return original(path);
        },
        configurable: true
    });

    return {
        get tracker() {
            return target;
        },
        get repeatedPathNormalizations() {
            return repeatedPathNormalizations;
        }
    };
}

export function createLocation(line: number, index: number = 0): SourceLocation {
    return { line, index };
}

export function createRange(
    startLineOrLine: number,
    startIndexOrStartIdx: number,
    endLineOrEndIdx: number,
    endIndex?: number
): SourceRange {
    if (endIndex === undefined) {
        return {
            start: createLocation(startLineOrLine, startIndexOrStartIdx),
            end: createLocation(startLineOrLine, endLineOrEndIdx)
        };
    }
    return {
        start: createLocation(startLineOrLine, startIndexOrStartIdx),
        end: createLocation(endLineOrEndIdx, endIndex)
    };
}

function createSymbolLocation(name: string, line: number, startIdx: number, endIdx: number) {
    return {
        name,
        start: { line, column: 0, index: startIdx },
        end: { line, column: endIdx - startIdx, index: endIdx }
    };
}

/**
 * Creates a symbol declaration fixture for testing.
 * Semantically represents a declaration site (e.g., `var x = 5;`).
 */
export function createSymbolDeclaration(name: string, line: number, startIdx: number, endIdx: number) {
    return createSymbolLocation(name, line, startIdx, endIdx);
}

/**
 * Creates a symbol reference fixture for testing.
 * Semantically represents a reference/usage site (e.g., `console.log(x);`).
 */
export function createSymbolReference(name: string, line: number, startIdx: number, endIdx: number) {
    return createSymbolLocation(name, line, startIdx, endIdx);
}

export function declareTwoGlobalSymbols(tracker: ScopeTracker) {
    tracker.declare("globalVar", createSymbolDeclaration("globalVar", 1, 0, 9));
    tracker.declare("anotherGlobal", createSymbolDeclaration("anotherGlobal", 2, 10, 23));
}

export function setupNestedScopes(tracker: ScopeTracker) {
    tracker.enterScope("program");
    const programScope = tracker.currentScope();
    tracker.declare("globalVar", createRange(1, 0, 9));

    tracker.enterScope("function");
    const functionScope = tracker.currentScope();
    tracker.declare("localVar", createRange(2, 0, 8));

    return { programScope, functionScope };
}

/**
 * Declares `name` in `tracker` at the given `line` (default 1).
 * Convenience wrapper for tests that only care about identity and position,
 * not exact byte offsets.
 */
export function declareAt(tracker: ScopeTracker, name: string, line: number = 1): void {
    tracker.declare(name, {
        name,
        start: { line, column: 0, index: 0 },
        end: { line, column: name.length, index: name.length }
    });
}

/**
 * Records a reference to `name` in `tracker` at the given `line` (default 2).
 * Convenience wrapper for tests that only care about identity and position,
 * not exact byte offsets.
 */
export function referenceAt(tracker: ScopeTracker, name: string, line: number = 2): void {
    tracker.reference(name, {
        name,
        start: { line, column: 0, index: 0 },
        end: { line, column: name.length, index: name.length }
    });
}
