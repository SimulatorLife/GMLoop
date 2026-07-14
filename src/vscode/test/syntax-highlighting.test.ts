import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const WORKSPACE_ROOT_URL = new URL("../../", import.meta.url);

void test("extension manifest registers and packages the GML TextMate grammar", async () => {
    const manifest = JSON.parse(await readFile(new URL("package.json", WORKSPACE_ROOT_URL), "utf8")) as {
        contributes: { grammars: Array<{ language: string; path: string; scopeName: string }> };
        files: string[];
    };

    assert.deepEqual(manifest.contributes.grammars, [
        { language: "gml", scopeName: "source.gml", path: "./syntaxes/gml.tmLanguage.json" }
    ]);
    assert.ok(manifest.files.includes("syntaxes"));
});

void test("GML TextMate grammar is valid and exposes the registered source scope", async () => {
    const grammar = JSON.parse(await readFile(new URL("syntaxes/gml.tmLanguage.json", WORKSPACE_ROOT_URL), "utf8")) as {
        fileTypes: string[];
        repository: Record<string, object>;
        scopeName: string;
    };

    assert.equal(grammar.scopeName, "source.gml");
    assert.deepEqual(grammar.fileTypes, ["gml"]);
    assert.deepEqual(Object.keys(grammar.repository).sort(), [
        "accessors",
        "comments",
        "constants",
        "constructorDeclarations",
        "directives",
        "enumDeclarations",
        "functionCalls",
        "functionDeclarations",
        "identifiers",
        "jsdoc",
        "keywords",
        "memberCalls",
        "numbers",
        "properties",
        "strings",
        "symbolOperators",
        "templateStrings",
        "variableDeclarations",
        "verbatimStrings",
        "wordOperators"
    ]);
});

void test("TextMate grammar scopes declarations, types, enums, macros, JSDoc, and Unicode identifiers", async () => {
    const grammarSource = await readFile(new URL("syntaxes/gml.tmLanguage.json", WORKSPACE_ROOT_URL), "utf8");
    for (const scope of [
        "variable.other.readwrite.gml",
        "variable.parameter.gml",
        "entity.name.type.gml",
        "entity.other.inherited-class.gml",
        "entity.name.enum.gml",
        "variable.other.enummember.gml",
        "entity.name.constant.gml",
        "entity.name.function.member.gml",
        "storage.type.class.jsdoc.gml"
    ]) {
        assert.ok(grammarSource.includes(scope), `TextMate grammar must include ${scope}`);
    }
    assert.match(grammarSource, /\\\\p\{L\}/u, "identifier patterns must preserve Unicode letters");
});

void test("TextMate grammar contains the shared JSON language inventory and scopes", async () => {
    const grammarSource = await readFile(new URL("syntaxes/gml.tmLanguage.json", WORKSPACE_ROOT_URL), "utf8");
    const sharedDefinition = JSON.parse(
        await readFile(new URL("../syntax-highlight/src/gml-language-definition.json", WORKSPACE_ROOT_URL), "utf8")
    ) as {
        builtinConstants: string[];
        directives: string[];
        keywords: string[];
        textMateScopes: Record<string, string>;
        wordOperators: string[];
    };

    for (const spelling of [
        ...sharedDefinition.builtinConstants,
        ...sharedDefinition.directives.map((directive) => directive.slice(1)),
        ...sharedDefinition.keywords,
        ...sharedDefinition.wordOperators
    ]) {
        assert.ok(grammarSource.includes(spelling), `TextMate grammar must include shared spelling ${spelling}`);
    }
    for (const scope of Object.values(sharedDefinition.textMateScopes)) {
        assert.ok(grammarSource.includes(scope), `TextMate grammar must include shared scope ${scope}`);
    }
});

void test("reserved syntax takes precedence over the generic function-call fallback", async () => {
    const grammar = JSON.parse(await readFile(new URL("syntaxes/gml.tmLanguage.json", WORKSPACE_ROOT_URL), "utf8")) as {
        patterns: Array<{ include: string }>;
        repository: Record<string, { patterns: Array<{ match: string; name?: string }> }>;
    };
    const topLevelIncludes = grammar.patterns.map(({ include }) => include);
    const functionCallIndex = topLevelIncludes.indexOf("#functionCalls");

    for (const reservedGroup of ["#keywords", "#constants", "#wordOperators"]) {
        assert.ok(
            topLevelIncludes.indexOf(reservedGroup) < functionCallIndex,
            `${reservedGroup} must be matched before generic function calls`
        );
    }

    const keywordRule = grammar.repository.keywords.patterns[0];
    assert.equal(keywordRule?.name, "keyword.control.flow.gml");
    assert.equal(grammar.repository.keywords.patterns[1]?.name, "keyword.control.gml");
    const keywordPattern = new RegExp(keywordRule?.match ?? "", "u");
    const functionCallPattern = new RegExp(grammar.repository.functionCalls.patterns[0]?.match ?? "", "u");
    for (const keyword of ["if", "else", "for", "while", "repeat", "switch", "with"]) {
        assert.match(keyword, keywordPattern);
    }
    for (const keyword of ["if", "for", "while", "repeat", "switch", "with"]) {
        const sourceText = `${keyword} (condition)`;
        assert.doesNotMatch(sourceText, functionCallPattern, `${keyword} must not match the generic-call pattern`);
    }
    assert.doesNotMatch("play_sound(condition)", keywordPattern);
    assert.match("play_sound(condition)", functionCallPattern);
});

void test("VSIX staging includes the TextMate grammar", async () => {
    const packagingSource = await readFile(new URL("src/build-vsix-package.ts", WORKSPACE_ROOT_URL), "utf8");
    assert.match(packagingSource, /syntaxes\/gml\.tmLanguage\.json/u);
    assert.match(packagingSource, /stageSyntaxRoot/u);
});

void test("language configuration covers GML accessors, regions, strings, and indentation", async () => {
    const configuration = JSON.parse(
        await readFile(new URL("language-configuration.json", WORKSPACE_ROOT_URL), "utf8")
    ) as {
        autoClosingPairs: Array<{ open: string }>;
        brackets: string[][];
        folding: { markers: { end: string; start: string } };
        indentationRules: object;
        onEnterRules: object[];
        wordPattern: { pattern: string };
    };

    for (const accessor of ["[|", "[?", "[#", "[@", "[$"]) {
        assert.ok(configuration.brackets.some(([open]) => open === accessor));
    }
    for (const stringPrefix of ['$"', '@"', "@'"]) {
        assert.ok(configuration.autoClosingPairs.some(({ open }) => open === stringPrefix));
    }
    assert.match(configuration.folding.markers.start, /#region/u);
    assert.match(configuration.folding.markers.end, /#endregion/u);
    assert.ok(configuration.wordPattern.pattern.length > 0);
    assert.ok(Object.keys(configuration.indentationRules).length > 0);
    assert.ok(configuration.onEnterRules.length > 0);
});
