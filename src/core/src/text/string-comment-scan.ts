/**
 * State used while scanning through string literals and comment blocks.
 */
export type StringCommentScanState = {
    stringQuote: string | null;
    stringEscape: boolean;
    inLineComment: boolean;
    inBlockComment: boolean;
};

/**
 * Create a new string/comment scan state object.
 */
export function createStringCommentScanState(): StringCommentScanState {
    return {
        stringQuote: null,
        stringEscape: false,
        inLineComment: false,
        inBlockComment: false
    };
}

/**
 * Advance the scan index through the current string literal, updating state.
 */
export function advanceThroughStringLiteral(text: string, currentIndex: number, state: StringCommentScanState): number {
    const character = text[currentIndex];
    const nextIndex = currentIndex + 1;

    if (state.stringEscape) {
        state.stringEscape = false;
        return nextIndex;
    }

    if (character === "\\") {
        state.stringEscape = true;
        return nextIndex;
    }

    if (character === state.stringQuote) {
        state.stringQuote = null;
    }

    return nextIndex;
}

/**
 * Advance the scan index through the current comment block, updating state.
 */
export function advanceThroughComment(
    text: string,
    length: number,
    currentIndex: number,
    state: StringCommentScanState
): number {
    const character = text[currentIndex];
    const nextIndex = currentIndex + 1;

    if (state.inLineComment) {
        if (character === "\n" || character === "\r") {
            state.inLineComment = false;
        }
        return nextIndex;
    }

    if (character === "*" && currentIndex + 1 < length && text[currentIndex + 1] === "/") {
        state.inBlockComment = false;
        return currentIndex + 2;
    }

    return nextIndex;
}

/**
 * Start scanning a string literal or comment if one begins at the current index.
 */
export function tryStartStringOrComment(
    text: string,
    length: number,
    currentIndex: number,
    state: StringCommentScanState
): number {
    const character = text[currentIndex];

    if (character === "'" || character === '"' || character === "`") {
        state.stringQuote = character;
        state.stringEscape = false;
        return currentIndex + 1;
    }

    if (character === "/" && currentIndex + 1 < length) {
        const nextCharacter = text[currentIndex + 1];

        if (nextCharacter === "/") {
            state.inLineComment = true;
            return currentIndex + 2;
        }

        if (nextCharacter === "*") {
            state.inBlockComment = true;
            return currentIndex + 2;
        }
    }

    return currentIndex;
}

/**
 * Advance the scan index when the cursor is inside a string/comment or when a new
 * string/comment begins at the current position.
 */
export function advanceStringCommentScan(
    text: string,
    length: number,
    currentIndex: number,
    state: StringCommentScanState,
    allowAtString = false
): number {
    if (state.stringQuote) {
        return advanceThroughStringLiteral(text, currentIndex, state);
    }

    if (state.inLineComment || state.inBlockComment) {
        return advanceThroughComment(text, length, currentIndex, state);
    }

    if (allowAtString && text[currentIndex] === "@" && currentIndex + 1 < length) {
        const nextCharacter = text[currentIndex + 1];
        if (nextCharacter === "'" || nextCharacter === '"') {
            state.stringQuote = nextCharacter;
            state.stringEscape = false;
            return currentIndex + 2;
        }
    }

    return tryStartStringOrComment(text, length, currentIndex, state);
}
