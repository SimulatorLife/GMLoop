import path from "node:path";

import { Core } from "@gmloop/core";

/**
 * Planned rename for a non-primary resource artifact that must move together
 * with a renamed GameMaker resource.
 */
export type ResourceSidecarRename = {
    oldPath: string;
    newPath: string;
};

type SidecarRenamePlanningParameters = {
    resourceType: string | null | undefined;
    metadataDocument: Record<string, unknown>;
    currentResourcePath: string;
    oldName: string;
    newName: string;
    fileRenameDestinationDir: string;
    doesWorkspaceFilePathExist: (candidatePath: string) => boolean;
    doesWorkspaceDirectoryPathExist: (candidatePath: string) => boolean;
};

function collectNamedChildIds(entries: unknown): Array<string> {
    const identifiers: Array<string> = [];

    for (const entry of Core.asArray(entries)) {
        if (!Core.isObjectLike(entry)) {
            continue;
        }

        const typedEntry = entry as Record<string, unknown>;
        const identifier = Core.getNonEmptyString(typedEntry.name) ?? Core.getNonEmptyString(typedEntry["%Name"]);
        if (!identifier) {
            continue;
        }

        identifiers.push(identifier);
    }

    return identifiers;
}

function appendRenameIfNeeded(
    renames: Array<ResourceSidecarRename>,
    oldPath: string,
    newPath: string,
    doesWorkspaceFilePathExist: (candidatePath: string) => boolean
): void {
    if (oldPath === newPath || !doesWorkspaceFilePathExist(oldPath)) {
        return;
    }

    renames.push({ oldPath, newPath });
}

/**
 * Compute the renamed `soundFile` basename for a sound resource when the
 * payload file should follow the renamed resource name.
 *
 * @param soundFile - Current metadata `soundFile` value.
 * @param newName - Planned resource name.
 * @returns Renamed payload filename or `null` when no rename is needed.
 */
export function resolveRenamedSoundFileName(soundFile: string | null | undefined, newName: string): string | null {
    if (!Core.isNonEmptyString(soundFile)) {
        return null;
    }

    const extension = path.posix.extname(soundFile);
    if (!extension) {
        return null;
    }

    // Keep the payload extension, but always normalize the basename to the
    // renamed sound resource. GameMaker projects conventionally keep
    // `soundFile` aligned with the resource name, and leaving the old basename
    // behind causes IDE conversion failures once metadata points at the renamed
    // resource directory.
    return `${newName}${extension}`;
}

function collectSoundSidecarRenames({
    metadataDocument,
    currentResourcePath,
    newName,
    fileRenameDestinationDir,
    doesWorkspaceFilePathExist
}: Omit<
    SidecarRenamePlanningParameters,
    "resourceType" | "doesWorkspaceDirectoryPathExist"
>): Array<ResourceSidecarRename> {
    const soundFile = Core.getNonEmptyString(metadataDocument.soundFile);
    const renamedSoundFile = resolveRenamedSoundFileName(soundFile, newName);
    if (!renamedSoundFile || !soundFile) {
        return [];
    }

    const resourceDir = path.posix.dirname(currentResourcePath);
    const oldSoundPath = path.posix.join(resourceDir, soundFile);
    const newSoundPath = path.posix.join(fileRenameDestinationDir, renamedSoundFile);
    const renames: Array<ResourceSidecarRename> = [];
    appendRenameIfNeeded(renames, oldSoundPath, newSoundPath, doesWorkspaceFilePathExist);
    return renames;
}

function collectSpriteSidecarRenames({
    metadataDocument,
    currentResourcePath,
    fileRenameDestinationDir,
    doesWorkspaceFilePathExist,
    doesWorkspaceDirectoryPathExist
}: Omit<SidecarRenamePlanningParameters, "resourceType" | "oldName" | "newName">): Array<ResourceSidecarRename> {
    const resourceDir = path.posix.dirname(currentResourcePath);
    if (fileRenameDestinationDir === resourceDir) {
        return [];
    }

    const renames: Array<ResourceSidecarRename> = [];
    const frameIds = collectNamedChildIds(metadataDocument.frames);
    const layerIds = collectNamedChildIds(metadataDocument.layers);

    for (const frameId of frameIds) {
        appendRenameIfNeeded(
            renames,
            path.posix.join(resourceDir, `${frameId}.png`),
            path.posix.join(fileRenameDestinationDir, `${frameId}.png`),
            doesWorkspaceFilePathExist
        );
    }

    const oldLayersDir = path.posix.join(resourceDir, "layers");
    const newLayersDir = path.posix.join(fileRenameDestinationDir, "layers");
    if (!doesWorkspaceDirectoryPathExist(oldLayersDir)) {
        return renames;
    }

    if (!doesWorkspaceDirectoryPathExist(newLayersDir)) {
        renames.push({
            oldPath: oldLayersDir,
            newPath: newLayersDir
        });
        return renames;
    }

    for (const frameId of frameIds) {
        const oldFrameLayersDir = path.posix.join(oldLayersDir, frameId);
        const newFrameLayersDir = path.posix.join(newLayersDir, frameId);
        if (!doesWorkspaceDirectoryPathExist(oldFrameLayersDir)) {
            continue;
        }

        if (!doesWorkspaceDirectoryPathExist(newFrameLayersDir)) {
            renames.push({
                oldPath: oldFrameLayersDir,
                newPath: newFrameLayersDir
            });
            continue;
        }

        for (const layerId of layerIds) {
            appendRenameIfNeeded(
                renames,
                path.posix.join(oldFrameLayersDir, `${layerId}.png`),
                path.posix.join(newFrameLayersDir, `${layerId}.png`),
                doesWorkspaceFilePathExist
            );
        }
    }

    return renames;
}

function collectFontSidecarRenames({
    currentResourcePath,
    oldName,
    newName,
    fileRenameDestinationDir,
    doesWorkspaceFilePathExist
}: Omit<
    SidecarRenamePlanningParameters,
    "resourceType" | "metadataDocument" | "doesWorkspaceDirectoryPathExist"
>): Array<ResourceSidecarRename> {
    const resourceDir = path.posix.dirname(currentResourcePath);
    const renames: Array<ResourceSidecarRename> = [];

    // GameMaker bitmap fonts keep a generated texture page beside the `.yy`
    // using the resource basename. Renaming only the metadata/folder leaves the
    // font pointing at a missing `<newName>.png`, which causes runtime load
    // failures in real projects such as Scribble fallback fonts.
    appendRenameIfNeeded(
        renames,
        path.posix.join(resourceDir, `${oldName}.png`),
        path.posix.join(fileRenameDestinationDir, `${newName}.png`),
        doesWorkspaceFilePathExist
    );

    return renames;
}

/**
 * Collect sprite/sound/font payload renames that must accompany a resource metadata
 * rename when the refactor engine cannot rely on a single enclosing directory
 * rename to move every artifact.
 *
 * @param parameters - Resource rename planning inputs.
 * @returns Additional file and directory renames for resource sidecars.
 */
export function collectResourceSidecarRenames(
    parameters: SidecarRenamePlanningParameters
): Array<ResourceSidecarRename> {
    const { resourceType, metadataDocument } = parameters;
    if (!Core.isObjectLike(metadataDocument)) {
        return [];
    }

    switch (resourceType) {
        case "GMSound": {
            return collectSoundSidecarRenames(parameters);
        }
        case "GMSprite": {
            return collectSpriteSidecarRenames(parameters);
        }
        case "GMFont": {
            return collectFontSidecarRenames(parameters);
        }
        default: {
            return [];
        }
    }
}
