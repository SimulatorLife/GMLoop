import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
    batchValidateScopeConflicts,
    detectCircularRenames,
    detectCrossRenameNameConfusion,
    detectDuplicateSourceSymbolIds,
    detectDuplicateTargetNames,
    detectRenameConflicts,
    validateRenameStructure
} from "../src/rename/rename-validation.js";
import { ConflictType, type SymbolOccurrence, type SymbolResolver } from "../src/types.js";

void describe("validateRenameStructure", () => {
    void test("returns error for missing symbolId", async () => {
        const errors = await validateRenameStructure(null, "newName", null);
        assert.ok(errors.length > 0);
        assert.ok(errors[0].includes("symbolId"));
    });

    void test("returns error for undefined symbolId", async () => {
        const errors = await validateRenameStructure(undefined, "newName", null);
        assert.ok(errors.length > 0);
        assert.ok(errors[0].includes("symbolId"));
    });

    void test("returns error for empty symbolId", async () => {
        const errors = await validateRenameStructure("", "newName", null);
        assert.ok(errors.length > 0);
        assert.ok(errors[0].includes("symbolId"));
    });

    void test("returns error for non-string symbolId", async () => {
        const errors = await validateRenameStructure(123 as unknown as string, "newName", null);
        assert.ok(errors.length > 0);
        assert.ok(errors[0].includes("symbolId"));
    });

    void test("returns error for missing newName", async () => {
        const errors = await validateRenameStructure("gml/script/scr_test", null, null);
        assert.ok(errors.length > 0);
        assert.ok(errors[0].includes("newName"));
    });

    void test("returns error for undefined newName", async () => {
        const errors = await validateRenameStructure("gml/script/scr_test", undefined, null);
        assert.ok(errors.length > 0);
        assert.ok(errors[0].includes("newName"));
    });

    void test("returns error for empty newName", async () => {
        const errors = await validateRenameStructure("gml/script/scr_test", "", null);
        assert.ok(errors.length > 0);
        assert.ok(errors[0].includes("newName"));
    });

    void test("returns error for non-string newName", async () => {
        const errors = await validateRenameStructure("gml/script/scr_test", 456 as unknown as string, null);
        assert.ok(errors.length > 0);
        assert.ok(errors[0].includes("newName"));
    });

    void test("returns error for invalid identifier name", async () => {
        const errors = await validateRenameStructure("gml/script/scr_test", "123invalid", null);
        assert.ok(errors.length > 0);
        assert.ok(errors.some((e) => e.includes("Invalid") || e.includes("identifier") || e.includes("valid")));
    });

    void test("allows reserved keywords (semantic check happens later)", async () => {
        // validateRenameStructure only checks syntax, not semantics
        // Reserved keyword checking is done by detectRenameConflicts
        const errors = await validateRenameStructure("gml/script/scr_test", "if", null);
        assert.deepEqual(errors, []);
    });

    void test("returns error when new name matches old name", async () => {
        const errors = await validateRenameStructure("gml/script/scr_test", "scr_test", null);
        assert.ok(errors.length > 0);
        assert.ok(errors[0].includes("matches"));
    });

    void test("returns error when symbol not found", async () => {
        const resolver: Partial<SymbolResolver> = {
            hasSymbol: async () => false
        };

        const errors = await validateRenameStructure("gml/script/scr_missing", "scr_new", resolver);
        assert.ok(errors.length > 0);
        assert.ok(errors[0].includes("not found"));
    });

    void test("returns empty array for valid rename without resolver", async () => {
        const errors = await validateRenameStructure("gml/script/scr_test", "scr_new", null);
        assert.deepEqual(errors, []);
    });

    void test("returns empty array for valid rename with resolver that finds symbol", async () => {
        const resolver: Partial<SymbolResolver> = {
            hasSymbol: async () => true
        };

        const errors = await validateRenameStructure("gml/script/scr_test", "scr_new", resolver);
        assert.deepEqual(errors, []);
    });

    void test("skips existence check when resolver lacks hasSymbol", async () => {
        const resolver: Partial<SymbolResolver> = {
            lookup: async (name: string) => ({ name })
        };

        const errors = await validateRenameStructure("gml/script/scr_test", "scr_new", resolver);
        assert.deepEqual(errors, []);
    });

    void test("validates identifier syntax before checking existence", async () => {
        const resolver: Partial<SymbolResolver> = {
            hasSymbol: async () => {
                throw new Error("Should not be called for invalid identifier");
            }
        };

        const errors = await validateRenameStructure("gml/script/scr_test", "123invalid", resolver);
        assert.ok(errors.length > 0);
        assert.ok(errors.some((e) => e.includes("Invalid") || e.includes("identifier")));
    });

    void test("handles complex symbol IDs correctly", async () => {
        const resolver: Partial<SymbolResolver> = {
            hasSymbol: async () => true
        };

        const errors = await validateRenameStructure("gml/var/obj_player::hp", "max_hp", resolver);
        assert.deepEqual(errors, []);
    });

    void test("extracts name correctly from symbolId", async () => {
        const errors = await validateRenameStructure("gml/script/path/to/scr_nested", "scr_nested", null);
        assert.ok(errors.length > 0);
        assert.ok(errors[0].includes("matches"));
    });

    void test("handles whitespace-only names", async () => {
        const errors = await validateRenameStructure("gml/script/scr_test", "   ", null);
        assert.ok(errors.length > 0);
        assert.ok(errors.some((e) => e.includes("whitespace") || e.includes("empty")));
    });

    void test("accepts valid GML identifiers", async () => {
        const testCases = ["validName", "Valid_Name_123", "_privateVar", "CamelCase", "snake_case"];

        const results = await Promise.all(
            testCases.map(async (name) => ({
                name,
                errors: await validateRenameStructure("gml/script/scr_test", name, null)
            }))
        );

        for (const { name, errors } of results) {
            assert.deepEqual(errors, [], `Expected no errors for valid identifier: ${name}`);
        }
    });

    void test("rejects identifiers starting with numbers", async () => {
        const errors = await validateRenameStructure("gml/script/scr_test", "123test", null);
        assert.ok(errors.length > 0);
    });

    void test("rejects identifiers with special characters", async () => {
        const testCases = ["test-name", "test.name", "test@name", "test#name"];

        const results = await Promise.all(
            testCases.map(async (name) => ({
                name,
                errors: await validateRenameStructure("gml/script/scr_test", name, null)
            }))
        );

        for (const { name, errors } of results) {
            assert.ok(errors.length > 0, `Expected errors for invalid identifier: ${name}`);
        }
    });

    void test("returns early on structural errors without calling resolver", async () => {
        let resolverCalled = false;
        const resolver: Partial<SymbolResolver> = {
            hasSymbol: async () => {
                resolverCalled = true;
                return true;
            }
        };

        await validateRenameStructure(null, "newName", resolver);
        assert.equal(resolverCalled, false, "Resolver should not be called when symbolId is invalid");
    });

    void test("supports async resolver", async () => {
        const resolver: Partial<SymbolResolver> = {
            hasSymbol: async (symbolId: string) => {
                await new Promise((resolve) => setTimeout(resolve, 1));
                return symbolId === "gml/script/scr_exists";
            }
        };

        const errors1 = await validateRenameStructure("gml/script/scr_exists", "scr_new", resolver);
        assert.deepEqual(errors1, []);

        const errors2 = await validateRenameStructure("gml/script/scr_missing", "scr_new", resolver);
        assert.ok(errors2.length > 0);
        assert.ok(errors2[0].includes("not found"));
    });
});

void describe("batchValidateScopeConflicts", () => {
    void test("returns empty map when no resolver provided", async () => {
        const occurrences: Array<SymbolOccurrence> = [{ path: "test.gml", start: 0, end: 10, scopeId: "scope1" }];

        const conflicts = await batchValidateScopeConflicts(occurrences, "newName", null);
        assert.equal(conflicts.size, 0);
    });

    void test("returns empty map when resolver lacks lookup function", async () => {
        const occurrences: Array<SymbolOccurrence> = [{ path: "test.gml", start: 0, end: 10, scopeId: "scope1" }];

        const resolver: Partial<SymbolResolver> = {
            hasSymbol: async () => true
        };

        const conflicts = await batchValidateScopeConflicts(occurrences, "newName", resolver);
        assert.equal(conflicts.size, 0);
    });

    void test("returns empty map for empty occurrences array", async () => {
        const resolver: Partial<SymbolResolver> = {
            lookup: async () => null
        };

        const conflicts = await batchValidateScopeConflicts([], "newName", resolver);
        assert.equal(conflicts.size, 0);
    });

    void test("returns empty map when new name is invalid identifier", async () => {
        const occurrences: Array<SymbolOccurrence> = [{ path: "test.gml", start: 0, end: 10, scopeId: "scope1" }];

        const resolver: Partial<SymbolResolver> = {
            lookup: async () => ({ name: "existing" })
        };

        const conflicts = await batchValidateScopeConflicts(occurrences, "123invalid", resolver);
        assert.equal(conflicts.size, 0);
    });

    void test("detects conflict when name exists in scope", async () => {
        const occurrences: Array<SymbolOccurrence> = [{ path: "test.gml", start: 0, end: 10, scopeId: "scope1" }];

        const resolver: Partial<SymbolResolver> = {
            lookup: async (name: string, scopeId?: string) => {
                if (name === "existingName" && scopeId === "scope1") {
                    return { name: "existingName" };
                }
                return null;
            }
        };

        const conflicts = await batchValidateScopeConflicts(occurrences, "existingName", resolver);
        assert.equal(conflicts.size, 1);
        assert.ok(conflicts.has("scope1"));

        const conflict = conflicts.get("scope1");
        assert.ok(conflict);
        assert.ok(conflict.message.includes("existingName"));
        assert.equal(conflict.existingSymbol, "existingName");
    });

    void test("groups occurrences by scope and validates once per scope", async () => {
        const occurrences: Array<SymbolOccurrence> = [
            { path: "test1.gml", start: 0, end: 10, scopeId: "scope1" },
            { path: "test1.gml", start: 20, end: 30, scopeId: "scope1" },
            { path: "test2.gml", start: 0, end: 10, scopeId: "scope2" }
        ];

        let lookupCount = 0;
        const resolver: Partial<SymbolResolver> = {
            lookup: async () => {
                lookupCount++;
                return null;
            }
        };

        await batchValidateScopeConflicts(occurrences, "newName", resolver);
        assert.equal(lookupCount, 2, "Should only lookup once per unique scope");
    });

    void test("handles global scope (undefined scopeId)", async () => {
        const occurrences: Array<SymbolOccurrence> = [{ path: "test.gml", start: 0, end: 10 }];

        let calledWithUndefined = false;
        const resolver: Partial<SymbolResolver> = {
            lookup: async (name: string, scopeId?: string) => {
                if (scopeId === undefined) {
                    calledWithUndefined = true;
                }
                return null;
            }
        };

        await batchValidateScopeConflicts(occurrences, "newName", resolver);
        assert.ok(calledWithUndefined, "Should call lookup with undefined for global scope");
    });

    void test("detects conflicts in multiple scopes", async () => {
        const occurrences: Array<SymbolOccurrence> = [
            { path: "test1.gml", start: 0, end: 10, scopeId: "scope1" },
            { path: "test2.gml", start: 0, end: 10, scopeId: "scope2" }
        ];

        const resolver: Partial<SymbolResolver> = {
            lookup: async (name: string, scopeId?: string) => {
                if (name === "conflictName" && (scopeId === "scope1" || scopeId === "scope2")) {
                    return { name: "conflictName" };
                }
                return null;
            }
        };

        const conflicts = await batchValidateScopeConflicts(occurrences, "conflictName", resolver);
        assert.equal(conflicts.size, 2);
        assert.ok(conflicts.has("scope1"));
        assert.ok(conflicts.has("scope2"));
    });

    void test("returns no conflicts when name is safe in all scopes", async () => {
        const occurrences: Array<SymbolOccurrence> = [
            { path: "test1.gml", start: 0, end: 10, scopeId: "scope1" },
            { path: "test2.gml", start: 0, end: 10, scopeId: "scope2" },
            { path: "test3.gml", start: 0, end: 10, scopeId: "scope3" }
        ];

        const resolver: Partial<SymbolResolver> = {
            lookup: async () => null
        };

        const conflicts = await batchValidateScopeConflicts(occurrences, "safeName", resolver);
        assert.equal(conflicts.size, 0);
    });

    void test("normalizes identifier name before checking", async () => {
        const occurrences: Array<SymbolOccurrence> = [{ path: "test.gml", start: 0, end: 10, scopeId: "scope1" }];

        let checkedName: string | undefined;
        const resolver: Partial<SymbolResolver> = {
            lookup: async (name: string) => {
                checkedName = name;
                return null;
            }
        };

        await batchValidateScopeConflicts(occurrences, "validName", resolver);
        assert.equal(checkedName, "validName");
    });

    void test("handles mixed scoped and unscoped occurrences", async () => {
        const occurrences: Array<SymbolOccurrence> = [
            { path: "test1.gml", start: 0, end: 10, scopeId: "scope1" },
            { path: "test2.gml", start: 0, end: 10 },
            { path: "test3.gml", start: 0, end: 10, scopeId: "scope2" }
        ];

        const scopesChecked: Array<string | undefined> = [];
        const resolver: Partial<SymbolResolver> = {
            lookup: async (name: string, scopeId?: string) => {
                scopesChecked.push(scopeId);
                return null;
            }
        };

        await batchValidateScopeConflicts(occurrences, "newName", resolver);
        assert.equal(scopesChecked.length, 3);
        assert.ok(scopesChecked.includes("scope1"));
        assert.ok(scopesChecked.includes("scope2"));
        assert.ok(scopesChecked.includes(undefined));
    });
});

void describe("detectRenameConflicts", () => {
    void test("deduplicates shadow conflicts per file in the same scope", async () => {
        const occurrences: Array<SymbolOccurrence> = [
            { path: "scripts/player.gml", start: 0, end: 5, scopeId: "scope-1" },
            { path: "scripts/player.gml", start: 10, end: 15, scopeId: "scope-1" }
        ];

        const resolver: Partial<SymbolResolver> = {
            lookup: async () => ({ name: "existing" })
        };

        const conflicts = await detectRenameConflicts("old_name", "new_name", occurrences, resolver, null);

        assert.equal(conflicts.length, 1);
        assert.equal(conflicts[0].type, ConflictType.SHADOW);
        assert.equal(conflicts[0].path, "scripts/player.gml");
    });
});

// ---------------------------------------------------------------------------
// detectDuplicateSourceSymbolIds
// ---------------------------------------------------------------------------

void describe("detectDuplicateSourceSymbolIds", () => {
    void test("returns empty array when all symbolIds are unique", () => {
        const result = detectDuplicateSourceSymbolIds([
            { symbolId: "gml/script/scr_a", newName: "scr_x" },
            { symbolId: "gml/script/scr_b", newName: "scr_y" }
        ]);
        assert.deepEqual(result, []);
    });

    void test("returns empty array for a single rename", () => {
        const result = detectDuplicateSourceSymbolIds([{ symbolId: "gml/script/scr_a", newName: "scr_x" }]);
        assert.deepEqual(result, []);
    });

    void test("returns empty array for empty input", () => {
        assert.deepEqual(detectDuplicateSourceSymbolIds([]), []);
    });

    void test("detects a symbolId that appears twice", () => {
        const result = detectDuplicateSourceSymbolIds([
            { symbolId: "gml/script/scr_a", newName: "scr_x" },
            { symbolId: "gml/script/scr_a", newName: "scr_y" }
        ]);
        assert.equal(result.length, 1);
        assert.equal(result[0].symbolId, "gml/script/scr_a");
        assert.equal(result[0].count, 2);
    });

    void test("detects a symbolId that appears three times", () => {
        const result = detectDuplicateSourceSymbolIds([
            { symbolId: "gml/script/scr_a", newName: "scr_x" },
            { symbolId: "gml/script/scr_a", newName: "scr_y" },
            { symbolId: "gml/script/scr_a", newName: "scr_z" }
        ]);
        assert.equal(result.length, 1);
        assert.equal(result[0].count, 3);
    });

    void test("detects multiple duplicated symbolIds", () => {
        const result = detectDuplicateSourceSymbolIds([
            { symbolId: "gml/script/scr_a", newName: "scr_x" },
            { symbolId: "gml/script/scr_b", newName: "scr_y" },
            { symbolId: "gml/script/scr_a", newName: "scr_z" },
            { symbolId: "gml/script/scr_b", newName: "scr_w" }
        ]);
        assert.equal(result.length, 2);
        const ids = result.map((e) => e.symbolId).sort();
        assert.deepEqual(ids, ["gml/script/scr_a", "gml/script/scr_b"]);
    });

    void test("skips entries with non-string symbolId", () => {
        const malformed = [
            { symbolId: null as unknown as string, newName: "scr_x" },
            { symbolId: "gml/script/scr_a", newName: "scr_y" }
        ];
        const result = detectDuplicateSourceSymbolIds(malformed);
        assert.deepEqual(result, []);
    });
});

// ---------------------------------------------------------------------------
// detectDuplicateTargetNames
// ---------------------------------------------------------------------------

void describe("detectDuplicateTargetNames", () => {
    void test("returns empty array when all new names are unique", () => {
        const result = detectDuplicateTargetNames([
            { symbolId: "gml/script/scr_a", newName: "scr_x" },
            { symbolId: "gml/script/scr_b", newName: "scr_y" }
        ]);
        assert.deepEqual(result, []);
    });

    void test("returns empty array for a single rename", () => {
        const result = detectDuplicateTargetNames([{ symbolId: "gml/script/scr_a", newName: "scr_x" }]);
        assert.deepEqual(result, []);
    });

    void test("returns empty array for empty input", () => {
        assert.deepEqual(detectDuplicateTargetNames([]), []);
    });

    void test("detects two symbols renamed to the same target name", () => {
        const result = detectDuplicateTargetNames([
            { symbolId: "gml/script/scr_a", newName: "scr_collision" },
            { symbolId: "gml/script/scr_b", newName: "scr_collision" }
        ]);
        assert.equal(result.length, 1);
        assert.equal(result[0].newName, "scr_collision");
        assert.deepEqual([...result[0].symbolIds].sort(), ["gml/script/scr_a", "gml/script/scr_b"]);
    });

    void test("skips entries with invalid (non-normalizable) newName", () => {
        const result = detectDuplicateTargetNames([
            { symbolId: "gml/script/scr_a", newName: "123invalid" },
            { symbolId: "gml/script/scr_b", newName: "123invalid" }
        ]);
        // Both entries fail normalisation so neither should be counted.
        assert.deepEqual(result, []);
    });

    void test("skips malformed entries (missing symbolId or newName)", () => {
        const malformed = [
            { symbolId: null as unknown as string, newName: "scr_collision" },
            { symbolId: "gml/script/scr_b", newName: null as unknown as string }
        ];
        const result = detectDuplicateTargetNames(malformed);
        assert.deepEqual(result, []);
    });

    void test("reports three symbols all targeting the same new name", () => {
        const result = detectDuplicateTargetNames([
            { symbolId: "gml/script/scr_a", newName: "scr_collision" },
            { symbolId: "gml/script/scr_b", newName: "scr_collision" },
            { symbolId: "gml/script/scr_c", newName: "scr_collision" }
        ]);
        assert.equal(result.length, 1);
        assert.equal(result[0].symbolIds.length, 3);
    });
});

// ---------------------------------------------------------------------------
// detectCrossRenameNameConfusion
// ---------------------------------------------------------------------------

void describe("detectCrossRenameNameConfusion", () => {
    void test("returns empty array when no new name matches an old name", () => {
        const result = detectCrossRenameNameConfusion([
            { symbolId: "gml/script/scr_a", newName: "scr_x" },
            { symbolId: "gml/script/scr_b", newName: "scr_y" }
        ]);
        assert.deepEqual(result, []);
    });

    void test("returns empty array for a single rename", () => {
        const result = detectCrossRenameNameConfusion([{ symbolId: "gml/script/scr_a", newName: "scr_x" }]);
        assert.deepEqual(result, []);
    });

    void test("returns empty array for empty input", () => {
        assert.deepEqual(detectCrossRenameNameConfusion([]), []);
    });

    void test("detects foo→bar when bar→baz is also in the batch", () => {
        // scr_a→scr_b and scr_b→scr_c: 'scr_b' is both a new name and an old name.
        const result = detectCrossRenameNameConfusion([
            { symbolId: "gml/script/scr_a", newName: "scr_b" },
            { symbolId: "gml/script/scr_b", newName: "scr_c" }
        ]);
        assert.equal(result.length, 1);
        assert.equal(result[0].symbolId, "gml/script/scr_a");
        assert.equal(result[0].newName, "scr_b");
    });

    void test("does not flag a same-symbol rename as confusion", () => {
        // scr_a→scr_a: this would normally be caught as same-name; should not produce confusion.
        const result = detectCrossRenameNameConfusion([{ symbolId: "gml/script/scr_a", newName: "scr_a" }]);
        assert.deepEqual(result, []);
    });

    void test("does not include entries whose new name fails normalisation", () => {
        const result = detectCrossRenameNameConfusion([
            { symbolId: "gml/script/scr_a", newName: "123bad" },
            { symbolId: "gml/script/scr_b", newName: "scr_c" }
        ]);
        assert.deepEqual(result, []);
    });

    void test("flags both directions of a circular rename as confusing", () => {
        // A true circular rename (A→B, B→A) should be detected by detectCircularRenames,
        // and detectCrossRenameNameConfusion should also flag both directions.
        const renames = [
            { symbolId: "gml/script/scr_a", newName: "scr_b" },
            { symbolId: "gml/script/scr_b", newName: "scr_a" }
        ];
        const circular = detectCircularRenames(renames);
        assert.ok(circular.length > 0, "detectCircularRenames should detect the cycle");

        const confusion = detectCrossRenameNameConfusion(renames);
        // Both scr_a→scr_b (scr_b is an old name) and scr_b→scr_a (scr_a is an old name)
        // should be flagged as confusing.
        assert.equal(confusion.length, 2);
    });
});
