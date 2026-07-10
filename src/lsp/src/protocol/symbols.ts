import { Semantic } from "@gmloop/semantic";
import { CompletionItemKind, SymbolKind } from "vscode-languageserver/node.js";

type GmlSemanticSymbolKind = Parameters<typeof Semantic.getGmlSymbolKindSpecificity>[0];

type LspSymbolPresentation = Readonly<{ completion: CompletionItemKind; symbol: SymbolKind }>;

const LSP_PRESENTATION_BY_GML_KIND: Readonly<Record<GmlSemanticSymbolKind, LspSymbolPresentation>> = Object.freeze({
    callable: { symbol: SymbolKind.Function, completion: CompletionItemKind.Function },
    constant: { symbol: SymbolKind.Constant, completion: CompletionItemKind.Constant },
    constructorStaticMember: { symbol: SymbolKind.Method, completion: CompletionItemKind.Method },
    enum: { symbol: SymbolKind.Enum, completion: CompletionItemKind.Enum },
    enumMember: { symbol: SymbolKind.EnumMember, completion: CompletionItemKind.EnumMember },
    function: { symbol: SymbolKind.Function, completion: CompletionItemKind.Function },
    globalVariable: { symbol: SymbolKind.Variable, completion: CompletionItemKind.Variable },
    instanceVariable: { symbol: SymbolKind.Property, completion: CompletionItemKind.Property },
    localVariable: { symbol: SymbolKind.Variable, completion: CompletionItemKind.Variable },
    macro: { symbol: SymbolKind.Constant, completion: CompletionItemKind.Constant },
    member: { symbol: SymbolKind.Property, completion: CompletionItemKind.Property },
    object: { symbol: SymbolKind.Object, completion: CompletionItemKind.Class },
    resource: { symbol: SymbolKind.Namespace, completion: CompletionItemKind.Reference },
    room: { symbol: SymbolKind.Namespace, completion: CompletionItemKind.Reference },
    script: { symbol: SymbolKind.Function, completion: CompletionItemKind.Function },
    struct: { symbol: SymbolKind.Struct, completion: CompletionItemKind.Struct },
    structVariable: { symbol: SymbolKind.Property, completion: CompletionItemKind.Property },
    unresolved: { symbol: SymbolKind.String, completion: CompletionItemKind.Text },
    variable: { symbol: SymbolKind.Variable, completion: CompletionItemKind.Variable }
});

/**
 * Map GMLoop symbol categories into LSP symbol kinds.
 */
export function gmlSymbolKindToLspSymbolKind(kind: string): SymbolKind {
    return LSP_PRESENTATION_BY_GML_KIND[Semantic.normalizeGmlSemanticSymbolKind(kind)].symbol;
}

/**
 * Map GMLoop symbol categories into LSP completion kinds.
 */
export function gmlSymbolKindToCompletionItemKind(kind: string): CompletionItemKind {
    return LSP_PRESENTATION_BY_GML_KIND[Semantic.normalizeGmlSemanticSymbolKind(kind)].completion;
}
