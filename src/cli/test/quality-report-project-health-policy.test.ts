import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    countTodoMarkers,
    isBuildOutputFile,
    isLargeSourceFile,
    isScannableSourceFile,
    shouldDescendIntoSourceDirectory
} from "../src/modules/quality-report/project-health-policy.js";

void describe("project health policy", () => {
    void describe("shouldDescendIntoSourceDirectory", () => {
        void it("rejects ignored directory names", () => {
            for (const ignored of ["node_modules", "dist", "generated", "vendor", "tmp"]) {
                assert.equal(shouldDescendIntoSourceDirectory(ignored), false);
            }
        });

        void it("allows ordinary directory names", () => {
            assert.equal(shouldDescendIntoSourceDirectory("src"), true);
            assert.equal(shouldDescendIntoSourceDirectory("modules"), true);
        });
    });

    void describe("isScannableSourceFile", () => {
        void it("accepts .ts files that are not declaration files", () => {
            assert.equal(isScannableSourceFile("src/alpha/index.ts"), true);
        });

        void it("rejects .d.ts declaration files", () => {
            assert.equal(isScannableSourceFile("src/alpha/index.d.ts"), false);
        });

        void it("rejects non-TypeScript files", () => {
            assert.equal(isScannableSourceFile("src/alpha/index.js"), false);
        });
    });

    void describe("isBuildOutputFile", () => {
        void it("accepts .js files", () => {
            assert.equal(isBuildOutputFile("dist/index.js"), true);
        });

        void it("rejects non-.js files", () => {
            assert.equal(isBuildOutputFile("dist/index.js.map"), false);
        });
    });

    void describe("isLargeSourceFile", () => {
        void it("is false at and below the threshold", () => {
            assert.equal(isLargeSourceFile(1000), false);
            assert.equal(isLargeSourceFile(1), false);
        });

        void it("is true above the threshold", () => {
            assert.equal(isLargeSourceFile(1001), true);
        });
    });

    void describe("countTodoMarkers", () => {
        void it("counts TODO, FIXME, and HACK markers", () => {
            assert.equal(countTodoMarkers("// TODO: a\n// FIXME: b\n// HACK: c"), 3);
        });

        void it("returns zero when no markers are present", () => {
            assert.equal(countTodoMarkers("const value = 1;\n"), 0);
        });

        void it("does not match markers embedded in longer words", () => {
            assert.equal(countTodoMarkers("const TODOLIST = 1;\n"), 0);
        });
    });
});
