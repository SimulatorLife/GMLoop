import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { combineLengthdirScalarAssignments } from "../../src/rules/gml/math/index.js";

/**
 * Construct the minimal AST fragment required by `combineLengthdirScalarAssignments`.
 *
 * The transform only inspects a statement list whose entries are either
 * `VariableDeclaration` or `ExpressionStatement` wrapping an
 * `AssignmentExpression`. We hand-build those nodes here so each test can
 * describe a body without depending on the parser and without paying the
 * cost of parsing in tight loops.
 */
function makeIdentifier(name: string): Record<string, unknown> {
    return { type: "Identifier", name };
}

function makeLiteral(value: string): Record<string, unknown> {
    return { type: "Literal", value };
}

function makeBinaryExpression(
    operator: string,
    left: Record<string, unknown>,
    right: Record<string, unknown>
): Record<string, unknown> {
    return { type: "BinaryExpression", operator, left, right };
}

function makeCallExpression(
    object: Record<string, unknown>,
    args: Array<Record<string, unknown>>
): Record<string, unknown> {
    return { type: "CallExpression", object, arguments: args };
}

function makeVariableDeclaration(name: string, init: Record<string, unknown>): Record<string, unknown> {
    return {
        type: "VariableDeclaration",
        declarations: [
            {
                type: "VariableDeclarator",
                id: makeIdentifier(name),
                init
            }
        ]
    };
}

function makeAssignment(name: string, right: Record<string, unknown>): Record<string, unknown> {
    return {
        type: "ExpressionStatement",
        expression: {
            type: "AssignmentExpression",
            operator: "=",
            left: makeIdentifier(name),
            right
        }
    };
}

/**
 * Build the canonical lengthdir half-difference expression:
 *   `name - name / 2 - lengthdir_?(name / 2, angle)`
 */
function makeLengthdirHalfDifference(
    name: string,
    angle: Record<string, unknown>,
    functionName: "lengthdir_x" | "lengthdir_y"
): Record<string, unknown> {
    const halfOfName = makeBinaryExpression("/", makeIdentifier(name), makeLiteral("2"));
    const subtractor = makeBinaryExpression("-", makeIdentifier(name), halfOfName);
    const lengthdirCall = makeCallExpression(makeIdentifier(functionName), [halfOfName, angle]);
    return makeBinaryExpression("-", subtractor, lengthdirCall);
}

void describe("combineLengthdirScalarAssignments", () => {
    void it("merges a single consecutive `var X` + `X = lengthdir half-difference` pair", () => {
        const angle = makeIdentifier("angle");
        const initialiser = makeLiteral("1");
        const declaration = makeVariableDeclaration("speed", initialiser);
        const reassignment = makeAssignment("speed", makeLengthdirHalfDifference("speed", angle, "lengthdir_x"));

        const ast: Record<string, unknown> = {
            type: "Program",
            body: [declaration, reassignment]
        };

        combineLengthdirScalarAssignments(ast);

        const body = ast.body as Array<Record<string, unknown>>;
        assert.strictEqual(
            body.length,
            1,
            `The trailing reassignment should be folded into the declaration; got length ${body.length}`
        );
        assert.strictEqual(
            body[0],
            declaration,
            "The same declaration node must be reused so existing references stay valid"
        );
        const declarator = (body[0] as { declarations: Array<Record<string, unknown>> }).declarations[0];
        assert.notStrictEqual(
            declarator.init,
            initialiser,
            "The declarator init must be replaced with the condensed expression"
        );
    });

    void it("merges every consecutive mergeable pair in a long run of `var X` + `X = lengthdir` statements", () => {
        // This is the regression that motivated the rewrite: a forward
        // `for (let i = 0; i < body.length - 1; i += 1)` loop with a
        // `body.splice(i + 1, 1)` inside shifted later elements down by
        // one while the increment expression advanced `i` by one,
        // so depending on the precise spacing of unrelated siblings a
        // long run of mergeable pairs could leave some pairs
        // unmerged. Walking a snapshot of the body and rebuilding the
        // array from an accumulator removes that implicit invariant.
        const angle = makeIdentifier("angle");
        const pairs = ["a", "b", "c", "d"].map((name) => {
            const declaration = makeVariableDeclaration(name, makeLiteral("1"));
            const reassignment = makeAssignment(
                name,
                makeLengthdirHalfDifference(name, angle, name === "b" || name === "d" ? "lengthdir_y" : "lengthdir_x")
            );
            return { declaration, reassignment, name };
        });

        const ast: Record<string, unknown> = {
            type: "Program",
            body: pairs.flatMap(({ declaration, reassignment }) => [declaration, reassignment])
        };

        combineLengthdirScalarAssignments(ast);

        const body = ast.body as Array<Record<string, unknown>>;
        assert.strictEqual(
            body.length,
            pairs.length,
            `Expected ${pairs.length} surviving declarations but got ${body.length}; a long run of mergeable pairs must not skip any element`
        );
        for (const [index, entry] of body.entries()) {
            const pair = pairs[index];
            assert.strictEqual(
                entry,
                pair.declaration,
                `body[${index}] should be the original declaration node so downstream consumers can rely on reference equality`
            );
            const declarator = (entry as { declarations: Array<Record<string, unknown>> }).declarations[0];
            assert.notStrictEqual(
                declarator.init,
                makeLiteral("1"),
                `body[${index}].declarations[0].init must be replaced with the condensed expression`
            );
        }
    });

    void it("leaves the declaration untouched when no following statement matches the merge pattern", () => {
        const angle = makeIdentifier("angle");
        const declaration = makeVariableDeclaration("speed", makeLiteral("1"));
        const unrelatedAssignment = makeAssignment(
            "speed",
            makeBinaryExpression("+", makeIdentifier("speed"), makeLiteral("2"))
        );
        const lengthdirAssignment = makeAssignment("speed", makeLengthdirHalfDifference("speed", angle, "lengthdir_x"));

        const ast: Record<string, unknown> = {
            type: "Program",
            body: [declaration, unrelatedAssignment, lengthdirAssignment]
        };

        combineLengthdirScalarAssignments(ast);

        const body = ast.body as Array<Record<string, unknown>>;
        assert.strictEqual(
            body.length,
            3,
            "Nothing should be removed when no pair is mergeable; unrelated statements must pass through untouched"
        );
        assert.strictEqual(body[0], declaration, "Original declaration reference must be preserved");
        assert.strictEqual(body[1], unrelatedAssignment, "Unrelated statement must remain at its original slot");
        assert.strictEqual(
            body[2],
            lengthdirAssignment,
            "Non-mergeable lengthdir statement must remain at its original slot"
        );
    });

    void it("descends into nested block bodies so mergeable pairs inside blocks are folded", () => {
        const angle = makeIdentifier("angle");
        const innerDeclaration = makeVariableDeclaration("speed", makeLiteral("1"));
        const innerReassignment = makeAssignment("speed", makeLengthdirHalfDifference("speed", angle, "lengthdir_x"));
        const innerBlock: Record<string, unknown> = {
            type: "BlockStatement",
            body: [innerDeclaration, innerReassignment]
        };
        const outerStatement: Record<string, unknown> = {
            type: "ExpressionStatement",
            expression: { type: "Identifier", name: "noop" }
        };

        const ast: Record<string, unknown> = {
            type: "Program",
            body: [innerBlock, outerStatement]
        };

        combineLengthdirScalarAssignments(ast);

        const outerBody = ast.body as Array<Record<string, unknown>>;
        assert.strictEqual(outerBody.length, 2, "The outer block and the trailing statement must remain");
        assert.strictEqual(outerBody[1], outerStatement, "The outer statement must not be moved by the recursive walk");

        const innerBody = (outerBody[0] as { body: Array<Record<string, unknown>> }).body;
        assert.strictEqual(innerBody.length, 1, "The inner reassignment must be folded into the inner declaration");
        assert.strictEqual(innerBody[0], innerDeclaration, "Inner declaration reference must be preserved");
    });

    void it("does not throw or recurse into the body when given a node that has no statements", () => {
        const leaf: Record<string, unknown> = {
            type: "BinaryExpression",
            operator: "+",
            left: makeLiteral("1"),
            right: makeLiteral("2")
        };

        assert.doesNotThrow(() => combineLengthdirScalarAssignments(leaf));
    });
});
