import assert from "node:assert/strict";
import test from "node:test";

import { Refactor } from "../index.js";

void test("executeLoopLengthHoistingCodemod applies codemod across provided files", async () => {
    const engine = new Refactor.RefactorEngine();
    const files = new Map<string, string>([
        ["/project/changed.gml", "for (var i = 0; i < array_length(items); i++) {\n    total += i;\n}\n"],
        ["/project/unchanged.gml", "for (var i = 0; i < count; i++) {\n    total += i;\n}\n"]
    ]);
    const writes = new Map<string, string>();

    const result = await engine.executeLoopLengthHoistingCodemod({
        filePaths: [...files.keys()],
        readFile: async (filePath) => files.get(filePath) ?? "",
        writeFile: async (filePath, content) => {
            writes.set(filePath, content);
        }
    });

    assert.equal(result.changedFiles.length, 1);
    assert.equal(result.changedFiles[0]?.path, "/project/changed.gml");
    assert.equal(result.changedFiles[0]?.appliedEditCount > 0, true);
    assert.equal(writes.size, 1);
    assert.equal(result.applied.get("/project/changed.gml"), "");
    assert.equal(result.applied.has("/project/unchanged.gml"), false);
});

void test("executeLoopLengthHoistingCodemod supports dry-run mode", async () => {
    const engine = new Refactor.RefactorEngine();
    const result = await engine.executeLoopLengthHoistingCodemod({
        filePaths: ["/project/changed.gml"],
        readFile: async () => "for (var i = 0; i < array_length(items); i++) {\n    total += i;\n}\n",
        dryRun: true
    });

    assert.equal(result.changedFiles.length, 1);
    assert.equal(result.applied.has("/project/changed.gml"), true);
});

void test("executeLoopLengthHoistingCodemod de-duplicates repeated file paths", async () => {
    const engine = new Refactor.RefactorEngine();
    const reads: Array<string> = [];

    const result = await engine.executeLoopLengthHoistingCodemod({
        filePaths: ["/project/changed.gml", "/project/changed.gml"],
        readFile: async (filePath) => {
            reads.push(filePath);
            return `for (var i = 0; i < array_length(items); i++) {
    total += i;
}
`;
        },
        writeFile: async () => {}
    });

    assert.equal(reads.length, 1);
    assert.deepEqual(new Set(reads), new Set(["/project/changed.gml"]));
    assert.equal(result.changedFiles.length, 1);
});

void test("executeLoopLengthHoistingCodemod does not require writeFile when no changes are produced", async () => {
    const engine = new Refactor.RefactorEngine();

    const result = await engine.executeLoopLengthHoistingCodemod({
        filePaths: ["/project/unchanged.gml"],
        readFile: async () => "for (var i = 0; i < count; i++) {\n    total += i;\n}\n"
    });

    assert.equal(result.changedFiles.length, 0);
    assert.equal(result.workspace.edits.length, 0);
    assert.equal(result.applied.size, 0);
});

void test("executeLoopLengthHoistingCodemod requires writeFile when not in dry-run mode", async () => {
    const engine = new Refactor.RefactorEngine();

    await assert.rejects(
        async () =>
            engine.executeLoopLengthHoistingCodemod({
                filePaths: ["/project/changed.gml"],
                readFile: async () => "for (var i = 0; i < array_length(items); i++) {\n    total += i;\n}\n"
            }),
        {
            name: "TypeError",
            message: "executeLoopLengthHoistingCodemod requires a writeFile function"
        }
    );
});

void test("executeLoopLengthHoistingCodemod validates required file paths", async () => {
    const engine = new Refactor.RefactorEngine();

    await assert.rejects(
        async () =>
            engine.executeLoopLengthHoistingCodemod({
                filePaths: [],
                readFile: async () => "",
                writeFile: async () => {}
            }),
        {
            name: "TypeError",
            message: "executeLoopLengthHoistingCodemod requires a non-empty filePaths array"
        }
    );
});

void test("executeLoopLengthHoistingCodemod reads files sequentially", async () => {
    const engine = new Refactor.RefactorEngine();
    let activeReads = 0;
    let maxConcurrentReads = 0;

    await engine.executeLoopLengthHoistingCodemod({
        filePaths: ["/project/one.gml", "/project/two.gml", "/project/three.gml"],
        readFile: async () => {
            activeReads += 1;
            maxConcurrentReads = Math.max(maxConcurrentReads, activeReads);
            await new Promise<void>((resolve) => {
                setTimeout(resolve, 5);
            });
            activeReads -= 1;

            return "for (var i = 0; i < array_length(items); i++) {\n    total += i;\n}\n";
        },
        writeFile: async () => {}
    });

    assert.equal(maxConcurrentReads, 1);
});
