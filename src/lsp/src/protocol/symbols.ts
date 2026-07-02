import { CompletionItemKind, SymbolKind } from "vscode-languageserver/node.js";

const SYMBOL_KINDS_BY_GML_KIND: Readonly<Record<string, SymbolKind>> = Object.freeze({
    callable: SymbolKind.Function,
    constant: SymbolKind.Constant,
    enum: SymbolKind.Enum,
    enumMember: SymbolKind.EnumMember,
    function: SymbolKind.Function,
    globalVariable: SymbolKind.Variable,
    instanceVariable: SymbolKind.Variable,
    localVariable: SymbolKind.Variable,
    macro: SymbolKind.Constant,
    member: SymbolKind.EnumMember,
    object: SymbolKind.Object,
    room: SymbolKind.Namespace,
    script: SymbolKind.Function,
    variable: SymbolKind.Variable
});

const COMPLETION_KINDS_BY_GML_KIND: Readonly<Record<string, CompletionItemKind>> = Object.freeze({
    callable: CompletionItemKind.Function,
    constant: CompletionItemKind.Constant,
    enum: CompletionItemKind.Enum,
    enumMember: CompletionItemKind.EnumMember,
    function: CompletionItemKind.Function,
    globalVariable: CompletionItemKind.Variable,
    instanceVariable: CompletionItemKind.Variable,
    localVariable: CompletionItemKind.Variable,
    macro: CompletionItemKind.Constant,
    member: CompletionItemKind.EnumMember,
    script: CompletionItemKind.Function,
    variable: CompletionItemKind.Variable
});

/**
 * Map GMLoop symbol categories into LSP symbol kinds.
 */
export function gmlSymbolKindToLspSymbolKind(kind: string): SymbolKind {
    return SYMBOL_KINDS_BY_GML_KIND[kind] ?? SymbolKind.String;
}

/**
 * Map GMLoop symbol categories into LSP completion kinds.
 */
export function gmlSymbolKindToCompletionItemKind(kind: string): CompletionItemKind {
    return COMPLETION_KINDS_BY_GML_KIND[kind] ?? CompletionItemKind.Text;
}
