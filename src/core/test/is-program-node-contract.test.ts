import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { Core } from "../src/index.js";

/**
 * Tests for the `Core.isProgramNode` capability probe.
 *
 * The probe is the canonical contract check used by the transpiler, refactor,
 * symbol-extraction, and project-index entry points. Its job is to confirm
 * that an arbitrary collaborator satisfies the full `ProgramNode` contract
 * — both the `type: "Program"` discriminator and an array-shaped `body` —
 * before any downstream code tries to iterate the body.
 *
 * These tests intentionally use plain object literals (rather than instances
 * of any concrete AST class) to demonstrate that the contract is structural:
 * any substitute that exposes the documented surface — a hand-built test
 * double, a cross-realm facade, or a parser output — is accepted uniformly.
 */
void describe("Core.isProgramNode — program contract probe", () => {
    void it("accepts a plain object that satisfies the full ProgramNode contract", () => {
        const programLike = { type: "Program", body: [] };
        assert.equal(Core.isProgramNode(programLike), true);
    });

    void it("accepts a non-empty array body as part of the contract", () => {
        const node = { type: "Identifier", name: "x" };
        const programLike = { type: "Program", body: [node] };
        assert.equal(Core.isProgramNode(programLike), true);
    });

    void it("rejects objects missing the Program discriminator", () => {
        const wrongType = { type: "BlockStatement", body: [] };
        assert.equal(Core.isProgramNode(wrongType), false);
    });

    void it("rejects objects whose body is not an array", () => {
        const objectBody = { type: "Program", body: { type: "BlockStatement" } };
        assert.equal(Core.isProgramNode(objectBody), false);

        const stringBody = { type: "Program", body: "statements" };
        assert.equal(Core.isProgramNode(stringBody), false);

        const nullBody = { type: "Program", body: null };
        assert.equal(Core.isProgramNode(nullBody), false);

        const missingBody = { type: "Program" };
        assert.equal(Core.isProgramNode(missingBody), false);
    });

    void it("rejects non-object values", () => {
        assert.equal(Core.isProgramNode(null), false);
        assert.equal(Core.isProgramNode(undefined), false);
        assert.equal(Core.isProgramNode("Program"), false);
        assert.equal(Core.isProgramNode(42), false);
        assert.equal(Core.isProgramNode(true), false);
    });

    void it("rejects empty objects", () => {
        assert.equal(Core.isProgramNode({}), false);
    });

    void it("narrowing lets callers iterate body without Array.isArray guards", () => {
        const programLike = { type: "Program", body: [{ type: "Identifier", name: "x" }] };
        if (!Core.isProgramNode(programLike)) {
            assert.fail("Expected the program-like object to satisfy the contract");
        }

        // The probe narrows `body` to `Array<unknown>`, so downstream code can
        // iterate without re-validating the array shape. Each element is also
        // retrievable by index without further guards.
        const [firstNode] = programLike.body;
        assert.equal((firstNode as { name?: string }).name, "x");
    });

    void it("accepts structurally-equivalent stand-ins (substitution safety)", () => {
        // A proxy-like object that exposes the same surface but is not a
        // instance of any canonical AST class should still satisfy the
        // contract. This demonstrates the contract is purely structural.
        const proxyStyles = [
            { type: "Program", body: [] },
            Object.assign(Object.create(null), { type: "Program", body: [] }),
            { type: "Program", body: [], extra: "metadata" }
        ];

        for (const candidate of proxyStyles) {
            assert.equal(
                Core.isProgramNode(candidate),
                true,
                `expected ${JSON.stringify(candidate)} to satisfy the contract`
            );
        }
    });
});
