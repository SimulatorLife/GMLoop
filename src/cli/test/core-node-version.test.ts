/**
 * Tests for the Node.js runtime version guard in the CLI core.
 *
 * {@link assertSupportedNodeVersion} is a startup prerequisite for commands that
 * require a minimum Node.js version. These tests verify that it throws the correct
 * errors for unsupported versions and passes silently for supported ones.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assertSupportedNodeVersion } from "../src/cli-core/node-version.js";

void describe("assertSupportedNodeVersion", () => {
    void it("does not throw when running under the current Node.js version", () => {
        // The test environment itself must satisfy the version requirement for
        // the rest of the CLI test suite to work, so a simple non-throw check
        // is sufficient here.
        assert.doesNotThrow(() => assertSupportedNodeVersion());
    });

    void it("throws when the Node.js major version is too old", () => {
        const original = process.version;
        Object.defineProperty(process, "version", { value: "v16.0.0", configurable: true });
        try {
            assert.throws(
                () => assertSupportedNodeVersion(),
                (err: unknown) => err instanceof Error && /required/.test(err.message)
            );
        } finally {
            Object.defineProperty(process, "version", { value: original, configurable: true });
        }
    });

    void it("throws when the Node.js minor version is below the minimum for that major", () => {
        const original = process.version;
        // Node 18.17.x is below the 18.18.0 minimum.
        Object.defineProperty(process, "version", { value: "v18.17.0", configurable: true });
        try {
            assert.throws(
                () => assertSupportedNodeVersion(),
                (err: unknown) => err instanceof Error && /18\.18\.0/.test(err.message)
            );
        } finally {
            Object.defineProperty(process, "version", { value: original, configurable: true });
        }
    });

    void it("throws a TypeError when the version string cannot be parsed", () => {
        const original = process.version;
        Object.defineProperty(process, "version", { value: "not-a-version", configurable: true });
        try {
            assert.throws(
                () => assertSupportedNodeVersion(),
                (err: unknown) => err instanceof TypeError && /Unable to determine/.test(err.message)
            );
        } finally {
            Object.defineProperty(process, "version", { value: original, configurable: true });
        }
    });
});
