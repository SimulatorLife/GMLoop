import assert from "node:assert/strict";
import test from "node:test";

import {
    buildNoMatchingFilesMessage,
    buildSkippedDirectorySummaryMessage,
    buildSkippedFileDetailEntries,
    buildWriteModeSummaryMessage
} from "../src/commands/format-summary.js";

void test("buildNoMatchingFilesMessage reports ignored directory matches", () => {
    const message = buildNoMatchingFilesMessage({
        targetPath: ".",
        targetIsDirectory: true,
        targetPathProvided: false,
        extensions: [".gml"],
        ignoredFilesSkipped: true,
        gmlExtension: ".gml",
        cliExample: "pnpm dlx gmloop format path/to/project",
        workspaceExample: "pnpm run format:gml -- path/to/project"
    });

    assert.match(
        message,
        /All files matching "\.gml" were skipped in the current working directory \(\.\) by ignore rules\./
    );
    assert.match(message, /Nothing to format\./);
});

void test("buildWriteModeSummaryMessage includes examples for current working directory runs", () => {
    const message = buildWriteModeSummaryMessage({
        formattedFileCount: 2,
        targetPath: ".",
        targetIsDirectory: true,
        targetPathProvided: false,
        cliExample: "pnpm dlx gmloop format path/to/project",
        workspaceExample: "pnpm run format:gml -- path/to/project"
    });

    assert.strictEqual(
        message,
        "Formatted 2 files found in the current working directory (.). For example: pnpm dlx gmloop format path/to/project or pnpm run format:gml -- path/to/project."
    );
});

void test("buildSkippedFileDetailEntries includes ignored, unsupported extension, and symlink details", () => {
    const details = buildSkippedFileDetailEntries({
        ignored: 2,
        ignoredSamples: [{ filePath: "/tmp/ignored-a.gml", sourceDescription: "repo ignore" }],
        unsupportedExtension: 1,
        unsupportedExtensionSamples: ["/tmp/file.txt"],
        symbolicLink: 3
    });

    assert.deepEqual(details, [
        "ignored by .prettierignore (2) (e.g., /tmp/ignored-a.gml (repo ignore), ...)",
        "unsupported extensions (1) (e.g., /tmp/file.txt)",
        "symbolic links (3)"
    ]);
});

void test("buildSkippedDirectorySummaryMessage returns null when no directories are skipped", () => {
    const message = buildSkippedDirectorySummaryMessage({
        ignored: 0,
        ignoredSamples: []
    });

    assert.strictEqual(message, null);
});
