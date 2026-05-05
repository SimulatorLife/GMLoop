import assert from "node:assert/strict";
import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { Core } from "@gmloop/core";

void test("listRelativeFilePathsRecursively returns sorted POSIX-style relative paths", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "core-recursive-files-"));
    await mkdir(path.join(rootPath, "scripts", "nested"), { recursive: true });
    await mkdir(path.join(rootPath, "assets"), { recursive: true });
    await writeFile(path.join(rootPath, "scripts", "beta.gml"), "beta", "utf8");
    await writeFile(path.join(rootPath, "scripts", "nested", "alpha.gml"), "alpha", "utf8");
    await writeFile(path.join(rootPath, "assets", "icon.png"), "png", "utf8");

    const relativePaths = await Core.listRelativeFilePathsRecursively(rootPath);

    assert.deepEqual(relativePaths, ["assets/icon.png", "scripts/beta.gml", "scripts/nested/alpha.gml"]);
});

void test("listRelativeFilePathsRecursively applies includeFile filters", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "core-recursive-files-filter-"));
    await mkdir(path.join(rootPath, "scripts"), { recursive: true });
    await writeFile(path.join(rootPath, "scripts", "keep.gml"), "keep", "utf8");
    await writeFile(path.join(rootPath, "scripts", "skip.txt"), "skip", "utf8");

    const relativePaths = await Core.listRelativeFilePathsRecursively(rootPath, {
        includeFile: ({ entryName }) => entryName.endsWith(".gml")
    });

    assert.deepEqual(relativePaths, ["scripts/keep.gml"]);
});

void test("listRelativeFilePathsRecursively ignores non-file entries", async () => {
    const rootPath = await mkdtemp(path.join(os.tmpdir(), "core-recursive-files-non-file-"));
    await mkdir(path.join(rootPath, "scripts"), { recursive: true });
    await writeFile(path.join(rootPath, "scripts", "keep.gml"), "keep", "utf8");
    await symlink(path.join(rootPath, "scripts", "keep.gml"), path.join(rootPath, "scripts", "keep-link.gml"));

    const relativePaths = await Core.listRelativeFilePathsRecursively(rootPath);

    assert.deepEqual(relativePaths, ["scripts/keep.gml"]);
});
