import assert from "node:assert/strict";
import test from "node:test";

import { Refactor } from "../index.js";

const { applyGlobalvarToGlobalCodemod, collectGlobalvarDeclaredNames } = Refactor.GlobalvarToGlobal;

// ---------------------------------------------------------------------------
// collectGlobalvarDeclaredNames
// ---------------------------------------------------------------------------

void test("collectGlobalvarDeclaredNames returns declared variable names", () => {
    const source = "globalvar score;\nglobalvar doExit;\nvar x = 1;\n";
    const names = collectGlobalvarDeclaredNames(source);
    assert.deepEqual([...names].sort(), ["doExit", "score"]);
});

void test("collectGlobalvarDeclaredNames handles comma-separated declarations", () => {
    const source = "globalvar hp, mp, xp;\n";
    const names = collectGlobalvarDeclaredNames(source);
    assert.deepEqual([...names].sort(), ["hp", "mp", "xp"]);
});

void test("collectGlobalvarDeclaredNames returns empty set for source with no globalvar", () => {
    const source = "var x = 1;\nif (x > 0) return;\n";
    const names = collectGlobalvarDeclaredNames(source);
    assert.equal(names.size, 0);
});

void test("collectGlobalvarDeclaredNames returns empty set for empty source", () => {
    assert.equal(collectGlobalvarDeclaredNames("").size, 0);
});

// ---------------------------------------------------------------------------
// applyGlobalvarToGlobalCodemod — basic transformations
// ---------------------------------------------------------------------------

void test("applyGlobalvarToGlobalCodemod removes a single globalvar declaration", () => {
    const input = "globalvar score;\nscore = 0;\n";
    const result = applyGlobalvarToGlobalCodemod(input);
    assert.equal(result.changed, true);
    assert.equal(result.outputText, "global.score = 0;\n");
    assert.deepEqual([...result.migratedNames], ["score"]);
});

void test("applyGlobalvarToGlobalCodemod removes multiple globalvar statements", () => {
    const input = [
        "globalvar score;",
        "",
        "if (should_exit()) return;",
        "",
        "globalvar doExit;",
        "if (doExit == global.exitState) {",
        "    exit;",
        "}",
        ""
    ].join("\n");
    const result = applyGlobalvarToGlobalCodemod(input);
    assert.equal(result.changed, true);
    // Both declarations removed and the bare doExit reference rewritten.
    assert.ok(!result.outputText.includes("globalvar"));
    assert.ok(result.outputText.includes("global.doExit"));
    // global.exitState must NOT be doubly-prefixed.
    assert.ok(!result.outputText.includes("global.global."));
    assert.deepEqual([...result.migratedNames].sort(), ["doExit", "score"]);
});

void test("applyGlobalvarToGlobalCodemod leaves already-prefixed global.x references unchanged", () => {
    const input = "globalvar score;\nif (global.score > 0) { }\n";
    const result = applyGlobalvarToGlobalCodemod(input);
    assert.equal(result.changed, true);
    // The existing global.score access should NOT be double-prefixed.
    assert.ok(!result.outputText.includes("global.global."));
    assert.ok(!result.outputText.includes("globalvar"));
});

void test("applyGlobalvarToGlobalCodemod handles comma-separated globalvar declarations", () => {
    const input = "globalvar hp, mp;\nhp = 100;\nmp = 50;\n";
    const result = applyGlobalvarToGlobalCodemod(input);
    assert.equal(result.changed, true);
    assert.ok(!result.outputText.includes("globalvar"));
    assert.ok(result.outputText.includes("global.hp"));
    assert.ok(result.outputText.includes("global.mp"));
    assert.deepEqual([...result.migratedNames].sort(), ["hp", "mp"]);
});

void test("applyGlobalvarToGlobalCodemod returns unchanged result for source with no globalvar", () => {
    const input = "var x = 1;\nif (x > 0) return;\n";
    const result = applyGlobalvarToGlobalCodemod(input);
    assert.equal(result.changed, false);
    assert.equal(result.outputText, input);
    assert.equal(result.appliedEdits.length, 0);
    assert.equal(result.migratedNames.length, 0);
});

void test("applyGlobalvarToGlobalCodemod returns unchanged result for empty source", () => {
    const result = applyGlobalvarToGlobalCodemod("");
    assert.equal(result.changed, false);
    assert.equal(result.outputText, "");
});

void test("applyGlobalvarToGlobalCodemod replaces references in if-test expressions", () => {
    const input = "globalvar lives;\nif (lives > 0) {\n    lives -= 1;\n}\n";
    const result = applyGlobalvarToGlobalCodemod(input);
    assert.equal(result.changed, true);
    assert.ok(result.outputText.includes("global.lives"));
    assert.ok(!result.outputText.includes("globalvar"));
});

// ---------------------------------------------------------------------------
// applyGlobalvarToGlobalCodemod — cross-file reference migration
// ---------------------------------------------------------------------------

void test("applyGlobalvarToGlobalCodemod migrates references when knownGlobalvarNames is provided", () => {
    // File A declared globalvar score; but this is File B which only has uses.
    const input = "score += 10;\n";
    const knownNames = new Set(["score"]);
    const result = applyGlobalvarToGlobalCodemod(input, knownNames);
    assert.equal(result.changed, true);
    assert.equal(result.outputText, "global.score += 10;\n");
    assert.deepEqual([...result.migratedNames], ["score"]);
});

void test("applyGlobalvarToGlobalCodemod does not migrate names not in knownGlobalvarNames and not declared locally", () => {
    const input = "score += 10;\n";
    const result = applyGlobalvarToGlobalCodemod(input, new Set());
    assert.equal(result.changed, false);
    assert.equal(result.outputText, input);
});

// ---------------------------------------------------------------------------
// applyGlobalvarToGlobalCodemod — excludeNames option
// ---------------------------------------------------------------------------

void test("applyGlobalvarToGlobalCodemod respects excludeNames option for reference migration", () => {
    const input = "globalvar hp, mp;\nhp = 100;\nmp = 50;\n";
    const result = applyGlobalvarToGlobalCodemod(input, new Set(), { excludeNames: ["mp"] });
    assert.equal(result.changed, true);
    // hp reference must be rewritten; mp reference must remain bare.
    assert.ok(result.outputText.includes("global.hp"));
    assert.ok(!result.outputText.includes("global.mp"));
    // The globalvar declaration itself is still removed.
    assert.ok(!result.outputText.includes("globalvar"));
    // migratedNames excludes mp.
    assert.deepEqual([...result.migratedNames], ["hp"]);
});

// ---------------------------------------------------------------------------
// engine-level executeGlobalvarToGlobalCodemod
// ---------------------------------------------------------------------------

void test("executeGlobalvarToGlobalCodemod migrates declarations and references across a single file", async () => {
    const engine = new Refactor.RefactorEngine();
    const files = new Map<string, string>([["/project/globals.gml", "globalvar score;\nscore = 0;\n"]]);
    const writes = new Map<string, string>();

    const result = await engine.executeGlobalvarToGlobalCodemod({
        filePaths: [...files.keys()],
        readFile: async (filePath) => files.get(filePath) ?? "",
        writeFile: async (filePath, content) => {
            writes.set(filePath, content);
        }
    });

    assert.equal(result.changedFiles.length, 1);
    assert.equal(result.changedFiles[0]?.path, "/project/globals.gml");
    assert.ok(result.changedFiles[0]?.migratedNames.includes("score"));
    assert.equal(writes.get("/project/globals.gml"), "global.score = 0;\n");
});

void test("executeGlobalvarToGlobalCodemod propagates declarations from one file to references in another", async () => {
    const engine = new Refactor.RefactorEngine();
    const files = new Map<string, string>([
        ["/project/init.gml", "globalvar score;\nscore = 0;\n"],
        ["/project/game.gml", "score += 10;\n"]
    ]);
    const writes = new Map<string, string>();

    const result = await engine.executeGlobalvarToGlobalCodemod({
        filePaths: [...files.keys()],
        readFile: async (filePath) => files.get(filePath) ?? "",
        writeFile: async (filePath, content) => {
            writes.set(filePath, content);
        }
    });

    // Both files should be changed.
    assert.equal(result.changedFiles.length, 2);
    assert.equal(writes.get("/project/init.gml"), "global.score = 0;\n");
    assert.equal(writes.get("/project/game.gml"), "global.score += 10;\n");
});

void test("executeGlobalvarToGlobalCodemod returns empty result when no globalvar declarations exist", async () => {
    const engine = new Refactor.RefactorEngine();
    const files = new Map<string, string>([
        ["/project/a.gml", "var x = 1;\n"],
        ["/project/b.gml", "var y = 2;\n"]
    ]);

    const result = await engine.executeGlobalvarToGlobalCodemod({
        filePaths: [...files.keys()],
        readFile: async (filePath) => files.get(filePath) ?? ""
    });

    assert.equal(result.changedFiles.length, 0);
    assert.equal(result.applied.size, 0);
});

void test("executeGlobalvarToGlobalCodemod supports dry-run mode", async () => {
    const engine = new Refactor.RefactorEngine();
    const files = new Map<string, string>([["/project/globals.gml", "globalvar score;\nscore = 0;\n"]]);
    const writes = new Map<string, string>();

    const result = await engine.executeGlobalvarToGlobalCodemod({
        filePaths: [...files.keys()],
        readFile: async (filePath) => files.get(filePath) ?? "",
        writeFile: async (filePath, content) => {
            writes.set(filePath, content);
        },
        dryRun: true
    });

    assert.equal(result.changedFiles.length, 1);
    // No actual writes in dry-run mode.
    assert.equal(writes.size, 0);
    // The applied map carries the would-be content.
    assert.ok(result.applied.get("/project/globals.gml")?.includes("global.score"));
});

void test("executeGlobalvarToGlobalCodemod requires writeFile in write mode", async () => {
    const engine = new Refactor.RefactorEngine();
    const files = new Map<string, string>([["/project/globals.gml", "globalvar score;\nscore = 0;\n"]]);

    await assert.rejects(
        () =>
            engine.executeGlobalvarToGlobalCodemod({
                filePaths: [...files.keys()],
                readFile: async (filePath) => files.get(filePath) ?? "",
                dryRun: false
            }),
        { message: "executeGlobalvarToGlobalCodemod requires a writeFile function in write mode" }
    );
});

void test("executeGlobalvarToGlobalCodemod de-duplicates repeated file paths", async () => {
    const engine = new Refactor.RefactorEngine();
    const source = "globalvar score;\nscore = 0;\n";
    const readCount = { value: 0 };

    const result = await engine.executeGlobalvarToGlobalCodemod({
        filePaths: ["/project/globals.gml", "/project/globals.gml"],
        readFile: async () => {
            readCount.value += 1;
            return source;
        },
        dryRun: true
    });

    // De-duplication: only one changed file entry even though path was listed twice.
    assert.equal(result.changedFiles.length, 1);
    assert.equal(readCount.value, 1);
});
