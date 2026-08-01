import assert from "node:assert/strict";
import { describe, it } from "node:test";

function normalizeTrackedPathAlwaysReplace(path: string): string {
    return path.replaceAll("\\", "/");
}

function normalizeTrackedPathShortCircuit(path: string): string {
    return path.includes("\\") ? path.replaceAll("\\", "/") : path;
}

void describe("scope tracker path normalization micro-optimization", () => {
    void it("preserves path normalization for both POSIX and Windows-style inputs", () => {
        const samples = [
            "objects/player/step.gml",
            "scripts/util/math.gml",
            String.raw`objects\player\step.gml`,
            String.raw`rooms\room0\creation.gml`,
            String.raw`mixed\slashes/path.gml`
        ];

        for (const sample of samples) {
            assert.strictEqual(normalizeTrackedPathShortCircuit(sample), normalizeTrackedPathAlwaysReplace(sample));
        }
    });

    void it("skips replacement work for already-normalized POSIX paths", () => {
        const posixPath = "objects/player/step.gml";
        assert.strictEqual(normalizeTrackedPathShortCircuit(posixPath), posixPath);
        assert.strictEqual(normalizeTrackedPathAlwaysReplace(posixPath), posixPath);
    });

    void it("runs faster on the common POSIX-path case", () => {
        const samples = Array.from({ length: 2000 }, (_, index) => `objects/object_${index}/step.gml`);
        const iterations = 2000;

        for (let index = 0; index < 100; index += 1) {
            for (const sample of samples) {
                normalizeTrackedPathAlwaysReplace(sample);
                normalizeTrackedPathShortCircuit(sample);
            }
        }

        const oldStart = performance.now();
        for (let iteration = 0; iteration < iterations; iteration += 1) {
            for (const sample of samples) {
                normalizeTrackedPathAlwaysReplace(sample);
            }
        }
        const oldMs = performance.now() - oldStart;

        const newStart = performance.now();
        for (let iteration = 0; iteration < iterations; iteration += 1) {
            for (const sample of samples) {
                normalizeTrackedPathShortCircuit(sample);
            }
        }
        const newMs = performance.now() - newStart;

        assert.ok(
            newMs < oldMs,
            `expected short-circuit normalization (${newMs.toFixed(1)} ms) to beat replaceAll-only normalization (${oldMs.toFixed(1)} ms)`
        );
    });
});
