import { createCommentBlockNode, createCommentLineNode, createWhitespaceNode } from "./comment-nodes.js";

type LexerTokenKinds = {
    EOF: number;
    SingleLineComment: number;
    MultiLineComment: number;
    WhiteSpaces: number;
    LineTerminator: number;
};

type HiddenToken = {
    type: number;
    text?: string;
    [key: string]: unknown;
};

type HiddenCommentNode = ReturnType<typeof createCommentLineNode>;

type HiddenCommentMetadata = {
    isTopComment?: boolean;
    isBottomComment?: boolean;
};

type HiddenNodeState = {
    reachedEndOfFile: boolean;
    previousComment: HiddenCommentNode | null;
    finalComment: HiddenCommentNode | null;
    pendingWhitespace: string;
    previousSignificantCharacter: string;
    sawSignificantToken: boolean;
};

type HiddenNodeProcessorOptions = {
    comments: unknown[];
    whitespaces: unknown[];
    lexerTokens: LexerTokenKinds;
};

function createInitialState(): HiddenNodeState {
    return {
        reachedEndOfFile: false,
        previousComment: null,
        finalComment: null,
        pendingWhitespace: "",
        previousSignificantCharacter: "",
        sawSignificantToken: false
    };
}

function markTopComment(comment: HiddenCommentNode, state: HiddenNodeState): void {
    if (!state.sawSignificantToken) {
        (comment as HiddenCommentMetadata).isTopComment = true;
        state.sawSignificantToken = true;
    }
}

function appendComment(comment: HiddenCommentNode, state: HiddenNodeState, comments: unknown[]): void {
    state.previousComment = comment;
    state.finalComment = comment;
    state.pendingWhitespace = "";
    comments.push(comment);
    markTopComment(comment, state);
}

function appendWhitespace(
    token: HiddenToken,
    tokenText: string,
    isNewline: boolean,
    state: HiddenNodeState,
    whitespaces: unknown[]
): void {
    const whitespace = createWhitespaceNode({
        token,
        tokenText,
        isNewline
    });
    whitespaces.push(whitespace);

    if (state.previousComment) {
        state.previousComment.trailingWS += whitespace.value;
    }

    state.previousComment = null;
    state.pendingWhitespace += whitespace.value;
}

function recordSignificantToken(tokenText: string, state: HiddenNodeState): void {
    state.sawSignificantToken = true;

    if (state.previousComment) {
        state.previousComment.trailingChar = tokenText;
    }

    state.previousComment = null;
    state.pendingWhitespace = "";
    state.previousSignificantCharacter = tokenText.slice(-1);
}

function markEndOfFile(state: HiddenNodeState): void {
    state.reachedEndOfFile = true;

    if (state.finalComment) {
        (state.finalComment as HiddenCommentMetadata).isBottomComment = true;
    }
}

export function createHiddenNodeProcessor({ comments, whitespaces, lexerTokens }: HiddenNodeProcessorOptions) {
    const state = createInitialState();

    return {
        hasReachedEnd() {
            return state.reachedEndOfFile;
        },
        processToken(token: HiddenToken) {
            const tokenText = token.text ?? "";

            if (token.type === lexerTokens.EOF) {
                markEndOfFile(state);
                return;
            }

            if (token.type === lexerTokens.WhiteSpaces || token.type === lexerTokens.LineTerminator) {
                appendWhitespace(token, tokenText, token.type === lexerTokens.LineTerminator, state, whitespaces);
                return;
            }

            if (token.type === lexerTokens.SingleLineComment || token.type === lexerTokens.MultiLineComment) {
                const comment =
                    token.type === lexerTokens.SingleLineComment
                        ? createCommentLineNode({
                              token,
                              tokenText,
                              leadingWS: state.pendingWhitespace,
                              leadingChar: state.previousSignificantCharacter
                          })
                        : createCommentBlockNode({
                              token,
                              tokenText,
                              leadingWS: state.pendingWhitespace,
                              leadingChar: state.previousSignificantCharacter
                          });

                appendComment(comment, state, comments);
                return;
            }

            recordSignificantToken(tokenText, state);
        }
    };
}
