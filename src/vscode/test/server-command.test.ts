import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";

import { VscodeExtension } from "@gmloop/vscode";

void test("VSCode command resolution defaults to gmloop lsp", () => {
    assert.deepEqual(VscodeExtension.resolveGmloopLanguageServerCommand(undefined), {
        command: "gmloop",
        args: ["lsp"]
    });
});

void test("VSCode command resolution appends lsp to a custom server path", () => {
    assert.deepEqual(VscodeExtension.resolveGmloopLanguageServerCommand("/opt/gmloop/bin/gmloop"), {
        command: "/opt/gmloop/bin/gmloop",
        args: ["lsp"]
    });
});

void test("VSCode command resolution falls back when the configured server path is empty or invalid", () => {
    assert.deepEqual(VscodeExtension.resolveGmloopLanguageServerCommand("   "), {
        command: "gmloop",
        args: ["lsp"]
    });
    assert.deepEqual(VscodeExtension.resolveGmloopLanguageServerCommand(42), {
        command: "gmloop",
        args: ["lsp"]
    });
});

function createResolutionOptions(existingPaths: Readonly<Record<string, string>>) {
    return {
        environment: {},
        extensionPath: null,
        homeDirectory: "/home/developer",
        pathExists: (candidatePath: string) => candidatePath in existingPaths,
        platform: process.platform,
        resolveRealPath: (candidatePath: string) => existingPaths[candidatePath] ?? candidatePath,
        workspaceFolderPaths: []
    } as const;
}

void test("VSCode launch resolution prefers the version-matched bundled language server", () => {
    const bundledServerPath = path.join("/extension", "server", "dist", "src", "main.js");
    const linkedCliPath = path.join("/opt/pnpm", "bin", "gmloop");
    const launch = VscodeExtension.resolveGmloopLanguageServerLaunch(undefined, {
        ...createResolutionOptions({
            [bundledServerPath]: bundledServerPath,
            [linkedCliPath]: "/workspace/gmloop/src/cli/dist/index.js"
        }),
        environment: { PNPM_HOME: "/opt/pnpm" },
        extensionPath: "/extension"
    });

    assert.deepEqual(launch, {
        args: [],
        kind: "module",
        modulePath: bundledServerPath
    });
});

void test("VSCode launch resolution uses a compiled CLI from the opened monorepo", () => {
    const cliPath = path.join("/workspace/gmloop", "src", "cli", "dist", "index.js");
    const launch = VscodeExtension.resolveGmloopLanguageServerLaunch(undefined, {
        ...createResolutionOptions({ [cliPath]: cliPath }),
        workspaceFolderPaths: ["/workspace/gmloop"]
    });

    assert.deepEqual(launch, {
        args: ["lsp"],
        kind: "module",
        modulePath: cliPath
    });
});

void test("VSCode launch resolution finds a pnpm-home CLI omitted from the GUI PATH", () => {
    const linkedCliPath = path.join("/opt/pnpm", "bin", "gmloop");
    const compiledCliPath = path.join("/workspace/gmloop", "src", "cli", "dist", "index.js");
    const launch = VscodeExtension.resolveGmloopLanguageServerLaunch(undefined, {
        ...createResolutionOptions({ [linkedCliPath]: compiledCliPath }),
        environment: { PNPM_HOME: "/opt/pnpm" }
    });

    assert.deepEqual(launch, {
        args: ["lsp"],
        kind: "module",
        modulePath: compiledCliPath
    });
});

void test("VSCode launch resolution preserves an explicit custom executable", () => {
    const launch = VscodeExtension.resolveGmloopLanguageServerLaunch(
        "/opt/gmloop/bin/gmloop",
        createResolutionOptions({})
    );

    assert.deepEqual(launch, {
        args: ["lsp"],
        command: "/opt/gmloop/bin/gmloop",
        kind: "executable"
    });
});

void test("VSCode launch resolution retains the PATH fallback when no installation is discoverable", () => {
    const launch = VscodeExtension.resolveGmloopLanguageServerLaunch(undefined, createResolutionOptions({}));

    assert.deepEqual(launch, {
        args: ["lsp"],
        command: "gmloop",
        kind: "executable"
    });
});
