import assert from "node:assert/strict";
import test from "node:test";

import { highlightGml, tokenizeGml } from "../src/app/syntax-highlight-gml.js";

void test("tokenizeGml recognizes single-line comments", () => {
    const tokens = tokenizeGml("// this is a comment");
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].type, "comment");
    assert.equal(tokens[0].text, "// this is a comment");
});

void test("tokenizeGml recognizes multi-line comments", () => {
    const tokens = tokenizeGml("/* this is\na comment */");
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].type, "comment");
    assert.equal(tokens[0].text, "/* this is\na comment */");
});

void test("tokenizeGml recognizes double-quoted strings", () => {
    const tokens = tokenizeGml('"hello world"');
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].type, "string");
    assert.equal(tokens[0].text, '"hello world"');
});

void test("tokenizeGml recognizes single-quoted strings", () => {
    const tokens = tokenizeGml("'hello world'");
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].type, "string");
    assert.equal(tokens[0].text, "'hello world'");
});

void test("tokenizeGml recognizes escape sequences in strings", () => {
    const tokens = tokenizeGml(String.raw`"hello \"escaped\" world"`);
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].type, "string");
});

void test("tokenizeGml recognizes integer numbers", () => {
    const tokens = tokenizeGml("42");
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].type, "number");
    assert.equal(tokens[0].text, "42");
});

void test("tokenizeGml recognizes float numbers", () => {
    const tokens = tokenizeGml("3.14159");
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].type, "number");
    assert.equal(tokens[0].text, "3.14159");
});

void test("tokenizeGml recognizes scientific notation numbers", () => {
    const tokens = tokenizeGml("1.5e10");
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].type, "number");
    assert.equal(tokens[0].text, "1.5e10");
});

void test("tokenizeGml recognizes GML keywords", () => {
    const keywords = [
        "function",
        "var",
        "if",
        "else",
        "for",
        "while",
        "return",
        "and",
        "or",
        "not",
        "enum",
        "static",
        "globalvar"
    ];
    for (const keyword of keywords) {
        const tokens = tokenizeGml(keyword);
        assert.equal(tokens.length, 1, `Keyword "${keyword}" should produce one token`);
        assert.equal(tokens[0].type, "keyword", `Keyword "${keyword}" should be type "keyword"`);
        assert.equal(tokens[0].text, keyword);
    }
});

void test("tokenizeGml recognizes builtin constants", () => {
    const constants = ["true", "false", "undefined", "noone", "pointer_invalid", "pointer_null"];
    for (const c of constants) {
        const tokens = tokenizeGml(c);
        assert.equal(tokens.length, 1);
        assert.equal(tokens[0].type, "builtin-constant", `Constant "${c}" should be type "builtin-constant"`);
    }
});

void test("tokenizeGml recognizes function names (identifier followed by parenthesis)", () => {
    const tokens = tokenizeGml("my_function(");
    assert.equal(tokens.length, 2);
    assert.equal(tokens[0].type, "function-name");
    assert.equal(tokens[0].text, "my_function");
    assert.equal(tokens[1].type, "punctuation");
    assert.equal(tokens[1].text, "(");
});

void test("tokenizeGml recognizes built-in function names with underscores", () => {
    const tokens = tokenizeGml("array_length(inventory)");
    const funcToken = tokens.find((t) => t.text === "array_length");
    assert.ok(funcToken, "array_length should be recognized");
    assert.equal(funcToken?.type, "function-name");
});

void test("tokenizeGml recognizes property access dot", () => {
    const tokens = tokenizeGml("obj.x");
    assert.equal(tokens.length, 3);
    assert.equal(tokens[0].type, "plain");
    assert.equal(tokens[0].text, "obj");
    assert.equal(tokens[1].type, "property-access");
    assert.equal(tokens[1].text, ".");
    assert.equal(tokens[2].type, "plain");
    assert.equal(tokens[2].text, "x");
});

void test("tokenizeGml recognizes dot as property-access when followed by identifier", () => {
    // In GML, "a . b" means "access property b on a"
    const tokens = tokenizeGml("a . b");
    const dotToken = tokens.find((t) => t.text === ".");
    assert.ok(dotToken, "dot should be recognized");
    assert.equal(dotToken?.type, "property-access", "dot before identifier is property access, not punctuation");
});

void test("tokenizeGml recognizes operators", () => {
    const operators = ["+", "-", "*", "/", "=", "<", ">", "!"];
    for (const op of operators) {
        const tokens = tokenizeGml(`a ${op} b`);
        assert.ok(
            tokens.some((t) => t.type === "operator" && t.text === op),
            `Operator "${op}" should be recognized`
        );
    }
});

void test("tokenizeGml recognizes two-character operators", () => {
    const twoCharOps = ["==", "!=", "<=", ">=", "&&", "||", "+=", "-=", "*=", "/=", "++", "--"];
    for (const op of twoCharOps) {
        const tokens = tokenizeGml(`a ${op} b`);
        assert.ok(
            tokens.some((t) => t.type === "operator" && t.text === op),
            `Two-char operator "${op}" should be recognized`
        );
    }
});

void test("tokenizeGml recognizes punctuation", () => {
    const punctuation = [";", ",", "[", "]", "{", "}", "(", ")"];
    for (const p of punctuation) {
        const tokens = tokenizeGml(p);
        assert.ok(
            tokens.some((t) => t.type === "punctuation" && t.text === p),
            `Punctuation "${p}" should be recognized`
        );
    }
});

void test("tokenizeGml recognizes builtin constants", () => {
    const constants = ["true", "false", "undefined", "noone", "pointer_invalid", "pointer_null"];
    for (const c of constants) {
        const tokens = tokenizeGml(c);
        assert.equal(tokens.length, 1);
        assert.equal(tokens[0].type, "builtin-constant", `Constant "${c}" should be type "builtin-constant"`);
    }
});

void test("tokenizeGml classifies identifiers not followed by parenthesis as plain", () => {
    const tokens = tokenizeGml("variable_name");
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].type, "plain");
});

void test("tokenizeGml handles mixed content", () => {
    const source = 'if (x > 0) return "hello";';
    const tokens = tokenizeGml(source);
    assert.ok(tokens.length > 0);
    assert.ok(tokens.some((t) => t.type === "keyword" && t.text === "if"));
    assert.ok(tokens.some((t) => t.type === "operator" && t.text === ">"));
    assert.ok(tokens.some((t) => t.type === "number" && t.text === "0"));
    assert.ok(tokens.some((t) => t.type === "string" && t.text === '"hello"'));
    assert.ok(tokens.some((t) => t.type === "punctuation" && t.text === ";"));
});

void test("tokenizeGml handles empty string", () => {
    const tokens = tokenizeGml("");
    assert.equal(tokens.length, 0);
});

void test("tokenizeGml handles whitespace-only string", () => {
    const tokens = tokenizeGml("   \n\t  ");
    assert.ok(tokens.every((t) => t.type === "plain"));
});

void test("highlightGml produces HTML with token spans", () => {
    const html = highlightGml("function test() {}");
    assert.match(html, /<span class="gml-keyword">function<\/span>/);
    assert.match(html, /<span class="gml-function-name">test<\/span>/);
    assert.match(html, /<span class="gml-punctuation">\(<\/span>/);
    assert.match(html, /<span class="gml-punctuation">\)<\/span>/);
    assert.match(html, /<span class="gml-punctuation">\{<\/span>/);
    assert.match(html, /<span class="gml-punctuation">\}<\/span>/);
});

void test("highlightGml escapes HTML special characters", () => {
    const html = highlightGml("<script>");
    // Each character is its own token, so &lt; and &gt; appear in separate spans
    // but the full escaped string is preserved in the output
    assert.match(html, /<span class="gml-operator">&lt;<\/span>/);
    assert.match(html, /<span class="gml-plain">script<\/span>/);
    assert.match(html, /<span class="gml-operator">&gt;<\/span>/);
    assert.doesNotMatch(html, /<script>/);
    assert.doesNotMatch(html, /&lt;script&gt;/);
});

void test("highlightGml produces output for a GML function", () => {
    const gml = `function demo_inventory_total(playerName, inventory) {
    var total = 0;
    for (var i = 0; i < array_length(inventory); i++) {
        total += inventory[i];
    }
    return total;
}`;
    const html = highlightGml(gml);
    assert.match(html, /<span class="gml-keyword">function<\/span>/);
    assert.match(html, /<span class="gml-function-name">demo_inventory_total<\/span>/);
    assert.match(html, /<span class="gml-keyword">var<\/span>/);
    assert.match(html, /<span class="gml-keyword">for<\/span>/);
    assert.match(html, /<span class="gml-keyword">return<\/span>/);
    assert.match(html, /<span class="gml-number">0<\/span>/);
    assert.match(html, /<span class="gml-function-name">array_length<\/span>/);
});

void test("highlightGml handles strings with GML escape sequences", () => {
    // GML strings with escape sequences are preserved as-is
    // The highlighter only escapes HTML-unsafe characters (<, >, &)
    const html = highlightGml(String.raw`"hello \"world\""`);
    assert.match(html, /<span class="gml-string">.*<\/span>/);
    // The string content with escaped quotes is preserved (no HTML encoding needed for \")
    assert.match(html, /\\"world\\"/);
});

void test("highlightGml handles comments with special characters", () => {
    const html = highlightGml("// comment with <html> tags");
    assert.match(html, /<span class="gml-comment">\/\/ comment with &lt;html&gt; tags<\/span>/);
});

void test("tokenizeGml handles identifiers starting with $", () => {
    const tokens = tokenizeGml("$variable");
    assert.equal(tokens.length, 1);
    assert.equal(tokens[0].type, "plain");
    assert.equal(tokens[0].text, "$variable");
});
