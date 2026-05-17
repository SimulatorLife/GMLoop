import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { test } from "node:test";
import { promisify } from "node:util";

import * as LintWorkspace from "@gmloop/lint";
import { ESLint, type Linter } from "eslint";

import { assertEquals } from "../assertions.js";

const { Lint } = LintWorkspace;

type ParseSuccess = {
    ok: true;
    ast: {
        comments?: Array<{ range?: [number, number] }>;
        tokens?: Array<{ range?: [number, number] }>;
        body?: Array<{ arguments?: Array<{ range?: [number, number] }> }>;
    };
    parserServices: {
        gml: {
            filePath: string;
            recovery: Array<{ kind: string; originalOffset: number }>;
            directives: Array<string>;
            enums: Array<string>;
        };
    };
};

type ParseFailure = {
    ok: false;
    errors: ReadonlyArray<{ message: string; line: number; column: number }>;
};

const execFileAsync = promisify(execFile);

function parseWithOptions(sourceText: string, recovery: "none" | "limited"): ParseSuccess | ParseFailure {
    const language = Lint.plugin.languages.gml as {
        parse: (
            file: { body: string; path: string },
            context: { languageOptions: { recovery: "none" | "limited" } }
        ) => ParseSuccess | ParseFailure;
    };

    return language.parse(
        {
            body: sourceText,
            path: "./test.gml"
        },
        {
            languageOptions: { recovery }
        }
    );
}

function collectTypedNodesMissingLocationMetadata(root: unknown): Array<string> {
    const missingTypes: Array<string> = [];
    const seen = new Set<object>();
    const pending: Array<unknown> = [root];

    while (pending.length > 0) {
        const current = pending.pop();
        if (!current || typeof current !== "object") {
            continue;
        }

        if (seen.has(current)) {
            continue;
        }
        seen.add(current);

        if (Array.isArray(current)) {
            for (const entry of current) {
                pending.push(entry);
            }
            continue;
        }

        const record = current as Record<string, unknown>;
        if (typeof record.type === "string") {
            const hasLoc =
                record.loc &&
                typeof record.loc === "object" &&
                (record.loc as { start?: { line?: unknown } }).start &&
                typeof (record.loc as { start: { line?: unknown } }).start.line === "number";
            const hasRange =
                Array.isArray(record.range) &&
                record.range.length === 2 &&
                typeof record.range[0] === "number" &&
                typeof record.range[1] === "number";
            if (!hasLoc || !hasRange) {
                missingTypes.push(record.type);
            }
        }

        for (const value of Object.values(record)) {
            pending.push(value);
        }
    }

    return missingTypes;
}

async function lintTextWithESLintVersion(ESLintImplementation: typeof ESLint, sourceText: string) {
    return lintTextWithConfiguredRules(
        ESLintImplementation,
        sourceText,
        {
            "gml/no-globalvar": "off"
        },
        false
    );
}

async function lintTextWithConfiguredRules(
    ESLintImplementation: typeof ESLint,
    sourceText: string,
    rules: Linter.RulesRecord,
    fix: boolean,
    languageOptions?: { recovery: "none" | "limited" }
) {
    const normalizedLanguageOptions = languageOptions ?? { recovery: "none" };

    const eslint = new ESLintImplementation({
        overrideConfigFile: true,
        fix,
        overrideConfig: [
            {
                files: ["**/*.gml"],
                plugins: {
                    gml: Lint.plugin
                },
                language: "gml/gml",
                languageOptions: normalizedLanguageOptions,
                rules
            }
        ]
    });

    const [result] = await eslint.lintText(sourceText, {
        filePath: "contract-target.gml"
    });

    return result;
}

async function runVersionCompatibilityProbe(packageName: string): Promise<void> {
    const languageProbe = `
        import { ESLint } from "${packageName}";
        import { plugin } from "./src/plugin.js";

        const eslint = new ESLint({
            overrideConfigFile: true,
            overrideConfig: [{
                files: ["**/*.gml"],
                plugins: { gml: plugin },
                language: "gml/gml",
                rules: { "gml/no-globalvar": "off" }
            }]
        });

        const [result] = await eslint.lintText("var x = 1;", { filePath: "contract-target.gml" });
        if (result.fatalErrorCount !== 0) {
            throw new Error("Compatibility probe failed.");
        }
    `;

    const probeCwdCandidates = [
        new URL("../", import.meta.url),
        new URL("../../", import.meta.url),
        new URL("../../../", import.meta.url)
    ];
    const probeCwd = probeCwdCandidates.find((candidate) => {
        try {
            const pluginPath = new URL("src/plugin.js", candidate);
            return existsSync(pluginPath);
        } catch {
            return false;
        }
    });
    if (!probeCwd) {
        throw new Error("Unable to resolve compatibility probe cwd");
    }

    await execFileAsync("node", ["--input-type=module", "-e", languageProbe], {
        cwd: probeCwd
    });
}

void test("language object pins ESLint v9 language behavior fields", () => {
    const language = Lint.plugin.languages.gml as Record<string, unknown>;

    assertEquals(language.fileType, "text");
    assertEquals(language.lineStart, 1);
    assertEquals(language.columnStart, 0);
    assertEquals(language.nodeTypeKey, "type");
    assert.deepEqual(language.defaultLanguageOptions, { recovery: "none" });
    assert.deepEqual(language.visitorKeys, {});
});

void test("language parse returns ESLint v9 parse channel with ok discriminator", () => {
    const result = parseWithOptions("var x = 1;", "limited");
    assertEquals(result.ok, true);
});

void test("language parse projects loc/range metadata for try/catch branches", () => {
    const source = [
        "function test_projection() {",
        "    try {",
        "        values = [1, 2, 3];",
        "    } catch (error) {",
        "        values = [0, 0, 0];",
        "    }",
        "    return values[0];",
        "}",
        ""
    ].join("\n");
    const parseResult = parseWithOptions(source, "limited");
    assertEquals(parseResult.ok, true);

    if (!parseResult.ok) {
        return;
    }

    const missingTypes = collectTypedNodesMissingLocationMetadata(parseResult.ast);
    assert.deepEqual(missingTypes, []);
});

void test("language parse failure returns ESLint parse-failure channel", () => {
    const parseResult = parseWithOptions("if (", "limited");

    assertEquals(parseResult.ok, false);
    if (parseResult.ok) {
        return;
    }

    const parseFailure = parseResult as ParseFailure;
    assertEquals(parseFailure.errors.length, 1);
    assertEquals(typeof parseFailure.errors[0]?.message, "string");
    assertEquals(typeof parseFailure.errors[0]?.line, "number");
    assertEquals(typeof parseFailure.errors[0]?.column, "number");
});

void test("language hooks run successfully on latest ESLint version", async () => {
    const result = await lintTextWithESLintVersion(ESLint, "var x = 1;");
    assertEquals(result.fatalErrorCount, 0);
    await runVersionCompatibilityProbe("eslint");
});

void test("strict parse fails while limited recovery succeeds for missing argument separators", () => {
    const strictResult = parseWithOptions("show_debug_message(1 2);", "none");
    assertEquals(strictResult.ok, false);

    const limitedResult = parseWithOptions("show_debug_message(1 2);", "limited");
    assertEquals(limitedResult.ok, true);

    if (!limitedResult.ok) {
        assert.fail("Expected limited recovery parse success.");
    }

    assertEquals(limitedResult.parserServices.gml.recovery.length, 1);
    assertEquals(limitedResult.parserServices.gml.recovery[0]?.kind, "inserted-argument-separator");

    const recoveredArgumentRange = limitedResult.ast.body?.[0]?.arguments?.[1]?.range;
    assert.deepEqual(recoveredArgumentRange, [21, 22]);
});

void test("strict parse fails while limited recovery succeeds for scientific notation literals", () => {
    const source = "var epsilon = 1e-11;";
    const strictResult = parseWithOptions(source, "none");
    assertEquals(strictResult.ok, false);

    const limitedResult = parseWithOptions(source, "limited");
    assertEquals(limitedResult.ok, true);

    if (!limitedResult.ok) {
        assert.fail("Expected limited recovery parse success.");
    }

    // Scientific-notation recovery is parser-local and range-preserving, so no
    // inserted separator metadata should be produced.
    assert.deepEqual(limitedResult.parserServices.gml.recovery, []);
});

void test("limited recovery projects malformed single-slash doc tags into parse-safe comment lines", () => {
    const source = "function foo(argument0) {\n    / @param argument0 payload\n    return argument0;\n}\n";

    const strictResult = parseWithOptions(source, "none");
    assertEquals(strictResult.ok, false);

    const limitedResult = parseWithOptions(source, "limited");
    assertEquals(limitedResult.ok, true);

    if (!limitedResult.ok) {
        assert.fail("Expected limited recovery parse success.");
    }

    assert.deepEqual(limitedResult.parserServices.gml.recovery, []);
});

void test("limited recovery lowercases uppercase logical aliases only for parsing", () => {
    const source = "if (ready AND NOT done OR extra XOR flag) {\n    finish();\n}\n";

    const strictResult = parseWithOptions(source, "none");
    assertEquals(strictResult.ok, false);

    const limitedResult = parseWithOptions(source, "limited");
    assertEquals(limitedResult.ok, true);

    if (!limitedResult.ok) {
        assert.fail("Expected limited recovery parse success.");
    }

    assert.deepEqual(limitedResult.parserServices.gml.recovery, []);
});

void test("limited recovery succeeds for compound assignments inside control conditions", () => {
    const source = "if (counter += 1) keep2();\n";

    const strictResult = parseWithOptions(source, "none");
    assertEquals(strictResult.ok, false);

    const limitedResult = parseWithOptions(source, "limited");
    assertEquals(limitedResult.ok, true);

    if (!limitedResult.ok) {
        assert.fail("Expected limited recovery parse success.");
    }

    assert.deepEqual(limitedResult.parserServices.gml.recovery, []);
});

void test("limited recovery wraps bare string literals before .length member access", () => {
    const source = 'return "my string".length;\n';

    const strictResult = parseWithOptions(source, "none");
    assertEquals(strictResult.ok, false);

    const limitedResult = parseWithOptions(source, "limited");
    assertEquals(limitedResult.ok, true);

    if (!limitedResult.ok) {
        assert.fail("Expected limited recovery parse success.");
    }

    assert.deepEqual(limitedResult.parserServices.gml.recovery, []);
});

void test("limited recovery comments out orphan assignment statements for malformed-safe rule passes", () => {
    const source = "origin = new Point(0, 0);\n\n= 10;\n";

    const strictResult = parseWithOptions(source, "none");
    assertEquals(strictResult.ok, false);

    const limitedResult = parseWithOptions(source, "limited");
    assertEquals(limitedResult.ok, true);

    if (!limitedResult.ok) {
        assert.fail("Expected limited recovery parse success.");
    }

    assert.deepEqual(limitedResult.parserServices.gml.recovery, []);
});

void test("limited recovery comments out malformed _this multiplication statements for malformed-safe rule passes", () => {
    const source = "_this * something;\n";

    const strictResult = parseWithOptions(source, "none");
    assertEquals(strictResult.ok, false);

    const limitedResult = parseWithOptions(source, "limited");
    assertEquals(limitedResult.ok, true);

    if (!limitedResult.ok) {
        assert.fail("Expected limited recovery parse success.");
    }

    assert.deepEqual(limitedResult.parserServices.gml.recovery, []);
});

void test("limited recovery replaces malformed numeric assignment statements with no-op statements", () => {
    const source = "123 = value;\n";

    const strictResult = parseWithOptions(source, "none");
    assertEquals(strictResult.ok, false);

    const limitedResult = parseWithOptions(source, "limited");
    assertEquals(limitedResult.ok, true);

    if (!limitedResult.ok) {
        assert.fail("Expected limited recovery parse success.");
    }

    assert.deepEqual(limitedResult.parserServices.gml.recovery, []);
});

void test("limited recovery appends missing closing braces at end of file", () => {
    const source = [
        "function func_args()",
        "{",
        "",
        "",
        "var _first_parameter = argument[0];",
        'show_debug_message($"The first parameter is {_first_parameter}");',
        "return _first_parameter;"
    ].join("\n");

    const strictResult = parseWithOptions(source, "none");
    assertEquals(strictResult.ok, false);

    const limitedResult = parseWithOptions(source, "limited");
    assertEquals(limitedResult.ok, true);

    if (!limitedResult.ok) {
        assert.fail("Expected limited recovery parse success.");
    }

    assert.deepEqual(limitedResult.parserServices.gml.recovery, []);
});

void test("switch cases expose estree consequent arrays for ESLint code-path analysis", async () => {
    const source = [
        "switch (state) {",
        "    case 0:",
        "        value = 1;",
        "        break;",
        "    default:",
        "        break;",
        "}"
    ].join("\n");
    const result = await lintTextWithESLintVersion(ESLint, source);

    assertEquals(result.fatalErrorCount, 0);
    assertEquals(
        result.messages.some((message) => message.fatal),
        false
    );

    const parseResult = parseWithOptions(source, "limited");
    assertEquals(parseResult.ok, true);
    if (!parseResult.ok) {
        return;
    }

    const firstStatement = parseResult.ast.body?.[0] as { cases?: Array<{ consequent?: unknown[]; body?: unknown[] }> };
    const firstCase = firstStatement.cases?.[0];

    assert.ok(Array.isArray(firstCase?.consequent));
    assert.ok(Array.isArray(firstCase?.body));
});

void test("switch blocks ignore non-case directives in cases array for ESLint compatibility", async () => {
    const source = [
        "switch (state) {",
        "    #region parser-state",
        "    case 0:",
        "        value = 1;",
        "        break;",
        "}"
    ].join("\n");

    const result = await lintTextWithESLintVersion(ESLint, source);
    assertEquals(result.fatalErrorCount, 0);

    const parseResult = parseWithOptions(source, "limited");
    assertEquals(parseResult.ok, true);
    if (!parseResult.ok) {
        return;
    }

    const firstStatement = parseResult.ast.body?.[0] as { cases?: Array<{ type?: string }> };
    const caseTypes = (firstStatement.cases ?? []).map((entry) => entry.type);
    assert.deepEqual(caseTypes, ["SwitchCase"]);
});

void test("limited recovery preserves projected substring invariants for argument ranges", () => {
    const source = "show_debug_message(10 20);";
    const result = parseWithOptions(source, "limited");
    assertEquals(result.ok, true);

    if (!result.ok) {
        assert.fail("Expected limited recovery parse success.");
    }

    const secondArgumentRange = result.ast.body?.[0]?.arguments?.[1]?.range;
    assert.ok(Array.isArray(secondArgumentRange));

    const [start, end] = secondArgumentRange;
    assertEquals(source.slice(start, end), "20");
    assertEquals(result.parserServices.gml.recovery[0]?.originalOffset, 21);
});

void test("limited recovery inserts exactly one separator across block-comment payload gaps", () => {
    const source = "show_debug_message_ext(name /* keep */ payload);\n";

    const strictResult = parseWithOptions(source, "none");
    assertEquals(strictResult.ok, false);

    const limitedResult = parseWithOptions(source, "limited");
    assertEquals(limitedResult.ok, true);

    if (!limitedResult.ok) {
        assert.fail("Expected limited recovery parse success.");
    }

    assertEquals(limitedResult.parserServices.gml.recovery.length, 1);
    assertEquals(limitedResult.parserServices.gml.recovery[0]?.originalOffset, source.indexOf(" /* keep */"));
});

void test("require-argument-separators ignores macros, declarations, comments, and strings", async () => {
    const source = [
        "#macro STILE_PLATFORM_HEIGHT 120",
        "function scribble_rgb_to_bgr(_rgb) {",
        "    // (the industry standard)",
        '    var label = "Colour values should be in the format (RGB)."',
        "    return _rgb;",
        "}",
        "function scribble_color_set(_name, _colour) {",
        "    show_debug_message(_name);",
        "}"
    ].join("\n");

    const result = await lintTextWithConfiguredRules(
        ESLint,
        source,
        {
            "gml/no-globalvar": "off",
            "gml/require-argument-separators": "error"
        },
        false
    );

    assertEquals(result.fatalErrorCount, 0);
    assertEquals(result.errorCount, 0);
});

void test("require-argument-separators reports precise location and fixes comment payload gaps", async () => {
    const source = "show_debug_message_ext(name /* keep */ payload);\n";
    const expectedColumn = source.indexOf(" /* keep */") + 1;

    const diagnosticResult = await lintTextWithConfiguredRules(
        ESLint,
        source,
        {
            "gml/no-globalvar": "off",
            "gml/require-argument-separators": "error"
        },
        false,
        { recovery: "limited" }
    );

    assertEquals(diagnosticResult.fatalErrorCount, 0);
    assertEquals(diagnosticResult.messages.length, 1);
    assertEquals(diagnosticResult.messages[0]?.line, 1);
    assertEquals(diagnosticResult.messages[0]?.column, expectedColumn);

    const fixedResult = await lintTextWithConfiguredRules(
        ESLint,
        source,
        {
            "gml/no-globalvar": "off",
            "gml/require-argument-separators": "error"
        },
        true,
        { recovery: "limited" }
    );
    assertEquals(fixedResult.output, "show_debug_message_ext(name, /* keep */ payload);\n");
});

void test("require-control-flow-braces reports else-if chain bodies without autofixing", async () => {
    const source = ["if (x) {", "    a();", "}", "else if (_prev_char == 0x093C) ", "    b();", ""].join("\n");

    const result = await lintTextWithConfiguredRules(
        ESLint,
        source,
        {
            "gml/no-globalvar": "off",
            "gml/require-control-flow-braces": "error"
        },
        true
    );

    assertEquals(result.fatalErrorCount, 0);
    assertEquals(result.errorCount, 1);
    assertEquals(result.output ?? source, source);
});

void test("optimize-math-expressions fix pipeline converges without parenthesis oscillation", async () => {
    const source = [
        "if (global.disableDraw) {",
        "    exit;",
        "}",
        "var angle = (((current_time / 300) + x) + y) + z;",
        "var x1 = x - ((radius / 10) * cos(angle));",
        "var y1 = y - ((radius / 10) * sin(angle));",
        "var z1 = z;",
        "var x2 = x + ((radius / 10) * cos(angle));",
        "var y2 = y + ((radius / 10) * sin(angle));",
        "var z2 = z;",
        "cm_debug_draw(cm_cylinder(x1, y1, z1, x2, y2, z2, radius), -1, c_yellow);",
        ""
    ].join("\n");
    const rules: Linter.RulesRecord = {
        "gml/no-globalvar": "off",
        "gml/optimize-math-expressions": "warn"
    };

    const firstPass = await lintTextWithConfiguredRules(ESLint, source, rules, true);
    const stabilizedOutput = typeof firstPass.output === "string" ? firstPass.output : source;
    const secondPass = await lintTextWithConfiguredRules(ESLint, stabilizedOutput, rules, false);

    assertEquals(secondPass.fatalErrorCount, 0);
    assertEquals(secondPass.messages.length, 0);
});

void test("loop-hoist and math optimizations converge without duplicate cached constants", async () => {
    const source = [
        "for (var i = 0; i < 3; i++) {",
        '    var mbuff = load_obj_to_buffer($"Models/Crystal{i + 1}.obj");',
        "    var bytesPerVert = 9 * 4;",
        "    var bytesPerTri = 3 * bytesPerVert;",
        "    var triNum = buffer_get_size(mbuff) / bytesPerTri;",
        "    buffer_seek(mbuff, buffer_seek_start, 0);",
        "    repeat (triNum) {",
        "        buffer_seek(mbuff, buffer_seek_relative, 8 * 4);",
        "        buffer_write(mbuff, buffer_u8, 255);",
        "        buffer_seek(mbuff, buffer_seek_relative, 8 * 4);",
        "        buffer_write(mbuff, buffer_u8, 0);",
        "        buffer_seek(mbuff, buffer_seek_relative, 8 * 4);",
        "        buffer_write(mbuff, buffer_u8, 255);",
        "    }",
        "}",
        ""
    ].join("\n");
    const expected = [
        "var cached_value = 36;",
        "for (var i = 0; i < 3; i++) {",
        '    var mbuff = load_obj_to_buffer($"Models/Crystal{i + 1}.obj");',
        "    var bytesPerVert = cached_value;",
        "    var bytesPerTri = 3 * bytesPerVert;",
        "    var triNum = buffer_get_size(mbuff) / bytesPerTri;",
        "    buffer_seek(mbuff, buffer_seek_start, 0);",
        "    var cached_value_1 = 32;",
        "    repeat (triNum) {",
        "        buffer_seek(mbuff, buffer_seek_relative, cached_value_1);",
        "        buffer_write(mbuff, buffer_u8, 255);",
        "        buffer_seek(mbuff, buffer_seek_relative, cached_value_1);",
        "        buffer_write(mbuff, buffer_u8, 0);",
        "        buffer_seek(mbuff, buffer_seek_relative, cached_value_1);",
        "        buffer_write(mbuff, buffer_u8, 255);",
        "    }",
        "}",
        ""
    ].join("\n");
    const rules: Linter.RulesRecord = {
        "gml/no-globalvar": "off",
        "gml/prefer-loop-invariant-expressions": "error",
        "gml/optimize-math-expressions": "error"
    };

    const firstPass = await lintTextWithConfiguredRules(ESLint, source, rules, true);
    const stabilizedOutput = typeof firstPass.output === "string" ? firstPass.output : source;
    const secondPass = await lintTextWithConfiguredRules(ESLint, stabilizedOutput, rules, false);

    assertEquals(stabilizedOutput, expected);
    assertEquals(secondPass.fatalErrorCount, 0);
    assertEquals(secondPass.messages.length, 0);
    assertEquals(stabilizedOutput.includes("var cached_value_2 = 32;"), false);
    assertEquals(stabilizedOutput.includes("var cached_value_3 = 32;"), false);
});

void test("parser services contract always shapes canonical path, directives, enums, and recovery", () => {
    const result = parseWithOptions("var x = 1;", "limited");
    assertEquals(result.ok, true);

    if (!result.ok) {
        assert.fail("Expected parse success.");
    }

    assertEquals(typeof result.parserServices.gml.filePath, "string");
    assert.ok(result.parserServices.gml.filePath.endsWith("test.gml"));
    assert.deepEqual(result.parserServices.gml.directives, []);
    assert.deepEqual(result.parserServices.gml.enums, []);
    assert.deepEqual(result.parserServices.gml.recovery, []);
});

void test("utf-16 range projection stays aligned after limited recovery", () => {
    const source = 'show_debug_message("😀" 2);';
    const result = parseWithOptions(source, "limited");
    assertEquals(result.ok, true);

    if (!result.ok) {
        assert.fail("Expected parse success.");
    }

    const firstArgumentRange = result.ast.body?.[0]?.arguments?.[0]?.range;
    assert.deepEqual(firstArgumentRange, [19, 23]);
    assertEquals(source.slice(19, 23), '"😀"');

    const secondArgumentRange = result.ast.body?.[0]?.arguments?.[1]?.range;
    assert.deepEqual(secondArgumentRange, [24, 25]);
    assertEquals(source.slice(24, 25), "2");
});

void test("location projection maps CRLF boundaries without line/column drift", () => {
    const source = "show_debug_message(1);\r\nshow_debug_message(2);\r\n";
    const result = parseWithOptions(source, "limited");
    assertEquals(result.ok, true);

    if (!result.ok) {
        assert.fail("Expected parse success.");
    }

    const secondStatement = result.ast.body?.[1] as
        | { loc?: { start?: { line?: number; column?: number } } }
        | undefined;
    assertEquals(secondStatement?.loc?.start?.line, 2);
    assertEquals(secondStatement?.loc?.start?.column, 0);
});

void test("tokenization source remains original source under limited recovery", () => {
    const source = "show_debug_message(1 2); // tail";
    const result = parseWithOptions(source, "limited");
    assertEquals(result.ok, true);

    if (!result.ok) {
        assert.fail("Expected parse success.");
    }

    for (const token of result.ast.tokens ?? []) {
        if (!Array.isArray(token.range)) {
            continue;
        }

        const [start, end] = token.range;
        assert.ok(start >= 0);
        assert.ok(end <= source.length);
        assert.ok(start <= end);
    }

    for (const comment of result.ast.comments ?? []) {
        if (!Array.isArray(comment.range)) {
            continue;
        }

        const [start, end] = comment.range;
        assertEquals(source.slice(start, end).startsWith("//"), true);
    }
});
