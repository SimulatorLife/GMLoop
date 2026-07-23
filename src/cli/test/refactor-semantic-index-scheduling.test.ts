import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import type { Refactor } from "@gmloop/refactor";

import {
    shouldDeferInitialSemanticIndexBuild,
    toModifiedSemanticIndexChanges
} from "../src/commands/refactor-semantic-index-scheduling.js";

type RefactorCodemodId = ReturnType<typeof Refactor.listRegisteredCodemods>[number]["id"];

const semanticIndexDependentCodemodIds: ReadonlySet<RefactorCodemodId> = new Set(["namingConvention"]);

void test("shouldDeferInitialSemanticIndexBuild defers when a non-semantic codemod runs before the first semantic one", () => {
    assert.equal(
        shouldDeferInitialSemanticIndexBuild(
            ["loopLengthHoisting", "namingConvention"],
            semanticIndexDependentCodemodIds
        ),
        true
    );
});

void test("shouldDeferInitialSemanticIndexBuild does not defer when the first selected codemod already needs the index", () => {
    assert.equal(
        shouldDeferInitialSemanticIndexBuild(
            ["namingConvention", "loopLengthHoisting"],
            semanticIndexDependentCodemodIds
        ),
        false
    );
});

void test("shouldDeferInitialSemanticIndexBuild does not defer when no selected codemod needs the semantic index", () => {
    assert.equal(shouldDeferInitialSemanticIndexBuild(["loopLengthHoisting"], semanticIndexDependentCodemodIds), false);
});

void test("toModifiedSemanticIndexChanges resolves each path against the project root as a modified change", () => {
    const projectRoot = "/gml/project";

    assert.deepEqual(toModifiedSemanticIndexChanges(projectRoot, ["scripts/foo.gml", "scripts/bar.gml"]), [
        { filePath: path.resolve(projectRoot, "scripts/foo.gml"), kind: "modified" },
        { filePath: path.resolve(projectRoot, "scripts/bar.gml"), kind: "modified" }
    ]);
});

void test("toModifiedSemanticIndexChanges returns an empty list for no changed files", () => {
    assert.deepEqual(toModifiedSemanticIndexChanges("/gml/project", []), []);
});
