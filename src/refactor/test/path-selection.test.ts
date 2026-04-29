import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { createPathSelectionMatcher, resolveProjectPath } from "../src/codemods/naming-convention/path-selection.js";

void test("resolveProjectPath resolves relative and preserves absolute paths", () => {
    const projectRoot = "/workspace/project";

    assert.equal(
        resolveProjectPath(projectRoot, "scripts/player.gml"),
        path.resolve(projectRoot, "scripts/player.gml")
    );
    assert.equal(resolveProjectPath(projectRoot, "/tmp/example.gml"), "/tmp/example.gml");
});

void test("createPathSelectionMatcher allows all paths when allow list is empty", () => {
    const isSelected = createPathSelectionMatcher("/workspace/project", [], []);
    assert.equal(isSelected("scripts/player.gml"), true);
});

void test("createPathSelectionMatcher applies allow list using exact and descendant matches", () => {
    const isSelected = createPathSelectionMatcher("/workspace/project", ["scripts/player"], []);
    assert.equal(isSelected("scripts/player/step.gml"), true);
    assert.equal(isSelected("scripts/enemy.gml"), false);
});

void test("createPathSelectionMatcher applies deny list after allow list checks", () => {
    const isSelected = createPathSelectionMatcher("/workspace/project", ["scripts"], ["scripts/player"]);
    assert.equal(isSelected("scripts/player/step.gml"), false);
    assert.equal(isSelected("scripts/enemy/step.gml"), true);
});

void test("createPathSelectionMatcher reuses resolved path selections across multiple candidates", () => {
    const projectRoot = "/workspace/project";
    const isSelected = createPathSelectionMatcher(projectRoot, ["scripts", "/tmp/shared"], ["scripts/player"]);

    assert.equal(isSelected("scripts/enemy/step.gml"), true);
    assert.equal(isSelected("scripts/player/step.gml"), false);
    assert.equal(isSelected("/tmp/shared/child.gml"), true);
    assert.equal(isSelected("objects/o_player/o_player.yy"), false);
});
