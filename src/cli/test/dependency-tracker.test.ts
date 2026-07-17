/**
 * Tests for dependency tracker module.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DependencyTracker } from "../src/modules/transpilation/dependency-tracker.js";

void describe("DependencyTracker", () => {
    void describe("registerFileDefines", () => {
        void it("should register symbols defined by a file", () => {
            const tracker = new DependencyTracker();
            tracker.registerFileDefines("scripts/player.gml", ["gml_Script_player_move", "gml_Script_player_jump"]);

            const defs = tracker.getFileDefinitions("scripts/player.gml");
            assert.deepEqual([...defs].toSorted(), ["gml_Script_player_jump", "gml_Script_player_move"]);
        });

        void it("should update symbol-to-file mapping", () => {
            const tracker = new DependencyTracker();
            tracker.registerFileDefines("scripts/player.gml", ["gml_Script_player_move"]);

            const snapshot = tracker.getSnapshot();
            assert.equal(snapshot.symbolToDefFile.get("gml_Script_player_move"), "scripts/player.gml");
        });

        void it("should accumulate definitions for multiple calls on same file", () => {
            const tracker = new DependencyTracker();
            tracker.registerFileDefines("scripts/player.gml", ["gml_Script_player_move"]);
            tracker.registerFileDefines("scripts/player.gml", ["gml_Script_player_jump"]);

            const defs = tracker.getFileDefinitions("scripts/player.gml");
            assert.equal(defs.length, 2);
            assert.ok(defs.includes("gml_Script_player_move"));
            assert.ok(defs.includes("gml_Script_player_jump"));
        });
    });

    void describe("replaceFileDefines", () => {
        void it("should replace existing definitions for a file", () => {
            const tracker = new DependencyTracker();
            tracker.registerFileDefines("scripts/player.gml", ["gml_Script_player_move", "gml_Script_player_jump"]);

            tracker.replaceFileDefines("scripts/player.gml", ["gml_Script_player_dash"]);

            const defs = tracker.getFileDefinitions("scripts/player.gml");
            assert.deepEqual(defs, ["gml_Script_player_dash"]);

            const snapshot = tracker.getSnapshot();
            assert.equal(snapshot.symbolToDefFile.has("gml_Script_player_move"), false);
            assert.equal(snapshot.symbolToDefFile.has("gml_Script_player_jump"), false);
        });

        void it("should clear definitions when replacement is empty", () => {
            const tracker = new DependencyTracker();
            tracker.registerFileDefines("scripts/player.gml", ["gml_Script_player_move"]);

            tracker.replaceFileDefines("scripts/player.gml", []);

            assert.deepEqual(tracker.getFileDefinitions("scripts/player.gml"), []);

            const snapshot = tracker.getSnapshot();
            assert.equal(snapshot.symbolToDefFile.has("gml_Script_player_move"), false);
        });
    });

    void describe("registerFileReferences", () => {
        void it("should register symbols referenced by a file", () => {
            const tracker = new DependencyTracker();
            tracker.registerFileReferences("scripts/enemy.gml", ["gml_Script_player_move"]);

            const refs = tracker.getFileReferences("scripts/enemy.gml");
            assert.deepEqual(refs, ["gml_Script_player_move"]);
        });

        void it("should update symbol-to-referencing-files mapping", () => {
            const tracker = new DependencyTracker();
            tracker.registerFileReferences("scripts/enemy.gml", ["gml_Script_player_move"]);

            const snapshot = tracker.getSnapshot();
            const refFiles = snapshot.symbolToRefFiles.get("gml_Script_player_move");
            assert.ok(refFiles);
            assert.ok(refFiles.has("scripts/enemy.gml"));
        });

        void it("should track multiple files referencing same symbol", () => {
            const tracker = new DependencyTracker();
            tracker.registerFileReferences("scripts/enemy.gml", ["gml_Script_player_move"]);
            tracker.registerFileReferences("scripts/boss.gml", ["gml_Script_player_move"]);

            const snapshot = tracker.getSnapshot();
            const refFiles = snapshot.symbolToRefFiles.get("gml_Script_player_move");
            assert.ok(refFiles);
            assert.equal(refFiles.size, 2);
            assert.ok(refFiles.has("scripts/enemy.gml"));
            assert.ok(refFiles.has("scripts/boss.gml"));
        });
    });

    void describe("replaceFileReferences", () => {
        void it("should replace existing references for a file", () => {
            const tracker = new DependencyTracker();
            tracker.registerFileReferences("scripts/enemy.gml", ["gml_Script_player_move", "gml_Script_player_jump"]);

            tracker.replaceFileReferences("scripts/enemy.gml", ["gml_Script_player_dash"]);

            const refs = tracker.getFileReferences("scripts/enemy.gml");
            assert.deepEqual(refs, ["gml_Script_player_dash"]);

            const snapshot = tracker.getSnapshot();
            assert.equal(snapshot.symbolToRefFiles.has("gml_Script_player_move"), false);
            assert.equal(snapshot.symbolToRefFiles.has("gml_Script_player_jump"), false);
        });

        void it("should clear references when replacement is empty", () => {
            const tracker = new DependencyTracker();
            tracker.registerFileReferences("scripts/enemy.gml", ["gml_Script_player_move"]);

            tracker.replaceFileReferences("scripts/enemy.gml", []);

            assert.deepEqual(tracker.getFileReferences("scripts/enemy.gml"), []);

            const snapshot = tracker.getSnapshot();
            assert.equal(snapshot.symbolToRefFiles.has("gml_Script_player_move"), false);
        });
    });

    void describe("getDependentFiles", () => {
        void it("should return files that reference symbols defined in the changed file", () => {
            const tracker = new DependencyTracker();
            tracker.registerFileDefines("scripts/player.gml", ["gml_Script_player_move"]);
            tracker.registerFileReferences("scripts/enemy.gml", ["gml_Script_player_move"]);

            const dependents = tracker.getDependentFiles("scripts/player.gml");
            assert.deepEqual(dependents, ["scripts/enemy.gml"]);
        });

        void it("should return multiple dependent files", () => {
            const tracker = new DependencyTracker();
            tracker.registerFileDefines("scripts/player.gml", ["gml_Script_player_move"]);
            tracker.registerFileReferences("scripts/enemy.gml", ["gml_Script_player_move"]);
            tracker.registerFileReferences("scripts/boss.gml", ["gml_Script_player_move"]);

            const dependents = tracker.getDependentFiles("scripts/player.gml");
            assert.equal(dependents.length, 2);
            assert.ok(dependents.includes("scripts/enemy.gml"));
            assert.ok(dependents.includes("scripts/boss.gml"));
        });

        void it("should return dependents for files defining multiple symbols", () => {
            const tracker = new DependencyTracker();
            tracker.registerFileDefines("scripts/player.gml", ["gml_Script_player_move", "gml_Script_player_jump"]);
            tracker.registerFileReferences("scripts/enemy.gml", ["gml_Script_player_move"]);
            tracker.registerFileReferences("scripts/boss.gml", ["gml_Script_player_jump"]);

            const dependents = tracker.getDependentFiles("scripts/player.gml");
            assert.equal(dependents.length, 2);
            assert.ok(dependents.includes("scripts/enemy.gml"));
            assert.ok(dependents.includes("scripts/boss.gml"));
        });

        void it("should return empty array for file with no dependencies", () => {
            const tracker = new DependencyTracker();
            tracker.registerFileDefines("scripts/player.gml", ["gml_Script_player_move"]);

            const dependents = tracker.getDependentFiles("scripts/player.gml");
            assert.deepEqual(dependents, []);
        });

        void it("should return empty array for unknown file", () => {
            const tracker = new DependencyTracker();
            const dependents = tracker.getDependentFiles("scripts/unknown.gml");
            assert.deepEqual(dependents, []);
        });

        void it("should not include the file itself in dependents", () => {
            const tracker = new DependencyTracker();
            tracker.registerFileDefines("scripts/player.gml", ["gml_Script_player_move"]);
            tracker.registerFileReferences("scripts/player.gml", ["gml_Script_player_move"]);

            const dependents = tracker.getDependentFiles("scripts/player.gml");
            assert.deepEqual(dependents, []);
        });
    });

    void describe("getFilesReferencingSymbols", () => {
        void it("returns files that reference any requested symbol", () => {
            const tracker = new DependencyTracker();
            tracker.registerFileReferences("scripts/enemy.gml", ["gml_Script_player_move"]);
            tracker.registerFileReferences("scripts/boss.gml", ["gml_Script_player_jump"]);

            const dependents = tracker.getFilesReferencingSymbols(["gml_Script_player_move", "gml_Script_player_jump"]);

            assert.equal(dependents.length, 2);
            assert.ok(dependents.includes("scripts/enemy.gml"));
            assert.ok(dependents.includes("scripts/boss.gml"));
        });

        void it("deduplicates files that reference multiple requested symbols", () => {
            const tracker = new DependencyTracker();
            tracker.registerFileReferences("scripts/enemy.gml", ["gml_Script_player_move", "gml_Script_player_jump"]);

            const dependents = tracker.getFilesReferencingSymbols(["gml_Script_player_move", "gml_Script_player_jump"]);

            assert.deepEqual(dependents, ["scripts/enemy.gml"]);
        });

        void it("supports excluding a specific file from the result", () => {
            const tracker = new DependencyTracker();
            tracker.registerFileReferences("scripts/player.gml", ["gml_Script_player_move"]);
            tracker.registerFileReferences("scripts/enemy.gml", ["gml_Script_player_move"]);

            const dependents = tracker.getFilesReferencingSymbols(["gml_Script_player_move"], "scripts/player.gml");

            assert.deepEqual(dependents, ["scripts/enemy.gml"]);
        });

        void it("returns empty array for empty symbol input", () => {
            const tracker = new DependencyTracker();

            const dependents = tracker.getFilesReferencingSymbols([]);
            assert.deepEqual(dependents, []);
        });

        void it("follows transitive compile-time macro dependencies", () => {
            const tracker = new DependencyTracker();
            tracker.registerFileDefines("scripts/constants.gml", ["gml/macro/BASE"]);
            tracker.registerFileDefines("scripts/derived.gml", ["gml/macro/DERIVED"]);
            tracker.registerFileReferences("scripts/derived.gml", ["gml/macro/BASE"]);
            tracker.registerFileReferences("scripts/consumer.gml", ["gml/macro/DERIVED"]);

            const dependents = tracker.getTransitiveFilesReferencingSymbols(["gml/macro/BASE"]);

            assert.deepEqual(dependents, ["scripts/derived.gml", "scripts/consumer.gml"]);
        });
    });

    void describe("removeFile", () => {
        void it("should remove file definitions", () => {
            const tracker = new DependencyTracker();
            tracker.registerFileDefines("scripts/player.gml", ["gml_Script_player_move"]);
            tracker.removeFile("scripts/player.gml");

            const defs = tracker.getFileDefinitions("scripts/player.gml");
            assert.deepEqual(defs, []);
        });

        void it("should remove file references", () => {
            const tracker = new DependencyTracker();
            tracker.registerFileReferences("scripts/enemy.gml", ["gml_Script_player_move"]);
            tracker.removeFile("scripts/enemy.gml");

            const refs = tracker.getFileReferences("scripts/enemy.gml");
            assert.deepEqual(refs, []);
        });

        void it("should update symbol-to-file mappings when removing definitions", () => {
            const tracker = new DependencyTracker();
            tracker.registerFileDefines("scripts/player.gml", ["gml_Script_player_move"]);
            tracker.removeFile("scripts/player.gml");

            const snapshot = tracker.getSnapshot();
            assert.equal(snapshot.symbolToDefFile.has("gml_Script_player_move"), false);
        });

        void it("should update symbol-to-referencing-files when removing references", () => {
            const tracker = new DependencyTracker();
            tracker.registerFileReferences("scripts/enemy.gml", ["gml_Script_player_move"]);
            tracker.removeFile("scripts/enemy.gml");

            const snapshot = tracker.getSnapshot();
            const refFiles = snapshot.symbolToRefFiles.get("gml_Script_player_move");
            assert.equal(refFiles, undefined);
        });

        void it("should handle removing non-existent file gracefully", () => {
            const tracker = new DependencyTracker();
            assert.doesNotThrow(() => {
                tracker.removeFile("scripts/nonexistent.gml");
            });
        });
    });

    void describe("clear", () => {
        void it("should clear all tracking data", () => {
            const tracker = new DependencyTracker();
            tracker.registerFileDefines("scripts/player.gml", ["gml_Script_player_move"]);
            tracker.registerFileReferences("scripts/enemy.gml", ["gml_Script_player_move"]);

            tracker.clear();

            const snapshot = tracker.getSnapshot();
            assert.equal(snapshot.fileToDefs.size, 0);
            assert.equal(snapshot.fileToRefs.size, 0);
            assert.equal(snapshot.symbolToDefFile.size, 0);
            assert.equal(snapshot.symbolToRefFiles.size, 0);
        });
    });

    void describe("getSnapshot", () => {
        void it("should return a copy of the dependency graph", () => {
            const tracker = new DependencyTracker();
            tracker.registerFileDefines("scripts/player.gml", ["gml_Script_player_move"]);

            const snapshot = tracker.getSnapshot();
            assert.ok(snapshot.fileToDefs.has("scripts/player.gml"));

            tracker.clear();
            assert.ok(snapshot.fileToDefs.has("scripts/player.gml"));
        });
    });

    void describe("getStatistics", () => {
        void it("should return zero statistics for empty tracker", () => {
            const tracker = new DependencyTracker();
            const stats = tracker.getStatistics();

            assert.equal(stats.totalFiles, 0);
            assert.equal(stats.totalSymbols, 0);
            assert.equal(stats.filesWithDefs, 0);
            assert.equal(stats.filesWithRefs, 0);
            assert.equal(stats.averageDefsPerFile, 0);
            assert.equal(stats.averageRefsPerFile, 0);
        });

        void it("should calculate correct statistics", () => {
            const tracker = new DependencyTracker();
            tracker.registerFileDefines("scripts/player.gml", ["gml_Script_player_move", "gml_Script_player_jump"]);
            tracker.registerFileDefines("scripts/enemy.gml", ["gml_Script_enemy_move"]);
            tracker.registerFileReferences("scripts/boss.gml", ["gml_Script_player_move"]);

            const stats = tracker.getStatistics();

            assert.equal(stats.totalFiles, 3);
            assert.equal(stats.totalSymbols, 3);
            assert.equal(stats.filesWithDefs, 2);
            assert.equal(stats.filesWithRefs, 1);
            assert.equal(stats.averageDefsPerFile, 1.5);
            assert.equal(stats.averageRefsPerFile, 1);
        });
    });

    void describe("complex dependency scenarios", () => {
        void it("should handle circular dependencies", () => {
            const tracker = new DependencyTracker();
            tracker.registerFileDefines("scripts/a.gml", ["gml_Script_a"]);
            tracker.registerFileReferences("scripts/a.gml", ["gml_Script_b"]);
            tracker.registerFileDefines("scripts/b.gml", ["gml_Script_b"]);
            tracker.registerFileReferences("scripts/b.gml", ["gml_Script_a"]);

            const aDependents = tracker.getDependentFiles("scripts/a.gml");
            const bDependents = tracker.getDependentFiles("scripts/b.gml");

            assert.deepEqual(aDependents, ["scripts/b.gml"]);
            assert.deepEqual(bDependents, ["scripts/a.gml"]);
        });

        void it("should handle transitive dependencies correctly", () => {
            const tracker = new DependencyTracker();
            tracker.registerFileDefines("scripts/utils.gml", ["gml_Script_util_func"]);
            tracker.registerFileReferences("scripts/player.gml", ["gml_Script_util_func"]);
            tracker.registerFileDefines("scripts/player.gml", ["gml_Script_player_move"]);
            tracker.registerFileReferences("scripts/enemy.gml", ["gml_Script_player_move"]);

            const utilsDependents = tracker.getDependentFiles("scripts/utils.gml");
            assert.deepEqual(utilsDependents, ["scripts/player.gml"]);

            const playerDependents = tracker.getDependentFiles("scripts/player.gml");
            assert.deepEqual(playerDependents, ["scripts/enemy.gml"]);
        });

        void it("should handle file redefining symbols", () => {
            const tracker = new DependencyTracker();
            tracker.registerFileDefines("scripts/old.gml", ["gml_Script_func"]);
            tracker.registerFileReferences("scripts/consumer.gml", ["gml_Script_func"]);

            // Remove old file - this clears the symbol definition
            tracker.removeFile("scripts/old.gml");

            // Register new file with same symbol
            tracker.registerFileDefines("scripts/new.gml", ["gml_Script_func"]);

            // The consumer still has its reference, so new definition finds it
            const newDependents = tracker.getDependentFiles("scripts/new.gml");
            assert.deepEqual(newDependents, ["scripts/consumer.gml"]);
        });
    });
});
