import assert from "node:assert/strict";
import { test } from "node:test";

import { VscodeExtension } from "@gmloop/vscode";

void test("syncLocalExtensionFilesPure copies files when monorepo matches and contents differ", () => {
    const copiedFiles: { src: string; dest: string }[] = [];
    const readFiles: string[] = [];

    const mockExistsSync = (filePath: string) => {
        // Mock monorepo files exist
        if (filePath.includes("src/vscode/syntaxes/gml.tmLanguage.json")) return true;
        if (filePath.includes("src/vscode/syntaxes/markdown-gml.tmLanguage.json")) return true;
        if (filePath.includes("src/vscode/language-configuration.json")) return true;
        if (filePath.includes("src/vscode/package.json")) return true;

        // Mock destination files exist except markdown grammar
        if (filePath.includes("dest-extension/syntaxes/markdown-gml.tmLanguage.json")) return false;
        return true;
    };

    const mockReadFileSync = (filePath: string) => {
        readFiles.push(filePath);
        if (filePath.includes("monorepo/src/vscode/package.json")) return '{"version": "2.0.0"}';
        if (filePath.includes("dest-extension/package.json")) return '{"version": "1.0.0"}';
        return "same-content";
    };

    const mockCopyFileSync = (src: string, dest: string) => {
        copiedFiles.push({ src, dest });
    };

    let onChangedCalled = false;
    VscodeExtension.syncLocalExtensionFilesPure({
        workspaceFolders: [{ uri: { fsPath: "/workspace/monorepo" } }],
        extensionPath: "/workspace/dest-extension",
        existsSync: mockExistsSync,
        readFileSync: mockReadFileSync,
        copyFileSync: mockCopyFileSync,
        onChanged() {
            onChangedCalled = true;
        }
    });

    assert.ok(onChangedCalled);
    assert.deepEqual(copiedFiles, [
        {
            src: "/workspace/monorepo/src/vscode/syntaxes/markdown-gml.tmLanguage.json",
            dest: "/workspace/dest-extension/syntaxes/markdown-gml.tmLanguage.json"
        },
        {
            src: "/workspace/monorepo/src/vscode/package.json",
            dest: "/workspace/dest-extension/package.json"
        }
    ]);
});

void test("syncLocalExtensionFilesPure does nothing when workspaceFolders is undefined", () => {
    let onChangedCalled = false;
    VscodeExtension.syncLocalExtensionFilesPure({
        workspaceFolders: undefined,
        extensionPath: "/workspace/dest-extension",
        existsSync: () => true,
        readFileSync: () => "content",
        copyFileSync: () => {},
        onChanged() {
            onChangedCalled = true;
        }
    });
    assert.equal(onChangedCalled, false);
});
