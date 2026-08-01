import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it } from "node:test";

import { scanProjectHealth } from "../src/modules/quality-report/project-health.js";

const tempDirectories: Array<string> = [];

function createWorkspaceRoot(): string {
    const workspaceRoot = fs.mkdtempSync(path.join(os.tmpdir(), "project-health-"));
    tempDirectories.push(workspaceRoot);
    return workspaceRoot;
}

function writeWorkspaceFile(workspaceRoot: string, relativePath: string, contents: string): void {
    const filePath = path.join(workspaceRoot, relativePath);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, contents);
}

void describe("project health", () => {
    afterEach(() => {
        for (const tempDirectory of tempDirectories.splice(0)) {
            fs.rmSync(tempDirectory, { recursive: true, force: true });
        }
    });

    void it("counts source todos, large files, and built JavaScript size across workspaces", () => {
        const workspaceRoot = createWorkspaceRoot();
        const longSource = Array.from({ length: 1001 }, () => "let value = 1;").join("\n");

        writeWorkspaceFile(
            workspaceRoot,
            "src/alpha/src/large-file.ts",
            `${longSource}\n// TODO: refactor\n// FIXME: cleanup`
        );
        writeWorkspaceFile(workspaceRoot, "src/beta/src/notes.ts", "// HACK: temporary\nconst value = 1;\n");
        writeWorkspaceFile(workspaceRoot, "src/alpha/dist/index.js", "console.log('alpha');\n");
        writeWorkspaceFile(workspaceRoot, "src/beta/dist/index.js", "console.log('beta');\n");

        const stats = scanProjectHealth(workspaceRoot);

        assert.deepStrictEqual(stats, {
            largeFiles: 1,
            todos: 3,
            buildSize: "43 B"
        });
    });

    void it("ignores generated directories and declaration files when scanning sources", () => {
        const workspaceRoot = createWorkspaceRoot();

        writeWorkspaceFile(workspaceRoot, "src/alpha/src/index.ts", "const value = 1;\n");
        writeWorkspaceFile(workspaceRoot, "src/alpha/src/index.d.ts", "// TODO: ignored declaration\n");
        writeWorkspaceFile(workspaceRoot, "src/alpha/generated/generated.ts", "// TODO: ignored generated\n");
        writeWorkspaceFile(workspaceRoot, "src/alpha/dist/index.js", "x\n");

        const stats = scanProjectHealth(workspaceRoot);

        assert.deepStrictEqual(stats, {
            largeFiles: 0,
            todos: 0,
            buildSize: "2 B"
        });
    });

    void it("treats missing workspace dist directories as zero build size instead of throwing", () => {
        const workspaceRoot = createWorkspaceRoot();

        writeWorkspaceFile(workspaceRoot, "src/alpha/src/index.ts", "const value = 1;\n");

        const stats = scanProjectHealth(workspaceRoot);

        assert.deepStrictEqual(stats, {
            largeFiles: 0,
            todos: 0,
            buildSize: "0 B"
        });
    });
});
