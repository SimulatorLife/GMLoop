import assert from "node:assert/strict";
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

void test("VSCode executable options do not request a transport flag", () => {
    const options = VscodeExtension.resolveGmloopLanguageServerExecutableOptions("gmloop");

    assert.deepEqual(options, {
        command: "gmloop",
        args: ["lsp"]
    });
    assert.equal("transport" in options, false);
});
