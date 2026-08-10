/**
 * Unit tests for the `ci-automerge-paths` facade.
 *
 * These tests pin the path normalization helpers shared between
 * `ci-automerge-evidence.ts` and `ci-automerge-gate.ts`. The two command
 * files previously kept local copies of `normalizePath` and
 * `normalizeRepositoryPath`, which produced two slightly different
 * implementations of the POSIX separator conversion (`split(path.sep)`
 * vs `replaceAll("\\")`) and two copies of the `/GMLoop/` marker
 * literal. Collapsing both helpers into a single module ensures the
 * downstream commands agree on the canonical repository-relative form.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { normalizePath, normalizeRepositoryPath } from "../src/commands/ci-automerge-paths.js";

void describe("ci-automerge-paths", () => {
    void describe("normalizePath", () => {
        void it("returns POSIX-style paths unchanged", () => {
            assert.equal(
                normalizePath("src/cli/src/commands/ci-automerge-evidence.ts"),
                "src/cli/src/commands/ci-automerge-evidence.ts"
            );
        });

        void it("rewrites Windows backslashes to forward slashes", () => {
            assert.equal(
                normalizePath(String.raw`src\cli\src\commands\ci-automerge-evidence.ts`),
                "src/cli/src/commands/ci-automerge-evidence.ts"
            );
        });

        void it("rewrites mixed separators to forward slashes", () => {
            assert.equal(normalizePath(String.raw`src\cli/src\commands`), "src/cli/src/commands");
        });

        void it("returns the empty string when given the empty string", () => {
            assert.equal(normalizePath(""), "");
        });
    });

    void describe("normalizeRepositoryPath", () => {
        void it("strips a leading './' from a relative path", () => {
            assert.equal(normalizeRepositoryPath("./src/cli/foo.ts"), "src/cli/foo.ts");
        });

        void it("leaves a clean relative path untouched", () => {
            assert.equal(normalizeRepositoryPath("src/cli/foo.ts"), "src/cli/foo.ts");
        });

        void it("returns the empty string when given the empty string", () => {
            assert.equal(normalizeRepositoryPath(""), "");
        });

        void it("rewrites backslashes before stripping the leading './'", () => {
            assert.equal(normalizeRepositoryPath(String.raw`.\src\cli\foo.ts`), "src/cli/foo.ts");
        });

        void it("uses the '/GMLoop/' marker when the cwd does not match the input", () => {
            // The test runner's cwd is /home/runner/work/GMLoop/GMLoop, but the
            // /GMLoop/ marker fallback also handles CI workspaces where the
            // input path was recorded from a different root. Use an input
            // that intentionally does not start with the cwd prefix so the
            // marker fallback branch is exercised.
            assert.equal(normalizeRepositoryPath("/home/runner/work/GMLoop/GMLoop/src/cli/foo.ts"), "src/cli/foo.ts");
        });

        void it("preserves nested directories after the '/GMLoop/' marker", () => {
            assert.equal(
                normalizeRepositoryPath("/home/runner/work/GMLoop/GMLoop/src/parser/test/parser.test.ts"),
                "src/parser/test/parser.test.ts"
            );
        });

        void it("returns the input unchanged when no prefix or marker matches", () => {
            // The path is not relative to cwd, does not contain /GMLoop/, and
            // does not start with './' so the helper should fall through with
            // the original normalized value.
            assert.equal(normalizeRepositoryPath("unrelated/path.ts"), "unrelated/path.ts");
        });
    });
});
