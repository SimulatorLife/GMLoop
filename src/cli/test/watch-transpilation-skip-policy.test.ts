/**
 * Focused unit tests for the watch command's transpilation-skip policy.
 *
 * The evaluator is a pure function: feed it the previous cache state and the
 * current observation, assert the decision. These tests intentionally avoid
 * the filesystem and the watcher so the policy can be hardened independently
 * from the mechanism that depends on it.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import {
    evaluateTranspilationSkipPolicy,
    type TranspilationSkipPolicyInput
} from "../src/commands/watch/transpilation-skip-policy.js";

const SOURCE_CONTENT = "function scr_player_move() {\n    return 42;\n}";
const OTHER_CONTENT = "function scr_player_move() {\n    return 99;\n}";

function hashContent(content: string): string {
    return createHash("md5").update(content, "utf8").digest("hex");
}

/**
 * Build a policy input with sensible defaults so individual tests only override
 * the fields they care about. Centralised so a future input field change does
 * not ripple through every test.
 */
function buildInput(overrides: Partial<TranspilationSkipPolicyInput> = {}): TranspilationSkipPolicyInput {
    return {
        currentMtimeMs: 1000,
        previousMtimeMs: undefined,
        currentContent: SOURCE_CONTENT,
        previousContentHash: undefined,
        ...overrides
    };
}

void describe("watch command transpilation-skip policy", () => {
    void it("skips when the cached mtime is strictly newer than the current mtime", () => {
        const decision = evaluateTranspilationSkipPolicy(
            buildInput({
                currentMtimeMs: 500,
                previousMtimeMs: 1000,
                previousContentHash: hashContent(SOURCE_CONTENT)
            })
        );

        assert.deepEqual(decision, { action: "skip", reason: "mtime-unchanged" });
    });

    void it("skips when the mtime is unchanged", () => {
        const decision = evaluateTranspilationSkipPolicy(
            buildInput({
                currentMtimeMs: 1000,
                previousMtimeMs: 1000,
                previousContentHash: hashContent(SOURCE_CONTENT)
            })
        );

        assert.deepEqual(decision, { action: "skip", reason: "mtime-unchanged" });
    });

    void it("skips the mtime check entirely when no previous mtime is cached", () => {
        // The first observation must not be skipped just because there is no
        // previous mtime to compare against; the policy falls through to the
        // content-hash check.
        const decision = evaluateTranspilationSkipPolicy(
            buildInput({
                previousMtimeMs: undefined,
                previousContentHash: hashContent(SOURCE_CONTENT)
            })
        );

        assert.deepEqual(decision, { action: "skip", reason: "content-unchanged" });
    });

    void it("skips when content hash matches the cached hash even though mtime advanced", () => {
        const decision = evaluateTranspilationSkipPolicy(
            buildInput({
                currentMtimeMs: 5000,
                previousMtimeMs: 1000,
                previousContentHash: hashContent(SOURCE_CONTENT)
            })
        );

        assert.deepEqual(decision, { action: "skip", reason: "content-unchanged" });
    });

    void it("processes when content hash differs from the cached hash", () => {
        const decision = evaluateTranspilationSkipPolicy(
            buildInput({
                currentMtimeMs: 5000,
                previousMtimeMs: 1000,
                currentContent: OTHER_CONTENT,
                previousContentHash: hashContent(SOURCE_CONTENT)
            })
        );

        assert.equal(decision.action, "process");
        if (decision.action !== "process") {
            throw new Error("expected process decision");
        }
        assert.equal(decision.contentHash, hashContent(OTHER_CONTENT));
    });

    void it("processes the first observation and seeds the cache with a fresh hash", () => {
        const decision = evaluateTranspilationSkipPolicy(
            buildInput({
                previousContentHash: undefined
            })
        );

        assert.equal(decision.action, "process");
        if (decision.action !== "process") {
            throw new Error("expected process decision");
        }
        assert.equal(decision.contentHash, hashContent(SOURCE_CONTENT));
    });

    void it("prefers the mtime check over the content-hash check when both would apply", () => {
        // When both the mtime guard and the content guard would fire, the
        // cheaper mtime check wins so the hash computation is avoided. Assert
        // this by passing content that matches the previous hash alongside a
        // non-newer mtime; the policy should report mtime-unchanged rather
        // than content-unchanged.
        const decision = evaluateTranspilationSkipPolicy(
            buildInput({
                currentMtimeMs: 999,
                previousMtimeMs: 1000,
                previousContentHash: hashContent(SOURCE_CONTENT)
            })
        );

        assert.deepEqual(decision, { action: "skip", reason: "mtime-unchanged" });
    });

    void it("treats the very first observation as process when no cache state exists", () => {
        const decision = evaluateTranspilationSkipPolicy({
            currentMtimeMs: 1000,
            previousMtimeMs: undefined,
            currentContent: SOURCE_CONTENT,
            previousContentHash: undefined
        });

        assert.equal(decision.action, "process");
        if (decision.action !== "process") {
            throw new Error("expected process decision");
        }
        assert.equal(decision.contentHash, hashContent(SOURCE_CONTENT));
    });

    void it("treats empty source content as a distinct fingerprint", () => {
        const decision = evaluateTranspilationSkipPolicy(
            buildInput({
                currentContent: "",
                previousContentHash: hashContent("")
            })
        );

        assert.deepEqual(decision, { action: "skip", reason: "content-unchanged" });
    });
});
