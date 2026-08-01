import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { normalizeLintFilePath } from "../../src/language/path-normalization.js";

void test("normalizeLintFilePath preserves ESLint virtual filenames", () => {
    assert.equal(normalizeLintFilePath("<text>"), "<text>");
});

void test("normalizeLintFilePath resolves real filesystem paths", () => {
    const tempDirectory = mkdtempSync(path.join(os.tmpdir(), "gmloop-lint-path-"));

    try {
        const nestedDirectory = path.join(tempDirectory, "nested");
        const filePath = path.join(nestedDirectory, "example.gml");
        mkdirSync(nestedDirectory, { recursive: true });
        writeFileSync(filePath, "show_debug_message(1);", { encoding: "utf8", flag: "wx" });

        const normalized = normalizeLintFilePath(path.join(tempDirectory, ".", "nested", "example.gml"));

        assert.equal(normalized, realpathSync.native(path.resolve(filePath)));
    } finally {
        rmSync(tempDirectory, { recursive: true, force: true });
    }
});

void test("normalizeLintFilePath returns a trimmed absolute path when the file does not exist", () => {
    const missingPathWithSeparator = `${path.join(process.cwd(), "missing-file.gml")}${path.sep}`;

    const normalized = normalizeLintFilePath(missingPathWithSeparator);

    assert.equal(normalized, path.resolve(process.cwd(), "missing-file.gml"));
});
