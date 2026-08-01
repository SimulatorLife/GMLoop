import type { Semantic } from "@gmloop/semantic";
import { type SemanticTokens, SemanticTokensBuilder, type SemanticTokensLegend } from "vscode-languageserver/node.js";

import { type GmlTextDocument, offsetToPosition } from "../documents/index.js";

/** Stable semantic-token legend advertised by the GML language server. */
export const GML_SEMANTIC_TOKEN_LEGEND: SemanticTokensLegend = Object.freeze({
    tokenTypes: [
        "function",
        "method",
        "class",
        "parameter",
        "variable",
        "property",
        "enum",
        "enumMember",
        "macro",
        "namespace"
    ],
    tokenModifiers: ["declaration", "definition", "readonly", "static", "deprecated", "defaultLibrary"]
});

/** Encode semantic GML facts using the standard LSP relative token representation. */
export function encodeGmlSemanticTokens(
    document: GmlTextDocument,
    tokens: ReturnType<typeof Semantic.collectGmlSemanticHighlights>
): SemanticTokens {
    const builder = new SemanticTokensBuilder();
    for (const token of tokens) {
        const start = offsetToPosition(document, token.start);
        const end = offsetToPosition(document, token.end);
        if (start.line !== end.line) continue;
        const tokenType = GML_SEMANTIC_TOKEN_LEGEND.tokenTypes.indexOf(token.kind);
        if (tokenType === -1) continue;
        let modifierBits = 0;
        for (const modifier of token.modifiers) {
            const modifierIndex = GML_SEMANTIC_TOKEN_LEGEND.tokenModifiers.indexOf(modifier);
            if (modifierIndex !== -1) modifierBits |= 1 << modifierIndex;
        }
        builder.push(start.line, start.character, end.character - start.character, tokenType, modifierBits);
    }
    return builder.build();
}
