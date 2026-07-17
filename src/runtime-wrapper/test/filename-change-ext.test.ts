import assert from "node:assert/strict";
import test from "node:test";

import { applyHtml5FilenameChangeExtSafetyPatch } from "../src/browser/runtime/filename-change-ext.js";

function createRuntimeScope(): Record<string, unknown> {
    const scope: Record<string, unknown> = {
        html5Names: {
            self: "runtime",
            filename_change_ext: "changeExtension"
        },
        changeExtension: (filename: unknown, newExtension: unknown): string => {
            if (typeof filename !== "string" || typeof newExtension !== "string") {
                return String(filename);
            }

            const lastDot = filename.lastIndexOf(".");
            return lastDot > 0 ? `${filename.slice(0, lastDot)}${newExtension}` : filename;
        }
    };
    return scope;
}

void test("applyHtml5FilenameChangeExtSafetyPatch appends an extension to extensionless paths", () => {
    const scope = createRuntimeScope();

    assert.equal(applyHtml5FilenameChangeExtSafetyPatch(scope), true);
    const changeExtension = scope.changeExtension as (filename: string, newExtension: string) => string;
    assert.equal(changeExtension("islands/island2", ".obj"), "islands/island2.obj");
    assert.equal(changeExtension("islands/island2.old", ".obj"), "islands/island2.obj");
    assert.equal(changeExtension("islands/island2", ""), "islands/island2");
});

void test("applyHtml5FilenameChangeExtSafetyPatch is idempotent", () => {
    const scope = createRuntimeScope();

    assert.equal(applyHtml5FilenameChangeExtSafetyPatch(scope), true);
    assert.equal(applyHtml5FilenameChangeExtSafetyPatch(scope), false);
});

void test("applyHtml5FilenameChangeExtSafetyPatch supports the canonical global name", () => {
    const scope: Record<string, unknown> = {
        filename_change_ext: (filename: string, newExtension: string): string => filename + newExtension
    };

    assert.equal(applyHtml5FilenameChangeExtSafetyPatch(scope), true);
    assert.equal(
        (scope.filename_change_ext as (filename: string, newExtension: string) => string)("model", ".obj"),
        "model.obj"
    );
});
