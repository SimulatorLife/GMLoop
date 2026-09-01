import assert from "node:assert/strict";
import { test } from "node:test";

import { forEachAstChild, traverseAst, walkObjectGraph } from "../src/ast/object-graph.js";

void test("walkObjectGraph visits each object once even with cycles", () => {
    const shared: Record<string, unknown> & { value: number } = { value: 1 };
    const root = {
        left: { nested: shared },
        right: { nested: shared },
        array: [shared]
    };

    shared.self = root;

    const visited = new Set();

    walkObjectGraph(root, {
        enterObject(node) {
            visited.add(node);
        }
    });

    assert.ok(visited.has(root));
    assert.ok(visited.has(shared));
    assert.equal(visited.size, 4);
});

void test("traverseAst visits only typed AST nodes with parent and key context", () => {
    const ast = {
        type: "Program",
        body: [
            {
                type: "FunctionDeclaration",
                id: { type: "Identifier", name: "test" },
                params: [{ type: "Identifier", name: "arg" }]
            }
        ]
    };

    const visited: Array<{ type: string; parent: unknown; key: string | number | null }> = [];

    traverseAst(ast, {
        enter(node, context) {
            visited.push({ type: node.type ?? "", parent: context.parent, key: context.key });
        }
    });

    // Should visit Program, FunctionDeclaration, both Identifiers
    assert.equal(visited.length, 4);
    assert.equal(visited[0].type, "Program");
    assert.equal(visited[0].parent, null);
    assert.equal(visited[0].key, null);

    assert.equal(visited[1].type, "FunctionDeclaration");
    assert.equal(visited[1].parent, ast);
    assert.equal(visited[1].key, "body");

    assert.equal(visited[2].type, "Identifier");
    assert.equal(visited[3].type, "Identifier");
});

void test("traverseAst respects child-pruning signals", () => {
    const ast = {
        type: "Program",
        body: [
            {
                type: "FunctionDeclaration",
                id: { type: "Identifier", name: "test" },
                body: {
                    type: "BlockStatement",
                    body: [{ type: "ExpressionStatement" }]
                }
            }
        ]
    };

    const visited: string[] = [];

    traverseAst(ast, {
        enter(node) {
            visited.push(node.type ?? "");
            // Don't descend into FunctionDeclaration
            if (node.type === "FunctionDeclaration") {
                return false;
            }
            return undefined;
        }
    });

    // Should visit Program and FunctionDeclaration but not its children
    assert.equal(visited.length, 2);
    assert.deepEqual(visited, ["Program", "FunctionDeclaration"]);
});

void test("traverseAst emits balanced typed enter and leave events", () => {
    const ast = {
        type: "Program",
        body: [
            {
                type: "FunctionDeclaration",
                idLocation: { type: "Identifier", name: "demo" },
                body: { type: "BlockStatement", body: [] }
            }
        ]
    };
    const events: string[] = [];

    traverseAst(ast, {
        enter(node, context) {
            events.push(`enter:${node.type}:${context.key ?? "root"}`);
        },
        leave(node, context) {
            events.push(`leave:${node.type}:${context.key ?? "root"}`);
        }
    });

    assert.deepEqual(events, [
        "enter:Program:root",
        "enter:FunctionDeclaration:body",
        "enter:Identifier:idLocation",
        "leave:Identifier:idLocation",
        "enter:BlockStatement:body",
        "leave:BlockStatement:body",
        "leave:FunctionDeclaration:body",
        "leave:Program:root"
    ]);
});

void test("forEachAstChild excludes traversal links but retains constructor parent syntax", () => {
    const constructorParent = { type: "ConstructorParentClause", id: "Base" };
    const constructor = {
        type: "ConstructorDeclaration",
        parent: constructorParent,
        declaration: { type: "Identifier", name: "not-a-syntax-child" },
        body: { type: "BlockStatement", body: [] }
    };
    const children: string[] = [];

    forEachAstChild(constructor, (child) => children.push(child.type ?? ""));

    assert.deepEqual(children, ["ConstructorParentClause", "BlockStatement"]);
});

void test("walkObjectGraph traverses array entries from a snapshot when enterArray mutates the source array", () => {
    const firstNode = { type: "First" };
    const secondNode = { type: "Second" };
    const root = [firstNode, secondNode];
    const visitedTypes: string[] = [];

    walkObjectGraph(root, {
        enterArray(arrayValue) {
            if (arrayValue === root) {
                arrayValue.splice(0, 1);
            }
        },
        enterObject(node) {
            if (typeof node.type === "string") {
                visitedTypes.push(node.type);
            }
        }
    });

    assert.deepEqual(visitedTypes, ["First", "Second"]);
});
