import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ScopeTracker } from "../src/scopes/scope-tracker.js";
import { ROLE_DEF, ROLE_REF } from "../src/symbols/scip.js";

const createScriptSymbol = (name: string): string => `gml/script/${name}`;

void describe("ScopeTracker: exportScipOccurrences", () => {
    void it("exports declarations in SCIP format", async () => {
        const tracker = new ScopeTracker({ enabled: true });
        tracker.enterScope("program");

        // Declare a variable with location
        tracker.declare("myVar", {
            name: "myVar",
            start: { line: 1, column: 4, index: 4 },
            end: { line: 1, column: 9, index: 9 }
        });

        const result = tracker.exportScipOccurrences({
            includeReferences: false
        });

        assert.equal(result.length, 1);
        assert.equal(result[0].scopeId, "scope-0");
        assert.equal(result[0].scopeKind, "program");
        assert.equal(result[0].occurrences.length, 1);

        const occ = result[0].occurrences[0];
        assert.deepEqual(occ.range, [1, 4, 1, 9]);
        assert.equal(occ.symbol, "scope-0::myVar");
        assert.equal(occ.symbolRoles, ROLE_DEF);
    });

    void it("exports references in SCIP format", async () => {
        const tracker = new ScopeTracker({ enabled: true });
        tracker.enterScope("program");

        // Declare and reference a variable
        tracker.declare("counter", {
            name: "counter",
            start: { line: 1, column: 4, index: 4 },
            end: { line: 1, column: 11, index: 11 }
        });

        tracker.reference("counter", {
            name: "counter",
            start: { line: 3, column: 0, index: 20 },
            end: { line: 3, column: 7, index: 27 }
        });

        const result = tracker.exportScipOccurrences({
            includeReferences: true
        });

        assert.equal(result.length, 1);
        assert.equal(result[0].occurrences.length, 2);

        const [decl, ref] = result[0].occurrences;

        // Declaration
        assert.deepEqual(decl.range, [1, 4, 1, 11]);
        assert.equal(decl.symbolRoles, ROLE_DEF);

        // Reference
        assert.deepEqual(ref.range, [3, 0, 3, 7]);
        assert.equal(ref.symbolRoles, ROLE_REF);
    });

    void it("exports occurrences from multiple scopes", async () => {
        const tracker = new ScopeTracker({ enabled: true });
        tracker.enterScope("program");

        tracker.declare("globalVar", {
            name: "globalVar",
            start: { line: 1, column: 0, index: 0 },
            end: { line: 1, column: 9, index: 9 }
        });

        tracker.enterScope("function");
        tracker.declare("localVar", {
            name: "localVar",
            start: { line: 3, column: 4, index: 20 },
            end: { line: 3, column: 12, index: 28 }
        });

        const result = tracker.exportScipOccurrences({
            includeReferences: false
        });

        assert.equal(result.length, 2);

        // Scopes should be sorted by ID
        assert.equal(result[0].scopeId, "scope-0");
        assert.equal(result[0].scopeKind, "program");
        assert.equal(result[0].occurrences.length, 1);
        assert.equal(result[0].occurrences[0].symbol, "scope-0::globalVar");

        assert.equal(result[1].scopeId, "scope-1");
        assert.equal(result[1].scopeKind, "function");
        assert.equal(result[1].occurrences.length, 1);
        assert.equal(result[1].occurrences[0].symbol, "scope-1::localVar");
    });

    void it("filters to specific scope when scopeId provided", async () => {
        const tracker = new ScopeTracker({ enabled: true });
        tracker.enterScope("program");
        tracker.declare("var1", {
            name: "var1",
            start: { line: 1, column: 0, index: 0 },
            end: { line: 1, column: 4, index: 4 }
        });

        tracker.enterScope("function");
        tracker.declare("var2", {
            name: "var2",
            start: { line: 3, column: 0, index: 10 },
            end: { line: 3, column: 4, index: 14 }
        });

        const result = tracker.exportScipOccurrences({
            scopeId: "scope-1",
            includeReferences: false
        });

        assert.equal(result.length, 1);
        assert.equal(result[0].scopeId, "scope-1");
        assert.equal(result[0].occurrences.length, 1);
        assert.equal(result[0].occurrences[0].symbol, "scope-1::var2");
    });

    void it("supports custom symbol generator", async () => {
        const tracker = new ScopeTracker({ enabled: true });
        tracker.enterScope("program");

        tracker.declare("myScript", {
            name: "myScript",
            start: { line: 1, column: 0, index: 0 },
            end: { line: 1, column: 8, index: 8 }
        });

        const result = tracker.exportScipOccurrences({
            includeReferences: false,
            symbolGenerator: createScriptSymbol
        });

        assert.equal(result[0].occurrences.length, 1);
        assert.equal(result[0].occurrences[0].symbol, "gml/script/myScript");
    });

    void it("handles occurrences with missing location data", async () => {
        const tracker = new ScopeTracker({ enabled: true });
        tracker.enterScope("program");

        // Declare with valid location
        tracker.declare("validVar", {
            name: "validVar",
            start: { line: 1, column: 0, index: 0 },
            end: { line: 1, column: 8, index: 8 }
        });

        // Declare with missing location (should be skipped)
        tracker.declare("invalidVar", {
            name: "invalidVar"
        });

        const result = tracker.exportScipOccurrences({
            includeReferences: false
        });

        assert.equal(result[0].occurrences.length, 1);
        assert.equal(result[0].occurrences[0].symbol, "scope-0::validVar");
    });

    void it("excludes references when includeReferences is false", async () => {
        const tracker = new ScopeTracker({ enabled: true });
        tracker.enterScope("program");

        tracker.declare("var", {
            name: "var",
            start: { line: 1, column: 0, index: 0 },
            end: { line: 1, column: 3, index: 3 }
        });

        tracker.reference("var", {
            name: "var",
            start: { line: 2, column: 0, index: 5 },
            end: { line: 2, column: 3, index: 8 }
        });

        tracker.reference("var", {
            name: "var",
            start: { line: 3, column: 0, index: 10 },
            end: { line: 3, column: 3, index: 13 }
        });

        const result = tracker.exportScipOccurrences({
            includeReferences: false
        });

        // Should only have the declaration
        assert.equal(result[0].occurrences.length, 1);
        assert.equal(result[0].occurrences[0].symbolRoles, ROLE_DEF);
    });

    void it("returns empty array when no occurrences exist", async () => {
        const tracker = new ScopeTracker({ enabled: true });
        tracker.enterScope("program");

        const result = tracker.exportScipOccurrences();

        assert.equal(result.length, 0);
    });

    void it("handles multi-line occurrences correctly", async () => {
        const tracker = new ScopeTracker({ enabled: true });
        tracker.enterScope("program");

        tracker.declare("multiline", {
            name: "multiline",
            start: { line: 1, column: 0, index: 0 },
            end: { line: 3, column: 5, index: 25 }
        });

        const result = tracker.exportScipOccurrences({
            includeReferences: false
        });

        const occ = result[0].occurrences[0];
        assert.deepEqual(occ.range, [1, 0, 3, 5]);
    });

    void it("supports hot reload dependency tracking use case", async () => {
        // Simulate a file with a function that references external symbols
        const tracker = new ScopeTracker({ enabled: true });
        tracker.enterScope("program");

        // Global variable declaration
        tracker.declare("gameState", {
            name: "gameState",
            start: { line: 1, column: 0, index: 0 },
            end: { line: 1, column: 9, index: 9 }
        });

        // Function scope
        tracker.enterScope("function");
        tracker.declare("self", {
            name: "self",
            start: { line: 3, column: 0, index: 20 },
            end: { line: 3, column: 4, index: 24 }
        });

        // Reference to global variable inside function
        tracker.reference("gameState", {
            name: "gameState",
            start: { line: 4, column: 4, index: 30 },
            end: { line: 4, column: 13, index: 39 }
        });

        tracker.exitScope();

        const result = tracker.exportScipOccurrences();

        // Should have 2 scopes
        assert.equal(result.length, 2);

        // First scope (program) has gameState declaration only
        const programScope = result[0];
        assert.equal(programScope.scopeKind, "program");
        assert.equal(programScope.occurrences.length, 1);
        assert.equal(programScope.occurrences[0].symbolRoles, ROLE_DEF);
        assert.equal(programScope.occurrences[0].symbol, "scope-0::gameState");

        // Second scope (function) has self declaration and gameState reference
        const funcScope = result[1];
        assert.equal(funcScope.scopeKind, "function");
        assert.equal(funcScope.occurrences.length, 2);

        const selfDecl = funcScope.occurrences.find((o) => o.symbol.includes("self") && o.symbolRoles === ROLE_DEF);
        const gameStateRef = funcScope.occurrences.find(
            (o) => o.symbol.includes("gameState") && o.symbolRoles === ROLE_REF
        );

        assert.ok(selfDecl, "Should have self declaration");
        assert.ok(gameStateRef, "Should have gameState reference");
    });

    void it("handles null custom symbol generator gracefully", async () => {
        const tracker = new ScopeTracker({ enabled: true });
        tracker.enterScope("program");

        tracker.declare("var", {
            name: "var",
            start: { line: 1, column: 0, index: 0 },
            end: { line: 1, column: 3, index: 3 }
        });

        // Custom generator that returns null should filter out the occurrence
        const result = tracker.exportScipOccurrences({
            includeReferences: false,
            symbolGenerator: () => null
        });

        // Scopes with no valid occurrences (all filtered out) should not be included
        assert.equal(result.length, 0);
    });

    void it("exports occurrences sorted by scope ID", async () => {
        const tracker = new ScopeTracker({ enabled: true });

        // Create multiple scopes
        tracker.enterScope("program"); // scope-0
        tracker.declare("a", {
            name: "a",
            start: { line: 1, column: 0, index: 0 },
            end: { line: 1, column: 1, index: 1 }
        });

        tracker.enterScope("function"); // scope-1
        tracker.declare("b", {
            name: "b",
            start: { line: 2, column: 0, index: 5 },
            end: { line: 2, column: 1, index: 6 }
        });

        tracker.exitScope();
        tracker.enterScope("block"); // scope-2
        tracker.declare("c", {
            name: "c",
            start: { line: 3, column: 0, index: 10 },
            end: { line: 3, column: 1, index: 11 }
        });

        const result = tracker.exportScipOccurrences({
            includeReferences: false
        });

        assert.equal(result.length, 3);
        assert.equal(result[0].scopeId, "scope-0");
        assert.equal(result[1].scopeId, "scope-1");
        assert.equal(result[2].scopeId, "scope-2");
    });
});
