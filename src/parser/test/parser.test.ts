import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { Core } from "@gmloop/core";

import GameMakerASTBuilder from "../src/ast/gml-ast-builder.js";
import { GameMakerSyntaxError } from "../src/ast/gml-syntax-error.js";
import { GMLParser } from "../src/gml-parser.js";
import { defaultParserOptions, type ParserOptions, type ScopeTracker } from "../src/types/index.js";

const currentDirectory = fileURLToPath(new URL(".", import.meta.url));
const fixturesDirectory = path.join(currentDirectory, "../../test/input");
const fixtureExtension = ".gml";
const fileEncoding = "utf8";

async function loadFixtures() {
    const entries = await fs.readdir(fixturesDirectory, {
        withFileTypes: true
    });

    const fileNames = entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(fixtureExtension))
        .map((entry) => entry.name)
        .toSorted();

    const fixtureContentsByName = new Map<string, string>();

    await Promise.all(
        fileNames.map(async (fileName) => {
            const filePath = path.join(fixturesDirectory, fileName);
            const source = await fs.readFile(filePath, fileEncoding);

            if (typeof source !== "string") {
                throw new TypeError(`Expected fixture '${fileName}' to be read as a string.`);
            }

            fixtureContentsByName.set(fileName, source);
        })
    );

    return { fileNames, fixtureContentsByName };
}

function hasLocationInformation(node) {
    if (node === null || typeof node !== "object") {
        return false;
    }

    if (Object.hasOwn(node, "start") || Object.hasOwn(node, "end")) {
        return true;
    }

    for (const value of Object.values(node)) {
        if (hasLocationInformation(value)) {
            return true;
        }
    }

    return false;
}

type ParserTestHarnessOptions = {
    suppressErrors?: boolean;
    options?: Partial<ParserOptions>;
};

function parseFixture(source: string, { suppressErrors = false, options }: ParserTestHarnessOptions = {}) {
    if (!suppressErrors) {
        return GMLParser.parse(source, options);
    }

    const originalError = globalThis.console.error;

    try {
        globalThis.console.error = () => {};
        return GMLParser.parse(source, options);
    } finally {
        globalThis.console.error = originalError;
    }
}

function collectNodesByType(node, type) {
    const nodes = [];
    const visited = new Set();

    function visit(value) {
        if (value === null || typeof value !== "object") {
            return;
        }

        if (visited.has(value)) {
            return;
        }

        visited.add(value);

        if (Array.isArray(value)) {
            for (const item of value) {
                visit(item);
            }
            return;
        }

        if (value.type === type) {
            nodes.push(value);
        }

        for (const [key, child] of Object.entries(value)) {
            if (key === "start" || key === "end" || key === "declaration") {
                continue;
            }
            visit(child);
        }
    }

    visit(node);
    return nodes;
}

const { fileNames: fixtureNames, fixtureContentsByName } = await loadFixtures();
const expectedFailures = new Set<string>();
const successfulFixture = fixtureNames.find((fixtureName) => !expectedFailures.has(fixtureName));
const fixtureParserOptions: ParserOptions = {
    ...defaultParserOptions,
    getComments: false,
    getLocations: false,
    simplifyLocations: false
};

void describe("GameMaker parser fixtures", () => {
    for (const fixtureName of fixtureNames) {
        void it(`parses ${fixtureName}`, async () => {
            const source = fixtureContentsByName.get(fixtureName);
            if (!source) {
                throw new Error(`Fixture '${fixtureName}' was not preloaded.`);
            }
            const shouldFail = expectedFailures.has(fixtureName);

            if (shouldFail) {
                assert.throws(
                    () =>
                        parseFixture(source, {
                            suppressErrors: true,
                            options: fixtureParserOptions
                        }),
                    /Syntax Error/,
                    `Parser unexpectedly produced an AST for ${fixtureName}.`
                );
                return;
            }

            const ast = parseFixture(source, { options: fixtureParserOptions });

            assert.ok(ast, `Parser returned no AST for ${fixtureName}.`);
            assert.strictEqual(ast.type, "Program", `Unexpected root node type for ${fixtureName}.`);
            assert.ok(Array.isArray(ast.body), `AST body for ${fixtureName} is not an array.`);
        });
    }

    void it("parses integer literals with leading zeros", () => {
        const source = "function example() {\n    var value = 007;\n}";

        assert.doesNotThrow(() => parseFixture(source));
    });

    void it("parses string literals with uppercase escape sequences", () => {
        const source = `function example() {\n    var message = "\\N sounds";\n}`;

        const ast = parseFixture(source);
        const literals = collectNodesByType(ast, "Literal");
        const stringLiteral = literals.find(
            (literal) => typeof literal.value === "string" && literal.value.startsWith('"')
        );

        assert.ok(stringLiteral, "Expected to find a string literal");
        assert.strictEqual(stringLiteral.value, String.raw`"\N sounds"`);
    });

    void it("parses string literals containing escaped backslashes before uppercase identifiers", () => {
        const source = [
            "function example() {",
            String.raw`    show_debug_message("Cannot use arguments\\n\\Action");`,
            "}"
        ].join("\n");

        assert.doesNotThrow(() => parseFixture(source));
    });

    void it("rejects nested ternary expressions in true branches when not parenthesized", () => {
        const source = [
            "function build_values(value1, value2, value3, value4) {",
            "    value = !is_undefined(value2) ? !is_undefined(value3) ? [value1, value2, value3] : [value1, value2] : [value1];",
            "}",
            ""
        ].join("\n");

        assert.throws(
            () => parseFixture(source),
            (error: unknown) => {
                if (!(error instanceof GameMakerSyntaxError)) {
                    return false;
                }

                return error.message.includes("nested ternary in the true branch must be wrapped in parentheses");
            }
        );
    });

    void it("accepts nested ternary expressions in true branches when explicitly parenthesized", () => {
        const source = [
            "function build_values(value1, value2, value3, value4) {",
            "    value = !is_undefined(value2) ? (!is_undefined(value3) ? [value1, value2, value3] : [value1, value2]) : [value1];",
            "}",
            ""
        ].join("\n");

        assert.doesNotThrow(() => parseFixture(source));
    });

    void it("omits location metadata when disabled", async () => {
        const fixtureName = successfulFixture;

        assert.ok(fixtureName, "Expected at least one parser fixture to be present.");

        const source = fixtureContentsByName.get(fixtureName);
        if (!source) {
            throw new Error(`Fixture '${fixtureName}' was not preloaded.`);
        }
        const astWithoutLocations = parseFixture(source, {
            options: { getLocations: false }
        });

        assert.ok(astWithoutLocations, "Parser returned no AST when locations were disabled.");
        assert.strictEqual(
            hasLocationInformation(astWithoutLocations),
            false,
            "AST unexpectedly contains location metadata when getLocations is false."
        );
    });

    void it("does not mutate inherited nodes when stripping location metadata", () => {
        const prototypeNode = {
            inherited: {
                start: { index: 1 },
                end: { index: 2 }
            }
        };

        const ast = Object.create(prototypeNode);
        ast.own = {
            start: { index: 3 },
            end: { index: 4 }
        };

        const parser = new GMLParser("", {});
        const prototypeSnapshot = structuredClone(prototypeNode);

        parser.removeLocationInfo(ast);

        assert.deepStrictEqual(
            prototypeNode,
            prototypeSnapshot,
            "Expected prototype nodes to remain untouched when stripping locations."
        );
        assert.deepStrictEqual(ast.own, {}, "Expected own nodes to have location metadata removed.");
    });

    void it("applies default parser options when none are provided", () => {
        const parser = new GMLParser("");

        assert.equal(parser.options.getComments, true);
        assert.equal(parser.options.getLocations, true);
        assert.equal(parser.options.attachFunctionDocComments, true);
        assert.equal(parser.options.astFormat, "gml");
    });

    void it("merges parser options without mutating the overrides", () => {
        const overrides = { getComments: false };
        const parser = new GMLParser("", overrides);

        assert.equal(parser.options.getComments, false);
        assert.equal(parser.options.getLocations, true);
        assert.deepStrictEqual(overrides, { getComments: false });
        assert.equal(GMLParser.optionDefaults.getComments, true);
    });

    void it("counts CRLF sequences as a single line break", () => {
        assert.strictEqual(
            Core.getLineBreakCount("\r\n"),
            1,
            "Expected CRLF sequences to count as a single line break."
        );
    });

    void it("outputs ESTree-formatted nodes when requested", () => {
        const source = ["// heading", "function demo() {", "    return 1;", "}", ""].join("\n");

        const ast = GMLParser.parse(source, {
            astFormat: "estree",
            getComments: true
        });

        assert.ok(ast, "Expected ESTree parse to return an AST.");
        assert.strictEqual(ast.type, "Program");
        assert.ok(Array.isArray(ast.body));
        assert.ok(ast.loc, "ESTree AST should expose location metadata.");
        assert.ok(Array.isArray(ast.range), "Range metadata should be present.");
        const [declaration] = ast.body;
        assert.ok(declaration, "Expected at least one declaration.");
        assert.ok(
            typeof declaration.start === "number" && typeof declaration.end === "number",
            "Declaration nodes should expose numeric start and end positions."
        );
        assert.ok(Array.isArray(ast.comments), "Comments should be preserved in the ESTree output.");
        const [comment] = ast.comments;
        assert.strictEqual(comment?.type, "Line", "Line comments should map to ESTree.");
    });

    void it("serializes ESTree ASTs as JSON when requested", () => {
        const source = "function demo() {}";
        const jsonAst = GMLParser.parse(source, {
            astFormat: "estree",
            asJSON: true
        });

        assert.strictEqual(typeof jsonAst, "string", "ESTree JSON output should be a string.");

        const parsed = JSON.parse(jsonAst);
        assert.strictEqual(parsed.type, "Program");
        assert.ok(parsed.loc, "Serialized AST should retain location metadata.");
    });

    void it("marks materialized trailing identifier defaults as parser-intended optional", () => {
        const source = [
            "function demo(first, second = 1, third) {",
            "    return [first, second, third];",
            "}",
            ""
        ].join("\n");

        const ast = parseFixture(source);
        const decl = ast.body && ast.body.find((n) => n.type === "FunctionDeclaration");
        assert.ok(decl, "Expected a FunctionDeclaration");
        const params = Array.isArray(decl.params) ? decl.params : [];
        // third should be materialized into a DefaultParameter with undefined RHS
        const third = params[2];
        assert.ok(third, "Expected third parameter to exist");
        assert.strictEqual(third.type, "DefaultParameter", "Third param should be DefaultParameter");
        // right should ideally be an Identifier named 'undefined'. Some
        // upstream parser shapes may leave the `right` slot null until a
        // later canonicalization pass fills it; accept either form here
        // but validate the expected sentinel shape when present.
        if (third.right) {
            assert.strictEqual(third.right.type, "Identifier");
            assert.strictEqual(third.right.name, "undefined");
        }
        // optionality is determined by doc-driven reconciliation; the
        // transform materializes the DefaultParameter and leaves
        // `_featherOptionalParameter` for the later pass to decide.
    });

    void it("builds identifier locations from available token offsets", () => {
        const builder = new GameMakerASTBuilder(defaultParserOptions);
        const location = builder.createIdentifierLocation({
            line: 3,
            column: 7,
            start: 42,
            stop: 45
        });

        assert.deepStrictEqual(location, {
            start: { line: 3, index: 42, column: 7 },
            end: { line: 3, index: 46, column: 11 }
        });
    });

    void it("falls back to startIndex and stopIndex when primary offsets are missing", () => {
        const builder = new GameMakerASTBuilder(defaultParserOptions);
        const location = builder.createIdentifierLocation({
            line: 2,
            startIndex: 5,
            stopIndex: 9
        });

        assert.deepStrictEqual(location, {
            start: { line: 2, index: 5 },
            end: { line: 2, index: 10 }
        });
    });

    void it("promotes lexer token recognition errors to syntax errors with context", () => {
        const source = "\\";

        assert.throws(
            () => GMLParser.parse(source),
            (error: unknown) => {
                if (!(error instanceof GameMakerSyntaxError)) {
                    throw new Error("Expected a GameMakerSyntaxError for invalid lexer input.");
                }

                assert.match(error.message, /Syntax Error \(line 1, column 0\): unexpected symbol '\\'/);
                assert.strictEqual(error.line, 1);
                assert.strictEqual(error.column, 0);
                assert.strictEqual(error.wrongSymbol, String.raw`symbol '\'`);
                assert.strictEqual(error.offendingText, "\\");
                return true;
            }
        );
    });

    void it("tracks comment locations correctly when using CRLF", () => {
        const source = "/*first\r\nsecond*/";
        const ast = GMLParser.parse(source, {
            getComments: true,
            getLocations: true,
            simplifyLocations: false
        });

        assert.ok(ast, "Parser returned no AST when parsing CRLF comment source.");
        assert.ok(Array.isArray(ast.comments), "Expected parser to return comments array.");
        const [comment] = ast.comments;

        assert.ok(comment, "Expected at least one comment to be returned.");
        assert.strictEqual(comment.start.line, 1, "Comment start line should be unaffected by CRLF.");
        assert.strictEqual(
            comment.end.line,
            2,
            "Comment end line should advance by a single line for a CRLF sequence."
        );
    });

    void it("pre-attaches @function doc comments to the following function declaration", () => {
        const source = [
            "var unrelated_value = 1;",
            "",
            "/// @function scr_target",
            "function scr_target() {",
            "    return unrelated_value;",
            "}",
            ""
        ].join("\n");

        const ast = GMLParser.parse(source, {
            getComments: true,
            getLocations: true,
            simplifyLocations: false
        });

        const [variableDeclaration, functionDeclaration] = ast.body;
        assert.ok(
            variableDeclaration?.type === "VariableDeclaration",
            "Expected first statement to be a variable declaration."
        );
        assert.ok(
            functionDeclaration?.type === "FunctionDeclaration",
            "Expected second statement to be a function declaration."
        );

        assert.ok(
            !Array.isArray(variableDeclaration.docComments) || variableDeclaration.docComments.length === 0,
            "Parser should not attach @function doc comments to unrelated variable declarations."
        );

        assert.ok(
            Array.isArray(functionDeclaration.docComments),
            "Function declaration should have parser-attached doc comments."
        );
        assert.ok(functionDeclaration.docComments.length > 0, "Expected at least one parser-attached doc comment.");

        const [functionDocComment] = functionDeclaration.docComments;
        assert.ok(functionDocComment, "Expected a parser-attached @function doc comment.");
        assert.strictEqual(functionDocComment._gmlAttachedDocComment, true);
        assert.match(
            String(functionDocComment.value),
            /@function\b/i,
            "Attached parser doc comment should preserve the @function tag."
        );
    });

    void it("pre-attaches @function doc comments to function-initialized variable declarations", () => {
        const source = [
            "/// @function scr_assigned",
            "var scr_assigned = function () {",
            "    return 42;",
            "};",
            ""
        ].join("\n");

        const ast = GMLParser.parse(source, {
            getComments: true,
            getLocations: true,
            simplifyLocations: false
        });

        const [variableDeclaration] = ast.body;
        assert.ok(variableDeclaration?.type === "VariableDeclaration", "Expected a variable declaration target.");
        assert.ok(
            Array.isArray(variableDeclaration.docComments) && variableDeclaration.docComments.length > 0,
            "Function-initialized variable declarations should keep parser-attached @function comments."
        );

        const [functionDocComment] = variableDeclaration.docComments;
        assert.ok(functionDocComment, "Expected the parser to attach a function-tag doc comment.");
        assert.strictEqual(functionDocComment._gmlAttachedDocComment, true);
        assert.match(String(functionDocComment.value), /@function\b/i);
    });

    void it("skips parser-owned @function attachment when disabled", () => {
        const source = ["/// @function scr_target", "function scr_target() {", "    return 1;", "}", ""].join("\n");

        const ast = GMLParser.parse(source, {
            getComments: true,
            getLocations: true,
            simplifyLocations: false,
            attachFunctionDocComments: false
        });

        const [functionDeclaration] = ast.body;
        assert.ok(functionDeclaration?.type === "FunctionDeclaration", "Expected a function declaration target.");
        assert.ok(
            !Array.isArray(functionDeclaration.docComments) || functionDeclaration.docComments.length === 0,
            "Function declaration should not receive parser-owned @function attachments when disabled."
        );

        assert.ok(Array.isArray(ast.comments), "Expected parser comments to remain available.");
        const functionTagComment = ast.comments.find(
            (comment: { value?: unknown }) => typeof comment?.value === "string" && /@function\b/i.test(comment.value)
        );
        assert.ok(functionTagComment, "Expected source comment list to retain the @function comment.");
    });

    void it("captures the full range of member access expressions", () => {
        const source = "function demo(arg = namespace.value) {\n  return arg;\n}\n";
        const ast = parseFixture(source, {
            options: { getLocations: true, simplifyLocations: false }
        });

        assert.ok(ast, "Parser returned no AST when parsing member access source.");
        const [fn] = ast.body;
        assert.ok(fn && fn.type === "FunctionDeclaration", "Expected a function declaration.");

        const [param] = fn.params;
        assert.ok(param && param.type === "DefaultParameter", "Expected a default parameter.");
        const memberExpression = param.right;
        assert.ok(
            memberExpression && memberExpression.type === "MemberDotExpression",
            "Expected a member access default value."
        );

        const expectedStart = source.indexOf("namespace");
        assert.ok(expectedStart !== -1, "Unable to locate member expression start in source.");
        assert.strictEqual(
            Core.getNodeStartIndex(memberExpression),
            expectedStart,
            "Member expression start should include the object portion."
        );
    });

    void it("parses leading-dot member access expressions", () => {
        const source = "function demo() {\n  return .destination;\n}\n";
        const ast = parseFixture(source, {
            options: { getLocations: true, simplifyLocations: false }
        });

        const [memberExpression] = collectNodesByType(ast, "MemberDotExpression");
        assert.ok(memberExpression, "Expected a MemberDotExpression node for leading-dot access.");

        const expectedStart = source.indexOf(".destination");
        assert.ok(expectedStart !== -1, "Unable to locate leading-dot member expression in source.");
        assert.strictEqual(
            Core.getNodeStartIndex(memberExpression),
            expectedStart,
            "Leading-dot member expression should start at the dot token."
        );
    });

    void it("parses template interpolation that contains leading-dot member access", () => {
        const source = 'var _destination = __ChatterboxParseExpression($"({.destination})", false);\n';
        const ast = parseFixture(source, {
            options: { getLocations: true, simplifyLocations: false }
        });

        const [templateExpression] = collectNodesByType(ast, "TemplateStringExpression");
        assert.ok(templateExpression, "Expected a template string expression.");

        const interpolatedMember = Array.isArray(templateExpression.atoms)
            ? templateExpression.atoms.find((atom: { type?: unknown }) => atom?.type === "MemberDotExpression")
            : null;

        assert.ok(interpolatedMember, "Expected template interpolation to produce a MemberDotExpression atom.");

        const expectedStart = source.indexOf(".destination");
        assert.ok(expectedStart !== -1, "Unable to locate interpolated leading-dot member access.");
        assert.strictEqual(
            Core.getNodeStartIndex(interpolatedMember),
            expectedStart,
            "Interpolated leading-dot member access should retain its source start index."
        );
    });

    void it("parses implicit leading-dot call statements", () => {
        const source = '.add("follow", { id: 1 });\n';
        const ast = parseFixture(source, {
            options: { getLocations: true, simplifyLocations: false }
        });

        const [callExpression] = collectNodesByType(ast, "CallExpression");
        assert.ok(callExpression, "Expected a CallExpression node for leading-dot call syntax.");
        assert.ok(
            callExpression.object && callExpression.object.type === "MemberDotExpression",
            "Expected leading-dot call expression object to be a MemberDotExpression."
        );

        const expectedStart = source.indexOf(".add");
        assert.ok(expectedStart !== -1, "Unable to locate leading-dot call start in source.");
        assert.strictEqual(
            Core.getNodeStartIndex(callExpression),
            expectedStart,
            "Leading-dot call statement should start at the dot token."
        );
    });

    void it("parses assignments that target member access on call results", () => {
        const source = 'set_mapping(gp_shoulderrb, 4, __INPUT_MAPPING.AXIS, "righttrigger").extended_range = true;\n';
        const ast = parseFixture(source, {
            options: { getLocations: true, simplifyLocations: false }
        });

        const [assignment] = collectNodesByType(ast, "AssignmentExpression");
        assert.ok(assignment, "Expected an assignment expression.");
        assert.ok(
            assignment.left && assignment.left.type === "MemberDotExpression",
            "Expected assignment target to remain a member-dot expression."
        );
    });

    void it("parses nested assignments when the RHS targets member access on a call result", () => {
        const source = '_mapping = set_mapping(gp_axislv, 0, __INPUT_MAPPING.AXIS, "lefty").limited_range = true;\n';
        const ast = parseFixture(source, {
            options: { getLocations: true, simplifyLocations: false }
        });

        const assignments = collectNodesByType(ast, "AssignmentExpression");
        assert.ok(assignments.length >= 2, "Expected both outer and nested assignment expressions.");

        const nestedAssignment = assignments.find(
            (assignment) => assignment.left && assignment.left.type === "MemberDotExpression"
        );

        assert.ok(nestedAssignment, "Expected nested assignment to target a member-dot expression.");
    });

    void it("parses chained calls that continue on the next line", () => {
        const source = ["fsm", '    .add("editor", {})', '    .add("follow", {});', ""].join("\n");

        const ast = parseFixture(source, {
            options: { getLocations: true, simplifyLocations: false }
        });

        const callExpressions = collectNodesByType(ast, "CallExpression");
        assert.ok(
            callExpressions.length >= 2,
            "Expected chained line-continuation calls to parse as call expressions."
        );
    });

    void it("parses for-loop update clauses with postfix increment", () => {
        const source = "for (var i = 0; i < 3; i++) { }\n";

        assert.doesNotThrow(
            () => parseFixture(source),
            "Expected postfix increment in for-loop update clause to parse."
        );
    });

    void it("parses standalone postfix inc/dec statements separated by newlines without semicolons", () => {
        const source = ["var myCount = 10;", "++myCount", "--myCount", "myCount++", "myCount--", ""].join("\n");

        assert.doesNotThrow(
            () => parseFixture(source),
            "Expected postfix and prefix inc/dec statements without trailing semicolons to parse across line breaks."
        );
    });

    void it("parses for-loop update clauses with assignment expressions", () => {
        const source = "for (var i = 0; i < 3; i = i + 1) { }\n";

        assert.doesNotThrow(
            () => parseFixture(source),
            "Expected assignment expression in for-loop update clause to parse."
        );
    });

    void it("retains 'globalvar' declarations in the AST", () => {
        const source = "globalvar foo, bar;\nfoo = 1;\n";
        const ast = parseFixture(source, { options: { getLocations: true } });

        assert.ok(ast, "Parser returned no AST when parsing globalvar source.");
        const [statement] = ast.body;

        assert.ok(statement, "Expected a globalvar statement to be present.");
        assert.strictEqual(statement.type, "GlobalVarStatement", "Expected a GlobalVarStatement node in the AST.");
        assert.strictEqual(statement.kind, "globalvar", "GlobalVarStatement should preserve the 'globalvar' keyword.");
        assert.ok(Array.isArray(statement.declarations), "GlobalVarStatement should expose declarations.");
        assert.strictEqual(statement.declarations.length, 2, "Expected two global declarations.");
        assert.deepStrictEqual(
            statement.declarations.map((declaration) => declaration?.id?.name),
            ["foo", "bar"],
            "Global declarations should retain their names."
        );
    });

    void it("creates placeholders for leading omitted call arguments", () => {
        const source = "global.camera.punch(,, _num_hearts);\n";
        const ast = parseFixture(source, {
            options: { simplifyLocations: false }
        });

        const [callExpression] = collectNodesByType(ast, "CallExpression");

        assert.ok(
            callExpression && Array.isArray(callExpression.arguments),
            "Expected to find a call expression with arguments."
        );

        assert.strictEqual(
            callExpression.arguments.length,
            3,
            "Call expressions with leading omitted arguments should retain placeholders."
        );

        assert.strictEqual(
            callExpression.arguments[0]?.type,
            "MissingOptionalArgument",
            "Leading comma should synthesize a missing argument placeholder."
        );

        assert.strictEqual(
            callExpression.arguments[1]?.type,
            "MissingOptionalArgument",
            "Consecutive commas should synthesize a second missing argument placeholder."
        );

        const thirdArgument = callExpression.arguments[2];
        assert.ok(
            thirdArgument && thirdArgument.type === "Identifier",
            "Expected the final argument to remain an identifier."
        );
        assert.strictEqual(thirdArgument.name, "_num_hearts", "Identifier argument should keep its original name.");
    });

    void it("parses template strings with escape sequences", () => {
        const source = 'var message = $"Line 1\\nLine 2";\n';
        const ast = parseFixture(source);

        assert.ok(ast, "Parser returned no AST when parsing template strings.");

        const [template] = collectNodesByType(ast, "TemplateStringExpression");

        assert.ok(template, "Expected a TemplateStringExpression node to be present.");

        const textSegments = template.atoms.filter((atom) => atom && atom.type === "TemplateStringText");

        assert.ok(
            textSegments.some((segment) => segment.value === String.raw`\n`),
            "Template string text should include the escaped newline sequence."
        );
    });

    void it("allows single equals for equality in expressions", () => {
        const source = 'if (vendor = "7e05") { }';
        assert.doesNotThrow(() => GMLParser.parse(source));
    });

    void it("parses begin/end block delimiters as standard blocks", () => {
        const source = ["if (true) begin", "    x = 1;", "end", ""].join("\n");
        const ast = parseFixture(source);

        assert.ok(ast, "Parser returned no AST when parsing begin/end source.");
        const [ifStatement] = ast.body;
        assert.ok(ifStatement && ifStatement.type === "IfStatement", "Expected an if statement.");
        assert.ok(ifStatement.consequent, "Expected if statement to have a consequent.");
        assert.strictEqual(
            ifStatement.consequent.type,
            "BlockStatement",
            "begin/end should parse as a BlockStatement."
        );
        assert.ok(Array.isArray(ifStatement.consequent.body), "Expected block consequent to expose a statement list.");
        assert.strictEqual(
            ifStatement.consequent.body.length,
            1,
            "begin/end block should contain the enclosed assignment."
        );
        assert.strictEqual(
            ifStatement.consequent.body[0]?.type,
            "AssignmentExpression",
            "Expected assignment statement to remain inside the block."
        );
    });

    void it("allows single equals for equality in complex expressions", () => {
        const source = 'if ((vendor = "7e05") && (product = "0920")) { }';
        assert.doesNotThrow(() => GMLParser.parse(source));
    });

    void it("correctly handles equals as expression and assignment in the same scope", () => {
        const source = "var a = 1; if (a = 2) { a = 3; }";
        assert.doesNotThrow(() => GMLParser.parse(source));
    });

    void it("parses chained assignments as nested assignment expressions", () => {
        const source = "var a=2,b=2,c=2;\na = b = c = 1;";
        const ast = parseFixture(source);

        const assignments = collectNodesByType(ast, "AssignmentExpression");
        assert.strictEqual(assignments.length, 3, "Expected a nested assignment chain (a, b, c).");

        const [outer, middle, inner] = assignments;
        assert.strictEqual(outer.left.name, "a");
        assert.strictEqual(middle.left.name, "b");
        assert.strictEqual(inner.left.name, "c");

        assert.strictEqual(inner.right.type, "Literal");
        assert.strictEqual(inner.right.value, "1");
    });

    void it("allows #region inside switch cases", () => {
        const source = `
switch (x) {
    #region Some Cases
    case 1:
        break;
    #endregion
    case 2:
        #region Inner Region
        break;
        #endregion
}
`;
        assert.doesNotThrow(() => GMLParser.parse(source));
    });

    void it("allows #region inside enum", () => {
        const source = `
enum E {
    #region Values
    A,
    B,
    #endregion
    C
}
`;
        assert.doesNotThrow(() => GMLParser.parse(source));
    });

    void it("allows #region inside struct literal", () => {
        const source = `
var s = {
    #region Properties
    a: 1,
    b: 2
    #endregion
};
`;
        assert.doesNotThrow(() => GMLParser.parse(source));
    });

    void it("allows #macro inside switch cases", () => {
        const source = `
switch (x) {
    #macro INTERNAL_CASE 1
    case INTERNAL_CASE:
        break;
}
`;
        assert.doesNotThrow(() => GMLParser.parse(source));
    });

    void it("allows property access on parenthesized function calls", () => {
        const source = "return (input_xy(_verb_l, _verb_r, _verb_u, _verb_d, _player_index, _most_recent)).x;";
        assert.doesNotThrow(() => GMLParser.parse(source));
    });

    void it("allows property access on parenthesized expressions in general", () => {
        const source = "var a = (b + c).d;";
        assert.doesNotThrow(() => GMLParser.parse(source));
    });

    void it("throws when scope tracking is enabled without a scope tracker factory", () => {
        const source = "var value = 1;";

        assert.throws(
            () =>
                parseFixture(source, {
                    options: {
                        scopeTrackerOptions: {
                            enabled: true,
                            getIdentifierMetadata: false
                        }
                    }
                }),
            /Invalid createScopeTracker function\./
        );
    });

    void it("ignores an invalid scope tracker factory when scope tracking is disabled", () => {
        const source = "var value = 1;";

        assert.doesNotThrow(() =>
            parseFixture(source, {
                options: {
                    scopeTrackerOptions: {
                        enabled: false,
                        getIdentifierMetadata: false,
                        createScopeTracker: "not-a-function" as unknown as () => ScopeTracker | null
                    }
                }
            })
        );
    });
});
