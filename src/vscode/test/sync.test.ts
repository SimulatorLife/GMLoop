import assert from "node:assert/strict";
import { test } from "node:test";

import { VscodeExtension } from "@gmloop/vscode";

void test("local root resolution follows an absolute serverPath outside the opened project", () => {
    const roots = VscodeExtension.resolveLocalGmlLoopRoots({
        configuredServerPath: "/workspace/gmloop/src/cli/dist/index.js",
        existsSync: (candidatePath) => candidatePath === "/workspace/gmloop/src/vscode/package.json",
        workspaceFolderPaths: ["/workspace/cannonfather"]
    });

    assert.deepEqual(roots, ["/workspace/gmloop"]);
});

void test("local synchronization copies built runtime and preserves installed extension identity", () => {
    const monorepoRoot = "/workspace/gmloop";
    const extensionPath = "/workspace/extensions/gmloop.gmloop-0.0.1";
    const sourceFiles = [
        "dist/src/extension.js",
        "dist/src/extension.js.map",
        "dist/src/server-command.js",
        "dist/src/server-command.js.map",
        "dist/src/sync.js",
        "dist/src/sync.js.map",
        "language-configuration.json",
        "syntaxes/gml.tmLanguage.json",
        "syntaxes/markdown-gml.tmLanguage.json"
    ].map((relativePath) => `${monorepoRoot}/src/vscode/${relativePath}`);
    const sourceManifestPath = `${monorepoRoot}/src/vscode/package.json`;
    const destinationManifestPath = `${extensionPath}/package.json`;
    const sourceManifest = JSON.stringify({
        contributes: { commands: [{ command: "gmloop.restartLanguageServer", title: "Restart" }] },
        displayName: "GMLoop (local)",
        name: "@gmloop/vscode",
        version: "0.0.1"
    });
    const destinationManifest = JSON.stringify({
        files: ["dist/**"],
        name: "gmloop",
        publisher: "gmloop",
        version: "0.0.1"
    });
    const copiedFiles: { src: string; dest: string }[] = [];
    let writtenManifest = "";
    let onChangedCalled = false;

    VscodeExtension.syncLocalExtensionFilesPure({
        copyFileSync(src, dest) {
            copiedFiles.push({ src, dest });
        },
        existsSync(candidatePath) {
            return (
                candidatePath === sourceManifestPath ||
                candidatePath === destinationManifestPath ||
                sourceFiles.includes(candidatePath)
            );
        },
        extensionPath,
        logError(message, error) {
            const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
            throw new Error(`${message} ${errorMessage}`);
        },
        monorepoRoots: [monorepoRoot],
        onChanged() {
            onChangedCalled = true;
        },
        readFileSync(filePath) {
            if (filePath === sourceManifestPath) {
                return sourceManifest;
            }
            if (filePath === destinationManifestPath) {
                return destinationManifest;
            }
            return "source-content";
        },
        writeFileSync(_filePath, content) {
            writtenManifest = content;
        }
    });

    assert.equal(copiedFiles.length, sourceFiles.length);
    assert.ok(copiedFiles.some(({ src }) => src.endsWith("/dist/src/extension.js")));
    assert.ok(copiedFiles.some(({ src }) => src.endsWith("/dist/src/sync.js")));
    assert.ok(onChangedCalled);
    const mergedManifest = JSON.parse(writtenManifest) as {
        readonly contributes: { readonly commands: readonly unknown[] };
        readonly displayName: string;
        readonly name: string;
        readonly publisher: string;
    };
    assert.equal(mergedManifest.name, "gmloop");
    assert.equal(mergedManifest.publisher, "gmloop");
    assert.equal(mergedManifest.displayName, "GMLoop (local)");
    assert.equal(mergedManifest.contributes.commands.length, 1);
});

void test("local synchronization does nothing when no GMLoop source root is available", () => {
    let onChangedCalled = false;
    VscodeExtension.syncLocalExtensionFilesPure({
        copyFileSync: () => {
            throw new Error("No files should be copied without a source root");
        },
        existsSync: () => false,
        extensionPath: "/workspace/extensions/gmloop.gmloop-0.0.1",
        monorepoRoots: [],
        onChanged() {
            onChangedCalled = true;
        },
        readFileSync: () => "",
        writeFileSync: () => {
            throw new Error("No manifest should be written without a source root");
        }
    });
    assert.equal(onChangedCalled, false);
});

void test("local synchronization does not publish a partial extension build", () => {
    const monorepoRoot = "/workspace/gmloop";
    const runtimeFiles = [
        "dist/src/extension.js",
        "dist/src/extension.js.map",
        "dist/src/server-command.js",
        "dist/src/server-command.js.map",
        "dist/src/sync.js",
        "dist/src/sync.js.map"
    ];
    let onChangedCalled = false;
    VscodeExtension.syncLocalExtensionFilesPure({
        copyFileSync: () => {
            throw new Error("Partial builds must not be copied");
        },
        existsSync(candidatePath) {
            if (candidatePath === `${monorepoRoot}/src/vscode/package.json`) {
                return true;
            }
            return runtimeFiles
                .filter((relativePath) => relativePath !== "dist/src/sync.js")
                .some((relativePath) => candidatePath === `${monorepoRoot}/src/vscode/${relativePath}`);
        },
        extensionPath: "/workspace/extensions/gmloop.gmloop-0.0.1",
        monorepoRoots: [monorepoRoot],
        onChanged() {
            onChangedCalled = true;
        },
        readFileSync: () => "",
        writeFileSync: () => {
            throw new Error("Partial builds must not update the manifest");
        }
    });
    assert.equal(onChangedCalled, false);
});
