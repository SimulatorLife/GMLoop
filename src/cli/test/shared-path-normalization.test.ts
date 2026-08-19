import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import { normalizePath, normalizeRepositoryPath } from "../src/shared/path-normalization.js";

void describe("normalizePath", () => {
    void it("returns an empty string for an empty input", () => {
        assert.strictEqual(normalizePath(""), "");
    });

    void it("preserves POSIX-style paths unchanged", () => {
        assert.strictEqual(normalizePath("src/cli/src/commands/ci-report.ts"), "src/cli/src/commands/ci-report.ts");
    });

    void it("converts Windows-style backslashes to forward slashes", () => {
        const windowsStyle = String.raw`src\cli\src\commands\ci-report.ts`;

        assert.strictEqual(normalizePath(windowsStyle), "src/cli/src/commands/ci-report.ts");
    });

    void it("normalizes mixed separators to forward slashes", () => {
        const mixedSeparators = String.raw`src\cli/src\commands/ci-report.ts`;

        assert.strictEqual(normalizePath(mixedSeparators), "src/cli/src/commands/ci-report.ts");
    });

    void it("collapses runs of Windows separators via the shared Core helper", () => {
        const collapsedSeparators = String.raw`src\\cli\\commands\\ci-report.ts`;

        assert.strictEqual(normalizePath(collapsedSeparators), "src/cli/commands/ci-report.ts");
    });
});

void describe("normalizeRepositoryPath", () => {
    void it("strips the leading repository root when the path lies under cwd", () => {
        const repositoryRoot = process.cwd();
        const insideRepository = path.join(repositoryRoot, "src", "cli", "ci-report.ts");

        assert.strictEqual(normalizeRepositoryPath(insideRepository), "src/cli/ci-report.ts");
    });

    void it("falls back to the last /GMLoop/ marker when the path sits outside the repository root", () => {
        const outsideRoot = path.dirname(process.cwd());
        const outsidePath = path.join(outsideRoot, "GMLoop", "src", "cli", "ci-report.ts");

        assert.strictEqual(normalizeRepositoryPath(outsidePath), "src/cli/ci-report.ts");
    });

    void it("returns the path stripped of a leading ./ when no marker or root matches", () => {
        assert.strictEqual(normalizeRepositoryPath("./relative/path.ts"), "relative/path.ts");
    });
});
