/**
 * Focused tests for the pure helpers extracted into `watch/directory-scan.ts`.
 *
 * The watched-directory walk primitives are reused by the initial scan and
 * the unknown-event reconciliation pass. Each helper carries no mutable
 * state apart from the shared `IGNORED_WATCH_DIRECTORY_NAMES` set, so the
 * assertions can verify normal-path behaviour without spinning up the full
 * watch command.
 */

import assert from "node:assert/strict";
import type { Dirent } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
    IGNORED_WATCH_DIRECTORY_NAMES,
    isRoomResourcePath,
    normalizeWatchedPathSegments,
    partitionScannedDirectoryEntries,
    shouldIgnoreWatchedPath,
    sourceCanDeclareMacroMetadata
} from "../src/commands/watch/directory-scan.js";
import { createExtensionMatcher } from "../src/commands/watch/source-analysis.js";

void describe("watch directory scan helpers", () => {
    void it("normalizeWatchedPathSegments strips separators and empty segments", () => {
        assert.deepEqual(normalizeWatchedPathSegments(""), []);
        assert.deepEqual(normalizeWatchedPathSegments("/a/b//c/"), ["a", "b", "c"]);
        assert.deepEqual(normalizeWatchedPathSegments(String.raw`a\b\c`), ["a", "b", "c"]);
        assert.deepEqual(normalizeWatchedPathSegments("relative/path"), ["relative", "path"]);
    });

    void it("shouldIgnoreWatchedPath rejects default-ignored directories anywhere in the path", () => {
        assert.equal(shouldIgnoreWatchedPath("/project/secret.gml"), false);
        assert.equal(shouldIgnoreWatchedPath("/project/.git/HEAD"), true);
        assert.equal(shouldIgnoreWatchedPath("/project/objects/cache/x.gml"), true);

        // Relativizing against a watch root ignores the root itself even when
        // the root's basename happens to match an ignored name.
        assert.equal(
            shouldIgnoreWatchedPath(path.join("/tmp", "cache", "subfile.gml"), path.join("/tmp", "cache")),
            false
        );
    });

    void it("IGNORED_WATCH_DIRECTORY_NAMES exposes the constant set from constants.ts", () => {
        assert.ok(IGNORED_WATCH_DIRECTORY_NAMES instanceof Set, "should expose a Set for O(1) membership checks");
        // Spot-check a couple of canonical entries that every watch invocation
        // must keep ignoring so existing repository fixtures stay correct.
        assert.equal(IGNORED_WATCH_DIRECTORY_NAMES.has(".git"), true);
        assert.equal(IGNORED_WATCH_DIRECTORY_NAMES.has("node_modules"), true);
    });

    void it("isRoomResourcePath matches only paths under a rooms segment", () => {
        assert.equal(isRoomResourcePath("/project/rooms/rm_main.yy"), true);
        assert.equal(isRoomResourcePath("/project/rooms"), true);
        assert.equal(isRoomResourcePath("/project/objects/obj_player/Create_0.gml"), false);
    });

    void it("partitionScannedDirectoryEntries routes files and directories to the right buckets", () => {
        const watchRoot = "/project";
        const currentPath = path.join(watchRoot, "rooms");
        const entries: Array<Dirent> = [
            createDirent("rm_main.yy", "file"),
            createDirent("widgets", "directory"),
            createDirent(".gmcache", "directory"),
            createDirent("scr_player.gml", "file")
        ];
        const matcher = createExtensionMatcher([".gml"]);
        const secondaryMatcher = createExtensionMatcher([".yy"]);

        const { files, directories, secondaryFiles } = partitionScannedDirectoryEntries(
            currentPath,
            entries,
            matcher,
            watchRoot,
            secondaryMatcher
        );

        assert.deepEqual(
            files.map((entry) => path.basename(entry)),
            ["scr_player.gml"]
        );
        assert.deepEqual(
            directories.map((entry) => path.basename(entry)),
            ["widgets"]
        );
        assert.deepEqual(
            secondaryFiles.map((entry) => path.basename(entry)),
            ["rm_main.yy"]
        );
    });

    void it("partitionScannedDirectoryEntries drops secondary files outside the rooms segment", () => {
        const watchRoot = "/project";
        const currentPath = path.join(watchRoot, "objects");
        const entries: Array<Dirent> = [createDirent("rm_other.yy", "file")];
        const matcher = createExtensionMatcher([".gml"]);
        const secondaryMatcher = createExtensionMatcher([".yy"]);

        const { secondaryFiles } = partitionScannedDirectoryEntries(
            currentPath,
            entries,
            matcher,
            watchRoot,
            secondaryMatcher
        );

        assert.equal(secondaryFiles.length, 0, "yy files outside rooms/ should not enter the room channel");
    });

    void it("sourceCanDeclareMacroMetadata flags both #macro and #define declarations", () => {
        assert.equal(sourceCanDeclareMacroMetadata("// no directives"), false);
        assert.equal(sourceCanDeclareMacroMetadata("#macro FOO 1"), true);
        assert.equal(sourceCanDeclareMacroMetadata("#region foo\n#define REGION_GUARD"), true);
    });
});

function createDirent(name: string, kind: "file" | "directory"): Dirent {
    return {
        name,
        isFile: () => kind === "file",
        isDirectory: () => kind === "directory",
        isBlockDevice: () => false,
        isCharacterDevice: () => false,
        isSymbolicLink: () => false,
        isFIFO: () => false,
        isSocket: () => false,
        path: "",
        parentPath: ""
    } as Dirent;
}
