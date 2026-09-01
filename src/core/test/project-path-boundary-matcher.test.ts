import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { createProjectPathBoundaryMatcher, resolveProjectPath } from "../src/fs/path.js";

void test("resolveProjectPath resolves relative entries from the project root and preserves absolute paths", () => {
    const projectRoot = "/workspace/project";

    assert.equal(
        resolveProjectPath(projectRoot, "scripts/player.gml"),
        path.resolve(projectRoot, "scripts/player.gml")
    );
    assert.equal(resolveProjectPath(projectRoot, "/tmp/example.gml"), "/tmp/example.gml");
});

void test("resolveProjectPath preserves Windows absolute paths on non-Windows hosts", () => {
    assert.equal(
        resolveProjectPath("/workspace/project", String.raw`C:\Project\scripts\player.gml`),
        String.raw`C:\Project\scripts\player.gml`
    );
    assert.equal(
        resolveProjectPath("/workspace/project", String.raw`\\server\share\scripts\player.gml`),
        String.raw`\\server\share\scripts\player.gml`
    );
});

void test("createProjectPathBoundaryMatcher allows all paths when allow list is empty", () => {
    const isSelected = createProjectPathBoundaryMatcher({
        projectRoot: "/workspace/project",
        allowedPaths: [],
        deniedPaths: []
    });
    assert.equal(isSelected("scripts/player.gml"), true);
});

void test("createProjectPathBoundaryMatcher applies allow and deny lists using boundary matches", () => {
    const isSelected = createProjectPathBoundaryMatcher({
        projectRoot: "/workspace/project",
        allowedPaths: ["scripts"],
        deniedPaths: ["scripts/player"]
    });

    assert.equal(isSelected("scripts/player/step.gml"), false);
    assert.equal(isSelected("scripts/enemy/step.gml"), true);
    assert.equal(isSelected("objects/o_player/o_player.yy"), false);
});

void test("createProjectPathBoundaryMatcher can keep ancestor directories of allowed descendants", () => {
    const isSelected = createProjectPathBoundaryMatcher({
        projectRoot: "/workspace/project",
        allowedPaths: ["scripts/player/step.gml"],
        deniedPaths: [],
        allowAncestorDirectories: true
    });

    assert.equal(isSelected("scripts"), true);
    assert.equal(isSelected("objects"), false);
});
