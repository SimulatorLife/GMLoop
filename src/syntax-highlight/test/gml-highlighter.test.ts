import assert from "node:assert/strict";
import test from "node:test";

import { highlightGml, tokenizeGml } from "../src/gml-highlighter.js";

function findToken(source: string, text: string): ReturnType<typeof tokenizeGml>[number] | undefined {
    return tokenizeGml(source).find((token) => token.text === text);
}

void test("tokenizeGml preserves source while covering GML lexical families", () => {
    const source = String.raw`#macro COLOR $ff00aa
/// docs
function café(value) constructor {
    var grid = value[# 0, 1];
    grid.total ??= 0b_1010;
    return @"verbatim ""text""" + $"value {value}";
}`;
    const tokens = tokenizeGml(source);

    assert.equal(tokens.map((token) => token.text).join(""), source);
    assert.equal(findToken(source, "#macro")?.type, "directive");
    assert.equal(findToken(source, "/// docs")?.type, "comment");
    assert.equal(findToken(source, "function")?.type, "keyword");
    assert.equal(findToken(source, "café")?.type, "function-name");
    assert.equal(findToken(source, "[#")?.type, "punctuation");
    assert.equal(findToken(source, "total")?.type, "property-access");
    assert.equal(findToken(source, "??=")?.type, "operator");
    assert.equal(findToken(source, "0b_1010")?.type, "number");
    assert.equal(findToken(source, '@"verbatim ""text"""')?.type, "string");
    assert.equal(findToken(source, '$"value {value}"')?.type, "string");
});

void test("tokenizeGml handles incomplete comments and strings", () => {
    assert.deepEqual(tokenizeGml("/* open"), [{ type: "comment", text: "/* open" }]);
    assert.deepEqual(tokenizeGml('"open'), [{ type: "string", text: '"open' }]);
    assert.deepEqual(tokenizeGml('$"open {value}'), [{ type: "string", text: '$"open {value}' }]);
});

void test("tokenizeGml recognizes numeric forms without consuming adjacent operators", () => {
    const tokens = tokenizeGml("1+2 .5 2. 1.5e-10 $CA_FE #12ab 0b_10");
    const numbers = tokens.filter((token) => token.type === "number").map((token) => token.text);
    assert.deepEqual(numbers, ["1", "2", ".5", "2.", "1.5e-10", "$CA_FE", "#12ab", "0b_10"]);
    assert.equal(findToken("1+2", "+")?.type, "operator");
});

void test("comments and strings take precedence over operators and directives", () => {
    assert.deepEqual(tokenizeGml("// #region +"), [{ type: "comment", text: "// #region +" }]);
    assert.deepEqual(tokenizeGml('"// #macro +"'), [{ type: "string", text: '"// #macro +"' }]);
});

void test("highlightGml escapes HTML while retaining stable CSS classes", () => {
    const highlighted = highlightGml("if (value < 2) return &value;");
    assert.match(highlighted, /class="gml-keyword">if<\/span>/u);
    assert.match(highlighted, /class="gml-operator">&lt;<\/span>/u);
    assert.match(highlighted, /class="gml-operator">&amp;<\/span>/u);
    assert.doesNotMatch(highlighted, /< 2/u);
});
