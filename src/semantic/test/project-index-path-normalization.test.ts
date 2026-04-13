import assert from "node:assert/strict";
import path from "node:path";
import { describe, it } from "node:test";

import {
    normalizeProjectResourcePath,
    resolveProjectDisplayPath,
    resolveProjectRelativeFilePath
} from "../src/project-index/path-normalization.js";

void describe("project-index/path-normalization", () => {
    void it("normalizes Windows-style absolute paths against a project root", () => {
        const projectRoot = path.win32.join("C:\\", "GameMaker", "Project");
        const filePath = path.win32.join(projectRoot, "scripts", "init.gml");

        const result = normalizeProjectResourcePath(filePath, { projectRoot });

        assert.strictEqual(result, "scripts/init.gml");
    });

    void it("returns parent-relative paths for resource paths outside of the project root", () => {
        const projectRoot = path.posix.join("/workspace", "project");
        const outsideFilePath = path.posix.join("/workspace", "other", "scripts", "init.gml");

        const result = normalizeProjectResourcePath(outsideFilePath, { projectRoot });

        assert.strictEqual(result, "../other/scripts/init.gml");
    });

    void it("resolves project-relative file paths when a file is inside the project", () => {
        const projectRoot = path.posix.join("/workspace", "project");
        const insideFilePath = path.posix.join(projectRoot, "objects", "obj_player", "Step_0.gml");

        const result = resolveProjectRelativeFilePath(projectRoot, insideFilePath);

        assert.strictEqual(result, "objects/obj_player/Step_0.gml");
    });

    void it("keeps display paths unchanged for relative input", () => {
        const projectRoot = path.posix.join("/workspace", "project");
        const relativeFilePath = "scripts/init.gml";

        const result = resolveProjectDisplayPath(relativeFilePath, projectRoot);

        assert.strictEqual(result, relativeFilePath);
    });
});
