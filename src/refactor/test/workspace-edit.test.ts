/**
 * Tests for workspace-edit utilities
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
    getWorkspaceArrays,
    getWorkspaceEditRevision,
    getWorkspaceEditTelemetry,
    isWorkspaceEditLike,
    mergeWorkspaceEditInto,
    validateFileRenameOperations,
    WORKSPACE_EDIT_REVISION_TOKEN,
    WorkspaceEdit
} from "../src/workspace-edit.js";

void test("getWorkspaceArrays extracts valid arrays from workspace", () => {
    const workspace = new WorkspaceEdit();
    workspace.addMetadataEdit("file1.yy", "content1");
    workspace.addMetadataEdit("file2.yy", "content2");
    workspace.addFileRename("old.gml", "new.gml");

    const { metadataEdits, fileRenames } = getWorkspaceArrays(workspace);

    assert.equal(metadataEdits.length, 2);
    assert.equal(metadataEdits[0].path, "file1.yy");
    assert.equal(metadataEdits[0].content, "content1");
    assert.equal(metadataEdits[1].path, "file2.yy");
    assert.equal(metadataEdits[1].content, "content2");

    assert.equal(fileRenames.length, 1);
    assert.equal(fileRenames[0].oldPath, "old.gml");
    assert.equal(fileRenames[0].newPath, "new.gml");
});

void test("getWorkspaceArrays returns empty arrays when properties are missing", () => {
    const workspace = {};
    const { metadataEdits, fileRenames } = getWorkspaceArrays(workspace);

    assert.equal(metadataEdits.length, 0);
    assert.equal(fileRenames.length, 0);
});

void test("getWorkspaceArrays returns empty arrays when properties are not arrays", () => {
    const workspace = {
        metadataEdits: "not an array",
        fileRenames: 42
    };
    const { metadataEdits, fileRenames } = getWorkspaceArrays(workspace);

    assert.equal(metadataEdits.length, 0);
    assert.equal(fileRenames.length, 0);
});

void test("getWorkspaceArrays returns empty arrays when properties are null", () => {
    const workspace = {
        metadataEdits: null,
        fileRenames: null
    };
    const { metadataEdits, fileRenames } = getWorkspaceArrays(workspace);

    assert.equal(metadataEdits.length, 0);
    assert.equal(fileRenames.length, 0);
});

void test("getWorkspaceArrays returns empty arrays when properties are undefined", () => {
    const workspace = {
        metadataEdits: undefined,
        fileRenames: undefined
    };
    const { metadataEdits, fileRenames } = getWorkspaceArrays(workspace);

    assert.equal(metadataEdits.length, 0);
    assert.equal(fileRenames.length, 0);
});

void test("getWorkspaceArrays handles empty arrays", () => {
    const workspace = {
        metadataEdits: [],
        fileRenames: []
    };
    const { metadataEdits, fileRenames } = getWorkspaceArrays(workspace);

    assert.equal(metadataEdits.length, 0);
    assert.equal(fileRenames.length, 0);
});

void test("getWorkspaceArrays preserves array contents", () => {
    const expectedMetadata = [
        { path: "a.yy", content: "content-a" },
        { path: "b.yy", content: "content-b" }
    ];
    const expectedRenames = [{ oldPath: "x.gml", newPath: "y.gml" }];

    const workspace = {
        metadataEdits: expectedMetadata,
        fileRenames: expectedRenames
    };

    const { metadataEdits, fileRenames } = getWorkspaceArrays(workspace);

    assert.deepEqual(metadataEdits, expectedMetadata);
    assert.deepEqual(fileRenames, expectedRenames);
});

void test("isWorkspaceEditLike identifies valid workspace-edit-like objects", () => {
    const validWorkspaceEdit = {
        edits: [],
        addEdit() {},
        groupByFile() {
            return new Map();
        }
    };

    assert.equal(isWorkspaceEditLike(validWorkspaceEdit), true);
    assert.equal(isWorkspaceEditLike(new WorkspaceEdit()), true);
});

void test("isWorkspaceEditLike rejects non-conforming objects", () => {
    assert.equal(isWorkspaceEditLike({ edits: [] }), false);
    assert.equal(isWorkspaceEditLike({ edits: [], addEdit() {} }), false);
    assert.equal(isWorkspaceEditLike({ addEdit() {}, groupByFile() {} }), false);
    assert.equal(isWorkspaceEditLike(null), false);
    assert.equal(isWorkspaceEditLike(), false);
    assert.equal(
        isWorkspaceEditLike({
            edits: "not an array",
            addEdit() {},
            groupByFile() {}
        }),
        false
    );
});

void test("WorkspaceEdit telemetry tracks edit counts and byte high-water marks", () => {
    const workspace = new WorkspaceEdit();
    workspace.addEdit("scripts/a.gml", 0, 1, "hello");
    workspace.addEdit("scripts/b.gml", 0, 1, "world!");
    workspace.addMetadataEdit("objects/o.yy", '{"resource":"o"}');
    workspace.addFileRename("old/path.gml", "new/path.gml");

    const telemetry = getWorkspaceEditTelemetry(workspace);

    assert.equal(telemetry.textEditCount, 2);
    assert.equal(telemetry.metadataEditCount, 1);
    assert.equal(telemetry.fileRenameCount, 1);
    assert.ok(telemetry.touchedFileCount >= 4);
    assert.ok(telemetry.totalTextBytes > 0);
    assert.ok(telemetry.highWaterTextBytes >= telemetry.totalTextBytes);
});

void test("WorkspaceEdit ignores exact duplicate text edits", () => {
    const workspace = new WorkspaceEdit();

    workspace.addEdit("scripts/example.gml", 4, 12, "goodName");
    workspace.addEdit("scripts/example.gml", 4, 12, "goodName");
    workspace.addEdit("scripts/example.gml", 4, 12, "goodName");

    assert.equal(workspace.edits.length, 1);
    assert.deepEqual(workspace.edits[0], {
        path: "scripts/example.gml",
        start: 4,
        end: 12,
        newText: "goodName"
    });
});

void test("WorkspaceEdit groupByFile de-duplicates exact duplicates after the addEdit guard disables", () => {
    const workspace = new WorkspaceEdit();

    for (let index = 0; index <= 1024; index += 1) {
        workspace.addEdit("scripts/example.gml", index, index + 1, "x");
    }

    workspace.addEdit("scripts/example.gml", 1024, 1025, "x");
    assert.equal(workspace.edits.length, 1026);

    const grouped = workspace.groupByFile();
    const groupedEdits = grouped.get("scripts/example.gml") ?? [];
    assert.equal(groupedEdits.length, 1025);
});

void test("WorkspaceEdit revision only advances when the workspace changes", () => {
    const workspace = new WorkspaceEdit();

    assert.equal(getWorkspaceEditRevision(workspace), 0);

    workspace.addEdit("scripts/example.gml", 4, 12, "goodName");
    assert.equal(getWorkspaceEditRevision(workspace), 1);

    workspace.addEdit("scripts/example.gml", 4, 12, "goodName");
    assert.equal(getWorkspaceEditRevision(workspace), 1);

    workspace.addMetadataEdit("scripts/example.yy", '{"name":"goodName"}');
    assert.equal(getWorkspaceEditRevision(workspace), 2);

    workspace.addFileRename("scripts/example.gml", "scripts/good_name.gml");
    assert.equal(getWorkspaceEditRevision(workspace), 3);
});

void test("WorkspaceEdit reuses grouped edits until the edit set changes", () => {
    const workspace = new WorkspaceEdit();
    workspace.addEdit("scripts/example.gml", 8, 12, "demoName");

    const firstGrouping = workspace.groupByFile();
    const secondGrouping = workspace.groupByFile();

    assert.equal(firstGrouping, secondGrouping);

    workspace.addEdit("scripts/example.gml", 0, 4, "demo");

    const thirdGrouping = workspace.groupByFile();

    assert.notEqual(thirdGrouping, firstGrouping);
    assert.deepEqual(thirdGrouping.get("scripts/example.gml"), [
        {
            start: 8,
            end: 12,
            newText: "demoName"
        },
        {
            start: 0,
            end: 4,
            newText: "demo"
        }
    ]);
});

void test("validateFileRenameOperations rejects duplicate sources, duplicate destinations, and rename chains", () => {
    const errors = validateFileRenameOperations([
        { oldPath: "scripts/a.gml", newPath: "scripts/b.gml" },
        { oldPath: "scripts/a.gml", newPath: "scripts/c.gml" },
        { oldPath: "scripts/d.gml", newPath: "scripts/c.gml" },
        { oldPath: "scripts/b.gml", newPath: "scripts/e.gml" }
    ]);

    assert.ok(errors.some((error) => error.includes("Duplicate file rename source detected for scripts/a.gml")));
    assert.ok(errors.some((error) => error.includes("Duplicate file rename destination detected for scripts/c.gml")));
    assert.ok(
        errors.some((error) =>
            error.includes("File rename destination scripts/b.gml is also scheduled as a rename source")
        )
    );
});

void test("validateFileRenameOperations rejects empty and unchanged paths", () => {
    const errors = validateFileRenameOperations([
        { oldPath: "", newPath: "scripts/b.gml" },
        { oldPath: "scripts/c.gml", newPath: "" },
        { oldPath: "scripts/d.gml", newPath: "scripts/d.gml" }
    ]);

    assert.ok(errors.some((error) => error.includes("source path must be a non-empty string")));
    assert.ok(errors.some((error) => error.includes("destination path must be a non-empty string")));
    assert.ok(errors.some((error) => error.includes("must change the path")));
});

void test("getWorkspaceEditRevision returns null for objects that do not implement WORKSPACE_EDIT_REVISION_TOKEN", () => {
    assert.equal(getWorkspaceEditRevision({}), null);
    assert.equal(getWorkspaceEditRevision({ edits: [], addEdit() {}, groupByFile() {} }), null);
});

void test("getWorkspaceEditRevision reads revision from any object implementing WORKSPACE_EDIT_REVISION_TOKEN", () => {
    // A minimal substitutable workspace implementation that exposes revision via
    // the well-known symbol, without extending WorkspaceEdit.
    let internalRevision = 0;

    const substituteWorkspace = {
        edits: [] as Array<{ path: string; start: number; end: number; newText: string }>,
        addEdit(path: string, start: number, end: number, newText: string) {
            this.edits.push({ path, start, end, newText });
            internalRevision += 1;
        },
        groupByFile() {
            return new Map();
        },
        [WORKSPACE_EDIT_REVISION_TOKEN]() {
            return internalRevision;
        }
    };

    assert.equal(getWorkspaceEditRevision(substituteWorkspace), 0);

    substituteWorkspace.addEdit("scripts/example.gml", 0, 5, "hello");
    assert.equal(getWorkspaceEditRevision(substituteWorkspace), 1);

    substituteWorkspace.addEdit("scripts/other.gml", 3, 7, "world");
    assert.equal(getWorkspaceEditRevision(substituteWorkspace), 2);
});

void test("WORKSPACE_EDIT_REVISION_TOKEN on WorkspaceEdit returns the same value as getWorkspaceEditRevision", () => {
    const workspace = new WorkspaceEdit();

    assert.equal(workspace[WORKSPACE_EDIT_REVISION_TOKEN](), getWorkspaceEditRevision(workspace));

    workspace.addEdit("scripts/a.gml", 0, 4, "test");

    assert.equal(workspace[WORKSPACE_EDIT_REVISION_TOKEN](), getWorkspaceEditRevision(workspace));
});

void test("mergeWorkspaceEditInto is a no-op when source is null", () => {
    const target = new WorkspaceEdit();
    target.addEdit("a.gml", 0, 3, "foo");

    mergeWorkspaceEditInto(target, null);

    assert.equal(target.edits.length, 1);
    assert.equal(target.fileRenames.length, 0);
    assert.equal(target.metadataEdits.length, 0);
});

void test("mergeWorkspaceEditInto is a no-op when source is undefined", () => {
    const target = new WorkspaceEdit();
    target.addEdit("a.gml", 0, 3, "foo");

    mergeWorkspaceEditInto(target, undefined);

    assert.equal(target.edits.length, 1);
    assert.equal(target.fileRenames.length, 0);
    assert.equal(target.metadataEdits.length, 0);
});

void test("mergeWorkspaceEditInto merges text edits into target", () => {
    const target = new WorkspaceEdit();
    target.addEdit("a.gml", 0, 3, "foo");

    const source = new WorkspaceEdit();
    source.addEdit("b.gml", 10, 15, "bar");

    mergeWorkspaceEditInto(target, source);

    assert.equal(target.edits.length, 2);
    assert.ok(target.edits.some((e) => e.path === "a.gml"));
    assert.ok(target.edits.some((e) => e.path === "b.gml" && e.newText === "bar"));
});

void test("mergeWorkspaceEditInto merges file renames into target", () => {
    const target = new WorkspaceEdit();

    const source = new WorkspaceEdit();
    source.addFileRename("old.gml", "new.gml");

    mergeWorkspaceEditInto(target, source);

    assert.equal(target.fileRenames.length, 1);
    assert.equal(target.fileRenames[0]?.oldPath, "old.gml");
    assert.equal(target.fileRenames[0]?.newPath, "new.gml");
});

void test("mergeWorkspaceEditInto merges metadata edits into target", () => {
    const target = new WorkspaceEdit();

    const source = new WorkspaceEdit();
    source.addMetadataEdit("resource.yy", '{"name":"foo"}');

    mergeWorkspaceEditInto(target, source);

    assert.equal(target.metadataEdits.length, 1);
    assert.equal(target.metadataEdits[0]?.path, "resource.yy");
    assert.equal(target.metadataEdits[0]?.content, '{"name":"foo"}');
});

void test("mergeWorkspaceEditInto merges all edit types simultaneously", () => {
    const target = new WorkspaceEdit();
    target.addEdit("existing.gml", 0, 5, "existing");

    const source = new WorkspaceEdit();
    source.addEdit("src.gml", 1, 4, "hello");
    source.addFileRename("old_dir/res.yy", "new_dir/res.yy");
    source.addMetadataEdit("res.yy", '{"name":"updated"}');

    mergeWorkspaceEditInto(target, source);

    assert.equal(target.edits.length, 2);
    assert.equal(target.fileRenames.length, 1);
    assert.equal(target.metadataEdits.length, 1);
});

void test("mergeWorkspaceEditInto respects the exact-duplicate guard on target", () => {
    const target = new WorkspaceEdit();
    target.addEdit("a.gml", 0, 3, "foo");

    // Source carries an exact copy of the same edit that is already in target.
    const source = new WorkspaceEdit();
    source.addEdit("a.gml", 0, 3, "foo");

    mergeWorkspaceEditInto(target, source);

    // The duplicate guard on WorkspaceEdit should suppress the second insertion.
    assert.equal(target.edits.length, 1);
});
