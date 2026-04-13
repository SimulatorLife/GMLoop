import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import * as WorkflowFixtureRoots from "../src/workflow/path-filter.js";
import { DEFAULT_FIXTURE_DIRECTORIES, normalizeFixtureRoots } from "../src/workflow/path-filter.js";

void describe("workflow fixture root normalization", () => {
    void it("deduplicates additional roots that overlap defaults", () => {
        const firstDefault = DEFAULT_FIXTURE_DIRECTORIES[0];
        const normalized = normalizeFixtureRoots([firstDefault, firstDefault]);

        assert.equal(
            normalized.filter((entry) => entry === firstDefault).length,
            1,
            "expected duplicated fixture roots to be collapsed"
        );
    });

    void it("applies allow/deny filters to normalized fixture roots", () => {
        const allowedRoot = path.resolve("/tmp", "fixture-roots", "allowed");
        const deniedRoot = path.resolve(allowedRoot, "denied");

        const normalized = normalizeFixtureRoots([allowedRoot, deniedRoot], {
            allowPaths: [allowedRoot],
            denyPaths: [deniedRoot]
        });

        assert.ok(normalized.includes(allowedRoot));
        assert.equal(normalized.includes(deniedRoot), false);
    });

    void it("applies canonical allowPaths/denyPaths for fixture path filtering", () => {
        const root = path.resolve("/tmp", "fixture-roots", "canonical");
        const includedRoot = path.join(root, "included");
        const excludedRoot = path.join(includedRoot, "excluded");

        const normalized = normalizeFixtureRoots([includedRoot, excludedRoot], {
            allowPaths: [includedRoot],
            denyPaths: [excludedRoot]
        });

        assert.ok(normalized.includes(includedRoot));
        assert.equal(normalized.includes(excludedRoot), false);
    });

    void it("normalizes iterable fixture roots without requiring array inputs", () => {
        function* createFixtureRoots(): Iterable<string> {
            yield DEFAULT_FIXTURE_DIRECTORIES[0];
            yield DEFAULT_FIXTURE_DIRECTORIES[1];
        }

        const normalized = normalizeFixtureRoots(createFixtureRoots());

        assert.ok(normalized.includes(DEFAULT_FIXTURE_DIRECTORIES[0]));
        assert.ok(normalized.includes(DEFAULT_FIXTURE_DIRECTORIES[1]));
    });

    void it("does not re-export REPO_ROOT from workflow fixture-roots", () => {
        assert.equal(
            Object.hasOwn(WorkflowFixtureRoots, "REPO_ROOT"),
            false,
            "workflow fixture-roots should not keep the legacy REPO_ROOT pass-through export"
        );
    });
});
