import assert, { strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";

import type { CallExpressionNode, IdentifierMetadata } from "../src/emitter/ast.js";
import { createSemanticOracle } from "../src/emitter/semantic-factory.js";
import { EventContextOracle } from "../src/event-context/event-context-oracle.js";

function makeIdent(name: string, isGlobal = false): IdentifierMetadata {
    return { name, isGlobalIdentifier: isGlobal };
}

function makeCallExpr(callee: string): CallExpressionNode {
    return {
        type: "CallExpression",
        object: { type: "Identifier", name: callee },
        arguments: []
    } as unknown as CallExpressionNode;
}

void describe("EventContextOracle", () => {
    void describe("kindOfIdent", () => {
        void it("classifies var-declared locals as 'local'", () => {
            const base = createSemanticOracle();
            const oracle = new EventContextOracle(base, new Set(["speed", "dx"]));

            strictEqual(oracle.kindOfIdent(makeIdent("speed")), "local");
            strictEqual(oracle.kindOfIdent(makeIdent("dx")), "local");
        });

        void it("classifies undeclared identifiers as 'self_field'", () => {
            const base = createSemanticOracle();
            const oracle = new EventContextOracle(base, new Set(["speed"]));

            strictEqual(oracle.kindOfIdent(makeIdent("health")), "self_field");
            strictEqual(oracle.kindOfIdent(makeIdent("x")), "self_field");
            strictEqual(oracle.kindOfIdent(makeIdent("image_index")), "self_field");
        });

        void it("passes through 'builtin' classification from delegate", () => {
            // abs, sqrt etc. are built-ins and should not be treated as self fields
            const base = createSemanticOracle();
            const oracle = new EventContextOracle(base, new Set());

            // abs is a builtin but it's only classified for identifiers, not call targets
            // The base oracle classifies identifiers named "abs" as "builtin"
            // (since abs is in the manual function names)
            const kind = oracle.kindOfIdent(makeIdent("abs"));
            strictEqual(kind, "builtin");
        });

        void it("passes through 'script' classification from delegate", () => {
            const base = createSemanticOracle({ scriptNames: new Set(["scr_player_move"]) });
            const oracle = new EventContextOracle(base, new Set());

            strictEqual(oracle.kindOfIdent(makeIdent("scr_player_move")), "script");
        });

        void it("passes through 'global_field' for explicitly global identifiers", () => {
            const base = createSemanticOracle();
            const oracle = new EventContextOracle(base, new Set());

            strictEqual(oracle.kindOfIdent(makeIdent("player_score", true)), "global_field");
        });

        void it("classifies identifier as 'local' (not 'self_field') when in localVars", () => {
            const base = createSemanticOracle();
            const oracle = new EventContextOracle(base, new Set(["temp"]));

            // Even though the base oracle would classify 'temp' as 'local' by default,
            // explicitly test that a name in localVars is classified as 'local'.
            strictEqual(oracle.kindOfIdent(makeIdent("temp")), "local");
        });

        void it("handles null node gracefully", () => {
            const base = createSemanticOracle();
            const oracle = new EventContextOracle(base, new Set());

            // Null should not throw; empty-name identifiers fall through to self_field
            // (no name means no local match, and base returns 'local' for null)
            const kind = oracle.kindOfIdent(null);
            // The base oracle returns "local" for null, and since DELEGATE_OWNED_KINDS
            // does not include "local", we'd fall through. Empty name → no localVars match
            // → self_field. But name is "" which is falsy, so localVars.has("") is false.
            strictEqual(kind, "self_field");
        });

        void it("handles empty-name identifier gracefully", () => {
            const base = createSemanticOracle();
            const oracle = new EventContextOracle(base, new Set());

            const kind = oracle.kindOfIdent(makeIdent(""));
            // Empty name: localVars won't match "" → self_field
            strictEqual(kind, "self_field");
        });
    });

    void describe("nameOfIdent", () => {
        void it("delegates name resolution to base oracle", () => {
            const base = createSemanticOracle();
            const oracle = new EventContextOracle(base, new Set());

            strictEqual(oracle.nameOfIdent(makeIdent("my_var")), "my_var");
            strictEqual(oracle.nameOfIdent(null), "");
        });
    });

    void describe("qualifiedSymbol", () => {
        void it("delegates symbol generation to base oracle", () => {
            const base = createSemanticOracle({ scriptNames: new Set(["scr_test"]) });
            const oracle = new EventContextOracle(base, new Set());

            // Scripts get SCIP symbols
            const callNode = makeCallExpr("scr_test");
            const symbol = oracle.callTargetSymbol(callNode);
            strictEqual(typeof symbol, "string");
        });
    });

    void describe("callTargetKind", () => {
        void it("delegates builtin call classification to base oracle", () => {
            const base = createSemanticOracle();
            const oracle = new EventContextOracle(base, new Set());

            strictEqual(oracle.callTargetKind(makeCallExpr("abs")), "builtin");
            strictEqual(oracle.callTargetKind(makeCallExpr("sqrt")), "builtin");
        });

        void it("delegates script call classification to base oracle", () => {
            const base = createSemanticOracle({ scriptNames: new Set(["scr_enemy_ai"]) });
            const oracle = new EventContextOracle(base, new Set());

            strictEqual(oracle.callTargetKind(makeCallExpr("scr_enemy_ai")), "script");
        });

        void it("delegates unknown call classification to base oracle", () => {
            const base = createSemanticOracle();
            const oracle = new EventContextOracle(base, new Set());

            strictEqual(oracle.callTargetKind(makeCallExpr("unknown_fn")), "unknown");
        });
    });

    void describe("nested scope tracking", () => {
        void it("classifies names in a pushed scope as local", () => {
            const oracle = new EventContextOracle(createSemanticOracle(), new Set());

            oracle.pushScope(new Set(["inner_param", "inner_local"]));
            try {
                strictEqual(oracle.kindOfIdent(makeIdent("inner_param")), "local");
                strictEqual(oracle.kindOfIdent(makeIdent("inner_local")), "local");
                strictEqual(oracle.kindOfIdent(makeIdent("health")), "self_field");
            } finally {
                oracle.popScope();
            }
        });

        void it("retains outer-event locals after a nested scope is pushed and popped", () => {
            const oracle = new EventContextOracle(createSemanticOracle(), new Set(["event_local"]));

            oracle.pushScope(new Set(["inner_local"]));
            try {
                strictEqual(oracle.kindOfIdent(makeIdent("inner_local")), "local");
                strictEqual(oracle.kindOfIdent(makeIdent("event_local")), "local");
            } finally {
                oracle.popScope();
            }

            strictEqual(oracle.kindOfIdent(makeIdent("inner_local")), "self_field");
            strictEqual(oracle.kindOfIdent(makeIdent("event_local")), "local");
        });

        void it("keeps shadowed names local in inner and outer scopes", () => {
            const oracle = new EventContextOracle(createSemanticOracle(), new Set(["shared"]));

            oracle.pushScope(new Set(["shared"]));
            try {
                strictEqual(oracle.kindOfIdent(makeIdent("shared")), "local");
            } finally {
                oracle.popScope();
            }
            strictEqual(oracle.kindOfIdent(makeIdent("shared")), "local");
        });

        void it("throws when popScope has no matching pushScope", () => {
            const oracle = new EventContextOracle(createSemanticOracle(), new Set());

            assert.throws(() => oracle.popScope(), /without a matching pushScope/);
        });
    });
});
