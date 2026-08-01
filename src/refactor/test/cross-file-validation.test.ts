import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { validateCrossFileConsistency } from "../src/rename/rename-validation.js";
import { ConflictType, type FileSymbolProvider, type SymbolOccurrence } from "../src/types.js";

void describe("validateCrossFileConsistency", () => {
    void it("returns empty array without file provider", async () => {
        const occurrences: Array<SymbolOccurrence> = [{ path: "file1.gml", start: 0, end: 10 }];
        const errors = await validateCrossFileConsistency("gml/script/scr_test", "scr_renamed", occurrences, null);
        assert.equal(errors.length, 0);
    });

    void it("returns empty array when file provider lacks getFileSymbols", async () => {
        const occurrences: Array<SymbolOccurrence> = [{ path: "file1.gml", start: 0, end: 10 }];
        const provider: Partial<FileSymbolProvider> = {};
        const errors = await validateCrossFileConsistency("gml/script/scr_test", "scr_renamed", occurrences, provider);
        assert.equal(errors.length, 0);
    });

    void it("returns empty array for empty occurrences", async () => {
        const provider: Partial<FileSymbolProvider> = { getFileSymbols: async () => [] };
        const errors = await validateCrossFileConsistency("gml/script/scr_test", "scr_renamed", [], provider);
        assert.equal(errors.length, 0);
    });

    void it("detects conflicting symbol in same file", async () => {
        const occurrences: Array<SymbolOccurrence> = [
            { path: "file1.gml", start: 0, end: 10 },
            { path: "file1.gml", start: 50, end: 60 }
        ];
        const provider: Partial<FileSymbolProvider> = {
            getFileSymbols: async (path: string) => {
                if (path === "file1.gml") {
                    return [{ id: "gml/script/scr_test" }, { id: "gml/script/scr_renamed" }];
                }
                return [];
            }
        };
        const errors = await validateCrossFileConsistency("gml/script/scr_test", "scr_renamed", occurrences, provider);
        assert.equal(errors.length, 1);
        assert.equal(errors[0].type, ConflictType.SHADOW);
        assert.ok(errors[0].message.includes("scr_renamed"));
        assert.ok(errors[0].message.includes("file1.gml"));
    });

    void it("allows rename when no conflicts exist", async () => {
        const occurrences: Array<SymbolOccurrence> = [
            { path: "file1.gml", start: 0, end: 10 },
            { path: "file2.gml", start: 20, end: 30 }
        ];
        const provider: Partial<FileSymbolProvider> = {
            getFileSymbols: async (path: string) => {
                if (path === "file1.gml") return [{ id: "gml/script/scr_test" }];
                if (path === "file2.gml") return [{ id: "gml/script/scr_other" }];
                return [];
            }
        };
        const errors = await validateCrossFileConsistency("gml/script/scr_test", "scr_renamed", occurrences, provider);
        assert.equal(errors.length, 0);
    });

    void it("warns about large rename operations", async () => {
        const occurrences: Array<SymbolOccurrence> = [];
        for (let i = 0; i < 25; i++) {
            occurrences.push({ path: "file1.gml", start: i * 10, end: i * 10 + 5 });
        }
        const provider: Partial<FileSymbolProvider> = { getFileSymbols: async () => [{ id: "gml/script/scr_test" }] };
        const errors = await validateCrossFileConsistency("gml/script/scr_test", "scr_renamed", occurrences, provider);
        assert.equal(errors.length, 1);
        assert.equal(errors[0].type, ConflictType.LARGE_RENAME);
        assert.ok(errors[0].message.includes("25 occurrences"));
        assert.equal(errors[0].severity, "warning");
    });

    void it("skips occurrences without path", async () => {
        const occurrences: Array<SymbolOccurrence> = [
            { path: "file1.gml", start: 0, end: 10 },
            { path: "", start: 20, end: 30 }
        ];
        const provider: Partial<FileSymbolProvider> = { getFileSymbols: async () => [{ id: "gml/script/scr_test" }] };
        const errors = await validateCrossFileConsistency("gml/script/scr_test", "scr_renamed", occurrences, provider);
        assert.equal(errors.length, 0);
    });

    void it("handles multiple files with different conflict states", async () => {
        const occurrences: Array<SymbolOccurrence> = [
            { path: "file1.gml", start: 0, end: 10 },
            { path: "file2.gml", start: 20, end: 30 }
        ];
        const provider: Partial<FileSymbolProvider> = {
            getFileSymbols: async (path: string) => {
                if (path === "file1.gml") {
                    return [{ id: "gml/script/scr_test" }, { id: "gml/script/scr_renamed" }];
                }
                if (path === "file2.gml") return [{ id: "gml/script/scr_test" }];
                return [];
            }
        };
        const errors = await validateCrossFileConsistency("gml/script/scr_test", "scr_renamed", occurrences, provider);
        assert.equal(errors.length, 1);
        assert.ok(errors[0].path === "file1.gml");
    });

    void it("returns error for invalid identifier name", async () => {
        const occurrences: Array<SymbolOccurrence> = [{ path: "file1.gml", start: 0, end: 10 }];
        const provider: Partial<FileSymbolProvider> = { getFileSymbols: async () => [] };
        const errors = await validateCrossFileConsistency("gml/script/scr_test", "123invalid", occurrences, provider);
        assert.equal(errors.length, 1);
        assert.equal(errors[0].type, ConflictType.INVALID_IDENTIFIER);
    });

    void it("handles missing symbolId parameter", async () => {
        const occurrences: Array<SymbolOccurrence> = [{ path: "file1.gml", start: 0, end: 10 }];
        const provider: Partial<FileSymbolProvider> = { getFileSymbols: async () => [] };
        const errors = await validateCrossFileConsistency("", "scr_renamed", occurrences, provider);
        assert.equal(errors.length, 0);
    });

    void it("ignores symbol being renamed when checking conflicts", async () => {
        const occurrences: Array<SymbolOccurrence> = [{ path: "file1.gml", start: 0, end: 10 }];
        const provider: Partial<FileSymbolProvider> = {
            getFileSymbols: async () => [{ id: "gml/script/scr_test" }, { id: "gml/var/other_var" }]
        };
        const errors = await validateCrossFileConsistency("gml/script/scr_test", "scr_renamed", occurrences, provider);
        assert.equal(errors.length, 0);
    });
});
