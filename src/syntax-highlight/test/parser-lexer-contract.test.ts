import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
    GML_DIRECTIVES,
    GML_KEYWORDS,
    GML_SYMBOL_OPERATORS,
    GML_WORD_OPERATORS
} from "../src/gml-language-definition.js";

const PARSER_LEXER_URL = new URL("../../../parser/GameMakerLanguageLexer.g4", import.meta.url);

void test("shared fixed syntax remains represented in the parser lexer grammar", async () => {
    const lexerGrammar = await readFile(PARSER_LEXER_URL, "utf8");
    const lexerLiteralWordOperators = GML_WORD_OPERATORS.filter((operator) => operator !== "not");
    const sharedFixedSyntax = [
        ...GML_DIRECTIVES,
        ...GML_KEYWORDS,
        ...GML_SYMBOL_OPERATORS,
        ...lexerLiteralWordOperators
    ];

    for (const spelling of sharedFixedSyntax) {
        assert.ok(
            lexerGrammar.includes(`'${spelling}'`),
            `Parser lexer must contain shared syntax spelling ${spelling}`
        );
    }

    assert.ok(GML_WORD_OPERATORS.includes("not"), "Highlighter must cover the parser's pre-lex logical-not alias");
});
