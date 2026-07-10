import languageDefinition from "./gml-language-definition.json" with { type: "json" };

/** Lexical categories emitted by the shared GML syntax highlighter. */
export type GmlTokenType =
    | "builtin-constant"
    | "comment"
    | "directive"
    | "function-name"
    | "identifier"
    | "keyword"
    | "number"
    | "operator"
    | "plain"
    | "property-access"
    | "punctuation"
    | "string";

/** A source-preserving GML highlighting token. */
export interface GmlToken {
    readonly text: string;
    readonly type: GmlTokenType;
}

/** Fixed keyword spellings accepted by the GML parser lexer. */
export const GML_KEYWORDS: readonly string[] = Object.freeze(languageDefinition.keywords);

/** Language constants highlighted consistently in the UI and editor grammar. */
export const GML_BUILTIN_CONSTANTS: readonly string[] = Object.freeze(languageDefinition.builtinConstants);

/** Word-form operators accepted by the GML parser lexer. */
export const GML_WORD_OPERATORS: readonly string[] = Object.freeze(languageDefinition.wordOperators);

/** Symbol operators, ordered longest-first for deterministic tokenization. */
export const GML_SYMBOL_OPERATORS: readonly string[] = Object.freeze(languageDefinition.symbolOperators);

/** GML preprocessor directives recognized by the parser lexer. */
export const GML_DIRECTIVES: readonly string[] = Object.freeze(languageDefinition.directives);

/** TextMate scopes used by the generated/static VS Code grammar for each shared category. */
export const GML_TEXTMATE_SCOPE_BY_TOKEN_TYPE: Readonly<Record<GmlTokenType, string>> = Object.freeze(
    languageDefinition.textMateScopes
);
