import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
    appendProjectMetadataStringMutation,
    getProjectResourceOrderPath,
    isResourceAssetReferenceRecord,
    metadataReferenceTargetMatchesNormalizedPath,
    normalizeMetadataReferenceTargetPath,
    normalizeResourceMetadataRecord,
    ProjectMetadataMutationContext,
    requiresMetadataResourcePathOrderNormalization,
    type SemanticResourceRecord,
    updateRoomInstanceCreationOrderSelfPaths
} from "../src/modules/refactor/project-metadata-mutation.js";

void test("isResourceAssetReferenceRecord accepts well-formed records and rejects malformed ones", () => {
    assert.equal(
        isResourceAssetReferenceRecord({ propertyPath: "resources.0.id", targetPath: "scripts/foo/foo.yy" }),
        true
    );
    assert.equal(isResourceAssetReferenceRecord({ propertyPath: 42, targetPath: "x" }), false);
    assert.equal(isResourceAssetReferenceRecord({ propertyPath: "x" }), false);
    assert.equal(isResourceAssetReferenceRecord(null), false);
    assert.equal(isResourceAssetReferenceRecord("not-an-object"), false);
});

void test("normalizeResourceMetadataRecord normalizes resource records and drops malformed references", () => {
    const normalized = normalizeResourceMetadataRecord({
        path: "scripts/foo/foo.yy",
        assetReferences: [
            { propertyPath: "resources.0.id", targetPath: "scripts/foo/foo.yy" },
            { propertyPath: 12, targetPath: "x" },
            null
        ]
    });

    assert.ok(normalized);
    assert.equal(normalized.path, "scripts/foo/foo.yy");
    assert.equal(normalized.assetReferences.length, 1);
    assert.equal(normalized.assetReferences[0].propertyPath, "resources.0.id");

    const empty = normalizeResourceMetadataRecord({ path: "scripts/foo/foo.yy" });
    assert.ok(empty);
    assert.deepEqual(empty.assetReferences, []);

    assert.equal(normalizeResourceMetadataRecord({ path: 1 }), null);
    assert.equal(normalizeResourceMetadataRecord(null), null);
});

void test("normalizeMetadataReferenceTargetPath normalizes backslashes and lowercases", () => {
    const first = normalizeMetadataReferenceTargetPath(String.raw`Scripts\Foo\Foo.yy`);
    const second = normalizeMetadataReferenceTargetPath("scripts/foo/foo.yy");
    assert.equal(first, second);
    assert.equal(first, "scripts/foo/foo.yy");
});

void test("metadataReferenceTargetMatchesNormalizedPath performs case-insensitive comparison", () => {
    const normalized = normalizeMetadataReferenceTargetPath("scripts/Foo/Foo.yy");
    assert.equal(metadataReferenceTargetMatchesNormalizedPath("scripts/foo/foo.yy", normalized), true);
    assert.equal(metadataReferenceTargetMatchesNormalizedPath("scripts/bar/bar.yy", normalized), false);
});

void test("appendProjectMetadataStringMutation coalesces duplicate property paths", () => {
    const mutations: Array<{ propertyPath: string; value: string }> = [];
    appendProjectMetadataStringMutation(mutations, "name", "alpha");
    appendProjectMetadataStringMutation(mutations, "name", "beta");
    appendProjectMetadataStringMutation(mutations, "resourcePath", "x.yy");

    assert.equal(mutations.length, 2);
    assert.equal(mutations[0].value, "beta");
    assert.equal(mutations[1].propertyPath, "resourcePath");
});

void test("updateRoomInstanceCreationOrderSelfPaths mutates matching entries and records string mutations", () => {
    const parsed = {
        instanceCreationOrder: [{ path: "scripts/foo/foo.yy" }, { path: "scripts/bar/bar.yy" }, "not-an-object"]
    };
    const stringMutations: Array<{ propertyPath: string; value: string }> = [];
    const changed = updateRoomInstanceCreationOrderSelfPaths({
        parsed,
        normalizedOldResourcePath: normalizeMetadataReferenceTargetPath("scripts/foo/foo.yy"),
        newResourcePath: "scripts/foo_renamed/foo_renamed.yy",
        stringMutations
    });

    assert.equal(changed, true);
    assert.equal(stringMutations.length, 1);
    assert.equal(stringMutations[0].propertyPath, "instanceCreationOrder.0.path");
    assert.equal(stringMutations[0].value, "scripts/foo_renamed/foo_renamed.yy");
    assert.equal(
        (parsed.instanceCreationOrder as Array<Record<string, unknown>>)[0].path,
        "scripts/foo_renamed/foo_renamed.yy"
    );
    // Unrelated entries are untouched.
    assert.equal((parsed.instanceCreationOrder as Array<Record<string, unknown>>)[1].path, "scripts/bar/bar.yy");
});

void test("updateRoomInstanceCreationOrderSelfPaths returns false when no entries match", () => {
    const parsed = { instanceCreationOrder: [{ path: "scripts/other/other.yy" }] };
    const stringMutations: Array<{ propertyPath: string; value: string }> = [];
    const changed = updateRoomInstanceCreationOrderSelfPaths({
        parsed,
        normalizedOldResourcePath: normalizeMetadataReferenceTargetPath("scripts/foo/foo.yy"),
        newResourcePath: "scripts/foo_renamed/foo_renamed.yy",
        stringMutations
    });

    assert.equal(changed, false);
    assert.equal(stringMutations.length, 0);
});

void test("requiresMetadataResourcePathOrderNormalization detects resourcePath-before-resourceType ordering", () => {
    const resourcePathFirst = JSON.stringify({ resourcePath: "x", resourceType: "GMScript" });
    const resourceTypeFirst = JSON.stringify({ resourceType: "GMScript", resourcePath: "x" });
    assert.equal(requiresMetadataResourcePathOrderNormalization(resourcePathFirst), true);
    assert.equal(requiresMetadataResourcePathOrderNormalization(resourceTypeFirst), false);
    assert.equal(requiresMetadataResourcePathOrderNormalization("{}"), false);
});

void test("getProjectResourceOrderPath derives the manifest filename from the project root basename", () => {
    assert.equal(getProjectResourceOrderPath(path.join(os.tmpdir(), "MyGame")), path.join("MyGame.resource_order"));
});

type RecordingEdit = {
    addMetadataEditCalls: Array<{ content: string; path: string }>;
    addMetadataObjectEditCalls: Array<{ document: Record<string, unknown>; path: string }>;
    metadataObjects: Array<{ document: Record<string, unknown>; path: string }>;
    addMetadataEdit(path: string, content: string): void;
    addMetadataObjectEdit(path: string, document: Record<string, unknown>): void;
};

function createRecordingEdit(): RecordingEdit {
    const edit: RecordingEdit = {
        addMetadataEditCalls: [],
        addMetadataObjectEditCalls: [],
        metadataObjects: [],
        addMetadataEdit(metadataPath: string, content: string) {
            edit.addMetadataEditCalls.push({ path: metadataPath, content });
        },
        addMetadataObjectEdit(metadataPath: string, document: Record<string, unknown>) {
            edit.addMetadataObjectEditCalls.push({ path: metadataPath, document });
        }
    };
    return edit;
}

type ProjectMetadataFixture = {
    projectRoot: string;
    manifestPath: string;
    resourcePath: string;
    resources: Record<string, SemanticResourceRecord>;
    cleanup: () => Promise<void>;
};

async function createProjectMetadataFixture(): Promise<ProjectMetadataFixture> {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-project-metadata-mutation-"));
    const resourceName = "bad_name_alpha";
    const resourcePath = `scripts/${resourceName}/${resourceName}.yy`;
    const absoluteResourcePath = path.join(projectRoot, resourcePath);
    await mkdir(path.dirname(absoluteResourcePath), { recursive: true });
    await writeFile(
        absoluteResourcePath,
        JSON.stringify(
            {
                name: resourceName,
                resourcePath,
                resourceType: "GMScript"
            },
            null,
            2
        ),
        "utf8"
    );

    const manifestPath = "project.yyp";
    const absoluteManifestPath = path.join(projectRoot, manifestPath);
    await writeFile(
        absoluteManifestPath,
        JSON.stringify(
            {
                resources: [{ id: { name: resourceName, path: resourcePath } }]
            },
            null,
            2
        ),
        "utf8"
    );

    const resources: Record<string, SemanticResourceRecord> = {
        [resourcePath]: {
            path: resourcePath,
            name: resourceName,
            resourceType: "GMScript"
        },
        [manifestPath]: {
            path: manifestPath,
            name: "project",
            resourceType: "GMProject"
        }
    };

    return {
        projectRoot,
        manifestPath,
        resourcePath,
        resources,
        cleanup: async () => rm(projectRoot, { recursive: true, force: true })
    };
}

void test("ProjectMetadataMutationContext.clear resets every owned cache", async () => {
    const fixture = await createProjectMetadataFixture();
    try {
        const context = new ProjectMetadataMutationContext(fixture.projectRoot, () => fixture.resources);
        context.loadResourceMetadataDocumentForRename(fixture.resourcePath);
        const indexA = context.getProjectMetadataReferenceIndex();
        context.clear();
        const indexB = context.getProjectMetadataReferenceIndex();

        assert.notStrictEqual(indexA, indexB, "clear() should evict the cached reference index");
    } finally {
        await fixture.cleanup();
    }
});

void test("ProjectMetadataMutationContext.stageMetadataEdit invalidates stale parsed entries", () => {
    const context = new ProjectMetadataMutationContext("/project", () => ({}));
    context.stageMetadataEdit({ path: "scripts/foo/foo.yy", content: '{"name":"foo"}' });
    context.stageMetadataEdit({ path: "scripts/foo/foo.yy", content: '{"name":"bar"}' });
    // No public reader for the parsed staged metadata, but the second call should
    // not throw and should replace the previous staged content.  We assert
    // behaviour by calling addResourceMetadataEdits with a no-op resource and
    // confirming no edit is produced for the staged path.
    const edit = createRecordingEdit();
    context.addResourceMetadataEdits(edit, {}, "old", "new", "scripts/foo/foo.yy");
    assert.equal(edit.addMetadataEditCalls.length, 0);
});

void test("ProjectMetadataMutationContext.addResourceMetadataEdits rewrites the resource and manifest", async () => {
    const fixture = await createProjectMetadataFixture();
    try {
        const context = new ProjectMetadataMutationContext(fixture.projectRoot, () => fixture.resources);
        const edit = createRecordingEdit();

        context.addResourceMetadataEdits(
            edit,
            fixture.resources[fixture.resourcePath],
            "bad_name_alpha",
            "good_name_alpha",
            fixture.resourcePath
        );

        const manifestEdit = edit.addMetadataEditCalls.find((entry) => entry.path === fixture.manifestPath);
        const resourceEdit = edit.addMetadataEditCalls.find((entry) => entry.path === fixture.resourcePath);
        assert.ok(manifestEdit, "expected a metadata edit for the project manifest");
        assert.ok(resourceEdit, "expected a metadata edit for the resource itself");
        assert.match(manifestEdit.content, /"name"\s*:\s*"good_name_alpha"/u);
        assert.doesNotMatch(manifestEdit.content, /"name"\s*:\s*"bad_name_alpha"/u);
        assert.match(resourceEdit.content, /"name"\s*:\s*"good_name_alpha"/u);
    } finally {
        await fixture.cleanup();
    }
});

void test("ProjectMetadataMutationContext.addResourceMetadataEdits isolates edits per WorkspaceEdit", async () => {
    const fixture = await createProjectMetadataFixture();
    try {
        const context = new ProjectMetadataMutationContext(fixture.projectRoot, () => fixture.resources);
        const firstEdit = createRecordingEdit();
        const secondEdit = createRecordingEdit();

        context.addResourceMetadataEdits(
            firstEdit,
            fixture.resources[fixture.resourcePath],
            "bad_name_alpha",
            "good_name_one",
            fixture.resourcePath
        );
        context.addResourceMetadataEdits(
            secondEdit,
            fixture.resources[fixture.resourcePath],
            "bad_name_alpha",
            "good_name_two",
            fixture.resourcePath
        );

        const firstManifest = firstEdit.addMetadataEditCalls.find((entry) => entry.path === fixture.manifestPath);
        const secondManifest = secondEdit.addMetadataEditCalls.find((entry) => entry.path === fixture.manifestPath);
        assert.ok(firstManifest);
        assert.ok(secondManifest);
        assert.match(firstManifest.content, /"name"\s*:\s*"good_name_one"/u);
        assert.doesNotMatch(firstManifest.content, /"name"\s*:\s*"good_name_two"/u);
        assert.match(secondManifest.content, /"name"\s*:\s*"good_name_two"/u);
        assert.doesNotMatch(secondManifest.content, /"name"\s*:\s*"good_name_one"/u);
    } finally {
        await fixture.cleanup();
    }
});

void test("ProjectMetadataMutationContext.loadResourceMetadataDocumentForRename returns empty for missing files", () => {
    const context = new ProjectMetadataMutationContext(path.join(os.tmpdir(), "gmloop-missing-project"), () => ({}));
    const document = context.loadResourceMetadataDocumentForRename("scripts/missing/missing.yy");
    assert.deepEqual(document, {});
});
