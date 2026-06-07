/**
 * Tests for the annotate-static-overrides lint transform.
 *
 * This transform pre-processes the AST to mark static constructor helper
 * functions that override implementations inherited from parent constructors.
 * The `_overridesStaticFunction` annotation is later consumed by
 * `synthetic-comments.ts` to emit `@override` doc-comment tags.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { MutableGameMakerAstNode } from "@gmloop/core";

import { annotateStaticFunctionOverridesTransform } from "../src/rules/gml/transforms/comment-annotate-static-overrides.js";
import { assertEquals } from "./assertions.js";

/**
 * A node that may carry the annotation fields set by
 * `annotateStaticFunctionOverridesTransform`.
 */
type AnnotatedNode = Record<string, unknown> & {
    _overridesStaticFunction?: boolean;
    _overridesStaticFunctionNode?: Record<string, unknown>;
};

/** Minimal AST node helper used by fixtures in this file. */
function makeNode(type: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return { type, ...extra };
}

function makeIdentifier(name: string) {
    return makeNode("Identifier", { name });
}

function makeFunction() {
    return makeNode("FunctionDeclaration", { params: [], body: makeNode("BlockStatement", { body: [] }) });
}

function makeStaticFunctionDecl(name: string): AnnotatedNode {
    return makeNode("VariableDeclaration", {
        kind: "static",
        declarations: [
            makeNode("VariableDeclarator", {
                id: makeIdentifier(name),
                init: makeFunction()
            })
        ]
    });
}

function makeConstructor(
    name: string,
    parentName: string | null,
    bodyStatements: Record<string, unknown>[]
): Record<string, unknown> {
    const node: Record<string, unknown> = {
        type: "ConstructorDeclaration",
        id: makeIdentifier(name),
        body: makeNode("BlockStatement", { body: bodyStatements })
    };

    if (parentName) {
        node.parent = makeNode("ConstructorParentClause", { id: makeIdentifier(parentName) });
    }

    return node;
}

function makeProgram(body: Record<string, unknown>[]): MutableGameMakerAstNode {
    return { type: "Program", body };
}

void describe("annotateStaticFunctionOverridesTransform", () => {
    void it("has the expected transform name", () => {
        assertEquals(annotateStaticFunctionOverridesTransform.name, "annotate-static-overrides");
    });

    void it("returns the AST unchanged when there are no constructors", () => {
        const ast = makeProgram([]);
        const result = annotateStaticFunctionOverridesTransform.transform(ast);
        assert.strictEqual(result, ast);
    });

    void it("does not annotate static helpers that have no ancestor counterpart", () => {
        const helper = makeStaticFunctionDecl("doWork");
        const ctor = makeConstructor("Base", null, [helper]);
        const ast = makeProgram([ctor]);

        annotateStaticFunctionOverridesTransform.transform(ast);

        assertEquals(helper._overridesStaticFunction, undefined);
        assertEquals(helper._overridesStaticFunctionNode, undefined);
    });

    void it("annotates a static helper that shadows one from a direct parent", () => {
        const parentHelper = makeStaticFunctionDecl("doWork");
        const childHelper = makeStaticFunctionDecl("doWork");

        const parent = makeConstructor("Base", null, [parentHelper]);
        const child = makeConstructor("Child", "Base", [childHelper]);
        const ast = makeProgram([parent, child]);

        annotateStaticFunctionOverridesTransform.transform(ast);

        assertEquals(childHelper._overridesStaticFunction, true);
        assert.strictEqual(childHelper._overridesStaticFunctionNode, parentHelper);
    });

    void it("does not annotate the parent's helper, only the child's", () => {
        const parentHelper = makeStaticFunctionDecl("doWork");
        const childHelper = makeStaticFunctionDecl("doWork");

        const parent = makeConstructor("Base", null, [parentHelper]);
        const child = makeConstructor("Child", "Base", [childHelper]);
        const ast = makeProgram([parent, child]);

        annotateStaticFunctionOverridesTransform.transform(ast);

        assertEquals(parentHelper._overridesStaticFunction, undefined);
    });

    void it("annotates transitive overrides through a multi-level hierarchy", () => {
        const grandparentHelper = makeStaticFunctionDecl("doWork");
        const grandchildHelper = makeStaticFunctionDecl("doWork");

        const grandparent = makeConstructor("GrandParent", null, [grandparentHelper]);
        // Middle constructor does not override doWork
        const middle = makeConstructor("Middle", "GrandParent", []);
        const grandchild = makeConstructor("GrandChild", "Middle", [grandchildHelper]);
        const ast = makeProgram([grandparent, middle, grandchild]);

        annotateStaticFunctionOverridesTransform.transform(ast);

        assertEquals(grandchildHelper._overridesStaticFunction, true);
        assert.strictEqual(grandchildHelper._overridesStaticFunctionNode, grandparentHelper);
    });

    void it("handles a constructor with no parent without throwing", () => {
        const helper = makeStaticFunctionDecl("init");
        const ctor = makeConstructor("Standalone", null, [helper]);
        const ast = makeProgram([ctor]);

        assert.doesNotThrow(() => {
            annotateStaticFunctionOverridesTransform.transform(ast);
        });

        assertEquals(helper._overridesStaticFunction, undefined);
    });

    void it("skips non-function static declarations (e.g. plain values)", () => {
        const plainStatic: AnnotatedNode = makeNode("VariableDeclaration", {
            kind: "static",
            declarations: [
                makeNode("VariableDeclarator", {
                    id: makeIdentifier("count"),
                    init: makeNode("Literal", { value: 0 })
                })
            ]
        });

        const parent = makeConstructor("Base", null, [makeStaticFunctionDecl("count")]);
        const child = makeConstructor("Child", "Base", [plainStatic]);
        const ast = makeProgram([parent, child]);

        // Plain static value should not be treated as an override
        annotateStaticFunctionOverridesTransform.transform(ast);

        assertEquals(plainStatic._overridesStaticFunction, undefined);
    });

    void it("handles circular inheritance references without throwing", () => {
        // A → B → A (cycle)
        const helperA = makeStaticFunctionDecl("doWork");
        const helperB = makeStaticFunctionDecl("doWork");

        const a = makeConstructor("A", "B", [helperA]);
        const b = makeConstructor("B", "A", [helperB]);
        const ast = makeProgram([a, b]);

        assert.doesNotThrow(() => {
            annotateStaticFunctionOverridesTransform.transform(ast);
        });
    });
});
