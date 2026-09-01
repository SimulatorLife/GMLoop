import assert from "node:assert/strict";
import test from "node:test";

import { Core } from "@gmloop/core";

import { buildProjectIndex, formatProjectIndexSyntaxError } from "../src/project-index/index.js";
import { createTempProjectWorkspace } from "./test-project-helpers.js";

void test("project index parser reports syntax errors with context", async () => {
    const workspace = await createTempProjectWorkspace("gmloop-parser-error-");
    const invalidSource = ["function example() {", "    var value = ;", "}", ""].join("\n");
    await workspace.writeProjectFile("objects/example/Step_0.gml", invalidSource);

    try {
        await assert.rejects(
            () => buildProjectIndex(workspace.projectRoot, Core.defaultFsFacade),
            (error: unknown) => {
                assert.ok(Core.isObjectLike(error));
                const formattedError = error as {
                    filePath?: string;
                    message?: string;
                    originalMessage?: string;
                    sourceExcerpt?: string;
                };
                assert.match(
                    formattedError.message ?? "",
                    /Syntax Error \(objects\/example\/Step_0\.gml: line 2, column \d+\): unexpected symbol ';/
                );
                assert.match(formattedError.message ?? "", /2 \| {5}var value = ;/);
                assert.equal(formattedError.filePath, "objects/example/Step_0.gml");
                assert.equal(formattedError.sourceExcerpt, "2 |     var value = ;\n  |                 ^");
                assert.match(formattedError.originalMessage ?? "", /Syntax Error/);
                return true;
            }
        );
    } finally {
        await workspace.cleanup();
    }
});

void test("syntax error excerpts expand tabs before pointing at the column", () => {
    const error = {
        message: "Syntax Error: unexpected token",
        line: 1,
        column: 2
    };

    const sourceText = "\tvar value = 1;";

    const formatted = formatProjectIndexSyntaxError(error, sourceText);

    assert.strictEqual(formatted.sourceExcerpt, "1 |     var value = 1;\n  |      ^");
});

void test("syntax error excerpts clamp oversized column values", () => {
    const error = {
        message: "Syntax Error: unexpected token",
        line: 1,
        column: 999
    };

    const formatted = formatProjectIndexSyntaxError(error, "var value = 1;");

    assert.strictEqual(formatted.sourceExcerpt, "1 | var value = 1;\n  |               ^");
});

void test("syntax error excerpts omit indicators for non-finite columns", () => {
    const error = {
        message: "Syntax Error: unexpected token",
        line: 1,
        column: Number.NaN
    };

    const formatted = formatProjectIndexSyntaxError(error, "var value = 1;");

    assert.strictEqual(formatted.sourceExcerpt, "1 | var value = 1;");
});

void test("display path remains absolute when file matches the project root", () => {
    const error = {
        message: "Syntax Error: unexpected token",
        line: 1,
        column: 1
    };

    const projectRoot = "/project/root";
    const formatted = formatProjectIndexSyntaxError({ ...error }, "", {
        filePath: projectRoot,
        projectRoot
    });

    assert.strictEqual(formatted.filePath, projectRoot);
});

void test("display path stays absolute when file lies outside the project root", () => {
    const error = {
        message: "Syntax Error: unexpected token",
        line: 1,
        column: 1
    };

    const formatted = formatProjectIndexSyntaxError({ ...error }, "", {
        filePath: "/external/project/file.gml",
        projectRoot: "/project/root"
    });

    assert.strictEqual(formatted.filePath, "/external/project/file.gml");
});

void test("formatProjectIndexSyntaxError tolerates missing error objects", () => {
    const formatted = formatProjectIndexSyntaxError(null, "", {
        filePath: "objects/example/Step_0.gml",
        projectRoot: "/project/root"
    });

    assert.ok(formatted);
    assert.strictEqual(formatted.message, "Syntax Error (objects/example/Step_0.gml): ");
    assert.strictEqual(formatted.originalMessage, "");
});
