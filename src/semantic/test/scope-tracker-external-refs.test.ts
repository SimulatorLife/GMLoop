import assert from "node:assert/strict";
import test from "node:test";

import ScopeTracker from "../src/scopes/scope-tracker.js";

void test("getScopeExternalReferences returns references to symbols declared outside the scope", () => {
    const tracker = new ScopeTracker({ enabled: true });
    const rootScope = tracker.enterScope("program");

    tracker.declare(
        "globalVar",
        { start: { line: 1, index: 0 }, end: { line: 1, index: 9 } },
        { kind: "variable", tags: ["global"] }
    );

    const funcScope = tracker.enterScope("function");

    tracker.declare("localParam", { start: { line: 3, index: 0 }, end: { line: 3, index: 10 } }, { kind: "parameter" });

    tracker.reference("globalVar", { start: { line: 4, index: 0 }, end: { line: 4, index: 9 } }, { kind: "variable" });

    tracker.reference(
        "localParam",
        { start: { line: 5, index: 0 }, end: { line: 5, index: 10 } },
        { kind: "parameter" }
    );

    tracker.exitScope();
    tracker.exitScope();

    const externalRefs = tracker.getScopeExternalReferences(funcScope.id);

    assert.strictEqual(externalRefs.length, 1);
    assert.strictEqual(externalRefs[0].name, "globalVar");
    assert.strictEqual(externalRefs[0].declaringScopeId, rootScope.id);
    assert.strictEqual(externalRefs[0].referencingScopeId, funcScope.id);
    assert.deepStrictEqual(externalRefs[0].declaration, {
        name: "globalVar",
        scopeId: rootScope.id,
        classifications: ["identifier", "declaration", "variable", "global"],
        start: { line: 1, index: 0 },
        end: { line: 1, index: 9 }
    });
    assert.ok(externalRefs[0].occurrences.length > 0);
});

void test("getScopeExternalReferences handles nested scopes correctly", () => {
    const tracker = new ScopeTracker({ enabled: true });
    const rootScope = tracker.enterScope("program");

    tracker.declare("topLevel", { start: { line: 1, index: 0 }, end: { line: 1, index: 8 } }, { kind: "variable" });

    const outerScope = tracker.enterScope("function");

    tracker.declare("outerVar", { start: { line: 3, index: 0 }, end: { line: 3, index: 8 } }, { kind: "variable" });

    const innerScope = tracker.enterScope("block");

    tracker.reference("topLevel", { start: { line: 5, index: 0 }, end: { line: 5, index: 8 } }, { kind: "variable" });

    tracker.reference("outerVar", { start: { line: 6, index: 0 }, end: { line: 6, index: 8 } }, { kind: "variable" });

    tracker.exitScope();
    tracker.exitScope();
    tracker.exitScope();

    const innerExternalRefs = tracker.getScopeExternalReferences(innerScope.id);

    assert.strictEqual(innerExternalRefs.length, 2);

    const topLevelRef = innerExternalRefs.find((ref) => ref.name === "topLevel");
    const outerVarRef = innerExternalRefs.find((ref) => ref.name === "outerVar");

    assert.ok(topLevelRef);
    assert.strictEqual(topLevelRef.declaringScopeId, rootScope.id);
    assert.deepStrictEqual(topLevelRef.declaration, {
        name: "topLevel",
        scopeId: rootScope.id,
        classifications: ["identifier", "declaration", "variable"],
        start: { line: 1, index: 0 },
        end: { line: 1, index: 8 }
    });

    assert.ok(outerVarRef);
    assert.strictEqual(outerVarRef.declaringScopeId, outerScope.id);
    assert.deepStrictEqual(outerVarRef.declaration, {
        name: "outerVar",
        scopeId: outerScope.id,
        classifications: ["identifier", "declaration", "variable"],
        start: { line: 3, index: 0 },
        end: { line: 3, index: 8 }
    });
});

void test("getScopeExternalReferences returns empty array when all references are local", () => {
    const tracker = new ScopeTracker({ enabled: true });
    tracker.enterScope("program");
    const funcScope = tracker.enterScope("function");

    tracker.declare("localVar", { start: { line: 1, index: 0 }, end: { line: 1, index: 8 } }, { kind: "variable" });

    tracker.reference("localVar", { start: { line: 2, index: 0 }, end: { line: 2, index: 8 } }, { kind: "variable" });

    tracker.exitScope();
    tracker.exitScope();

    const externalRefs = tracker.getScopeExternalReferences(funcScope.id);

    assert.deepStrictEqual(externalRefs, []);
});

void test("getScopeExternalReferences returns empty array for non-existent scope", () => {
    const tracker = new ScopeTracker({ enabled: true });
    tracker.enterScope("program");
    tracker.exitScope();

    const externalRefs = tracker.getScopeExternalReferences("non-existent-scope");

    assert.deepStrictEqual(externalRefs, []);
});

void test("getScopeExternalReferences returns empty array when disabled", () => {
    const tracker = new ScopeTracker({ enabled: false });

    const externalRefs = tracker.getScopeExternalReferences("any-scope");

    assert.deepStrictEqual(externalRefs, []);
});

void test("getScopeExternalReferences groups multiple references to same external symbol", () => {
    const tracker = new ScopeTracker({ enabled: true });
    const rootScope = tracker.enterScope("program");

    tracker.declare("shared", { start: { line: 1, index: 0 }, end: { line: 1, index: 6 } }, { kind: "variable" });

    const funcScope = tracker.enterScope("function");

    tracker.reference("shared", { start: { line: 3, index: 0 }, end: { line: 3, index: 6 } }, { kind: "variable" });

    tracker.reference("shared", { start: { line: 4, index: 0 }, end: { line: 4, index: 6 } }, { kind: "variable" });

    tracker.reference("shared", { start: { line: 5, index: 0 }, end: { line: 5, index: 6 } }, { kind: "variable" });

    tracker.exitScope();
    tracker.exitScope();

    const externalRefs = tracker.getScopeExternalReferences(funcScope.id);

    assert.strictEqual(externalRefs.length, 1);
    assert.strictEqual(externalRefs[0].name, "shared");
    assert.strictEqual(externalRefs[0].occurrences.length, 3);
    assert.deepStrictEqual(externalRefs[0].declaration, {
        name: "shared",
        scopeId: rootScope.id,
        classifications: ["identifier", "declaration", "variable"],
        start: { line: 1, index: 0 },
        end: { line: 1, index: 6 }
    });
});

void test("getScopeExternalReferences handles unresolved references gracefully", () => {
    const tracker = new ScopeTracker({ enabled: true });
    tracker.enterScope("program");
    const funcScope = tracker.enterScope("function");

    tracker.reference(
        "undeclared",
        { start: { line: 2, index: 0 }, end: { line: 2, index: 10 } },
        { kind: "variable" }
    );

    tracker.exitScope();
    tracker.exitScope();

    const externalRefs = tracker.getScopeExternalReferences(funcScope.id);

    assert.strictEqual(externalRefs.length, 1);
    assert.strictEqual(externalRefs[0].name, "undeclared");
    assert.strictEqual(externalRefs[0].declaringScopeId, null);
    assert.strictEqual(externalRefs[0].declaration, null);
});

void test("getScopeExternalReferences returns cloned declaration metadata", () => {
    const tracker = new ScopeTracker({ enabled: true });
    const rootScope = tracker.enterScope("program");

    tracker.declare("shared", { start: { line: 1, index: 0 }, end: { line: 1, index: 6 } }, { kind: "variable" });

    const funcScope = tracker.enterScope("function");

    tracker.reference("shared", { start: { line: 2, index: 0 }, end: { line: 2, index: 6 } }, { kind: "variable" });

    tracker.exitScope();
    tracker.exitScope();

    const firstResult = tracker.getScopeExternalReferences(funcScope.id);
    firstResult[0].declaration.classifications.push("mutated");
    firstResult[0].declaration.start.line = 999;
    firstResult[0].occurrences[0].classifications.push("changed");
    firstResult[0].occurrences[0].start.line = 777;

    const secondResult = tracker.getScopeExternalReferences(funcScope.id);

    assert.deepStrictEqual(secondResult, [
        {
            name: "shared",
            declaringScopeId: rootScope.id,
            referencingScopeId: funcScope.id,
            declaration: {
                name: "shared",
                scopeId: rootScope.id,
                classifications: ["identifier", "declaration", "variable"],
                start: { line: 1, index: 0 },
                end: { line: 1, index: 6 }
            },
            occurrences: [
                {
                    kind: "reference",
                    name: "shared",
                    scopeId: funcScope.id,
                    classifications: ["identifier", "reference", "variable"],
                    declaration: {
                        scopeId: rootScope.id,
                        start: { line: 1, index: 0 },
                        end: { line: 1, index: 6 }
                    },
                    usageContext: { isRead: true },
                    start: { line: 2, index: 0 },
                    end: { line: 2, index: 6 }
                }
            ]
        }
    ]);

    assert.notStrictEqual(secondResult[0].occurrences, firstResult[0].occurrences);
    assert.notStrictEqual(secondResult[0].occurrences[0], firstResult[0].occurrences[0]);
});

void test("getScopeExternalReferences performance is efficient for many references", () => {
    const tracker = new ScopeTracker({ enabled: true });
    const rootScope = tracker.enterScope("program");

    for (let i = 0; i < 50; i++) {
        tracker.declare(
            `global${i}`,
            { start: { line: i, index: 0 }, end: { line: i, index: 10 } },
            { kind: "variable" }
        );
    }

    const funcScope = tracker.enterScope("function");

    for (let i = 0; i < 50; i++) {
        for (let j = 0; j < 5; j++) {
            tracker.reference(
                `global${i}`,
                {
                    start: { line: 100 + i * 5 + j, index: 0 },
                    end: { line: 100 + i * 5 + j, index: 10 }
                },
                { kind: "variable" }
            );
        }
    }

    tracker.exitScope();
    tracker.exitScope();

    const start = performance.now();
    const externalRefs = tracker.getScopeExternalReferences(funcScope.id);
    const elapsed = performance.now() - start;

    assert.strictEqual(externalRefs.length, 50);

    externalRefs.forEach((ref, idx) => {
        assert.strictEqual(ref.name, `global${idx}`);
        assert.strictEqual(ref.occurrences.length, 5);
        assert.deepStrictEqual(ref.declaration, {
            name: `global${idx}`,
            scopeId: rootScope.id,
            classifications: ["identifier", "declaration", "variable"],
            start: { line: idx, index: 0 },
            end: { line: idx, index: 10 }
        });
    });

    const lookupTime = elapsed;
    assert.ok(lookupTime < 50, `Lookup took ${lookupTime.toFixed(3)}ms, expected < 50ms for efficient performance`);
});
