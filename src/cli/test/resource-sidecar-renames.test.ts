import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { collectResourceSidecarRenames } from "../src/modules/refactor/resource-sidecar-renames.js";

type SidecarRenameTestCase = {
    resourceType: string;
    metadataDocument: Record<string, unknown>;
    oldName: string;
    newName: string;
    currentResourcePath: string;
    expectedOldPath: string;
    expectedNewPath: string;
};

const SINGLE_FILE_SIDE_CAR_CASES: ReadonlyArray<SidecarRenameTestCase> = [
    {
        resourceType: "GMSound",
        metadataDocument: { soundFile: "snd_laser.ogg" },
        oldName: "snd_laser",
        newName: "snd_pew",
        currentResourcePath: "sounds/snd_laser/snd_laser.yy",
        expectedOldPath: "sounds/snd_laser/snd_laser.ogg",
        expectedNewPath: "sounds/snd_pew/snd_pew.ogg"
    },
    {
        resourceType: "GMFont",
        metadataDocument: {},
        oldName: "fnt_menu",
        newName: "fnt_hud",
        currentResourcePath: "fonts/fnt_menu/fnt_menu.yy",
        expectedOldPath: "fonts/fnt_menu/fnt_menu.png",
        expectedNewPath: "fonts/fnt_hud/fnt_hud.png"
    },
    {
        resourceType: "GMNote",
        metadataDocument: {},
        oldName: "note_old",
        newName: "note_new",
        currentResourcePath: "notes/note_old/note_old.yy",
        expectedOldPath: "notes/note_old/note_old.txt",
        expectedNewPath: "notes/note_new/note_new.txt"
    }
];

void describe("collectResourceSidecarRenames single-file resources", () => {
    for (const testCase of SINGLE_FILE_SIDE_CAR_CASES) {
        void it(`plans ${testCase.resourceType} sidecar rename using one shared file-path flow`, () => {
            const existingFilePaths = new Set<string>([testCase.expectedOldPath]);

            const renames = collectResourceSidecarRenames({
                resourceType: testCase.resourceType,
                metadataDocument: testCase.metadataDocument,
                currentResourcePath: testCase.currentResourcePath,
                oldName: testCase.oldName,
                newName: testCase.newName,
                fileRenameDestinationDir: testCase.expectedNewPath.split("/").slice(0, -1).join("/"),
                primaryRenamedPaths: [],
                doesWorkspaceFilePathExist: (candidatePath) => existingFilePaths.has(candidatePath),
                doesWorkspaceDirectoryPathExist: () => false,
                listWorkspaceDirectoryEntries: () => []
            });

            assert.deepEqual(renames, [{ oldPath: testCase.expectedOldPath, newPath: testCase.expectedNewPath }]);
        });
    }
});
