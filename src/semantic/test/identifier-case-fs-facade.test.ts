import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    DEFAULT_WRITE_ACCESS_MODE,
    defaultIdentifierCaseFsFacade
} from "../src/identifier-case/identifier-case-helpers.js";

void describe("defaultIdentifierCaseFsFacade", () => {
    void it("is frozen so callers cannot mutate the shared default", () => {
        assert.ok(Object.isFrozen(defaultIdentifierCaseFsFacade));
    });

    void it("exposes the expected file-system methods", () => {
        const expectedMethods = [
            "readFileSync",
            "writeFileSync",
            "renameSync",
            "accessSync",
            "statSync",
            "mkdirSync",
            "existsSync"
        ];
        for (const method of expectedMethods) {
            assert.equal(
                typeof (defaultIdentifierCaseFsFacade as Record<string, unknown>)[method],
                "function",
                `expected '${method}' to be a function`
            );
        }
    });

    void it("readFileSync rejects non-string paths", () => {
        assert.throws(() => defaultIdentifierCaseFsFacade.readFileSync(42), /readFileSync only accepts string paths/);
    });

    void it("writeFileSync rejects non-string paths", () => {
        assert.throws(
            () => defaultIdentifierCaseFsFacade.writeFileSync(42, "contents"),
            /writeFileSync only accepts string paths/
        );
    });

    void it("DEFAULT_WRITE_ACCESS_MODE is a number or undefined", () => {
        assert.ok(
            DEFAULT_WRITE_ACCESS_MODE === undefined || typeof DEFAULT_WRITE_ACCESS_MODE === "number",
            "DEFAULT_WRITE_ACCESS_MODE must be a number or undefined"
        );
    });
});
