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
    primaryRenamedPaths: ReadonlyArray<string>;
    doesWorkspaceFilePathExist: (candidatePath: string) => boolean;
    doesWorkspaceDirectoryPathExist: (candidatePath: string) => boolean;
    listWorkspaceDirectoryEntries: (candidatePath: string) => Array<string>;
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

function pathIsInsideAnyDirectory(candidatePath: string, directoryPaths: ReadonlySet<string>): boolean {
    for (const directoryPath of directoryPaths) {
        if (candidatePath === directoryPath || candidatePath.startsWith(`${directoryPath}/`)) {
            return true;
        }
    }

    return false;
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
    "resourceType" | "doesWorkspaceDirectoryPathExist" | "listWorkspaceDirectoryEntries"
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
}: Omit<
    SidecarRenamePlanningParameters,
    "resourceType" | "oldName" | "newName" | "listWorkspaceDirectoryEntries"
>): Array<ResourceSidecarRename> {
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
    "resourceType" | "metadataDocument" | "doesWorkspaceDirectoryPathExist" | "listWorkspaceDirectoryEntries"
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

function collectNoteSidecarRenames({
    currentResourcePath,
    oldName,
    newName,
    fileRenameDestinationDir,
    doesWorkspaceFilePathExist
}: Omit<
    SidecarRenamePlanningParameters,
    "resourceType" | "metadataDocument" | "doesWorkspaceDirectoryPathExist" | "listWorkspaceDirectoryEntries"
>): Array<ResourceSidecarRename> {
    const resourceDir = path.posix.dirname(currentResourcePath);
    const renames: Array<ResourceSidecarRename> = [];

    appendRenameIfNeeded(
        renames,
        path.posix.join(resourceDir, `${oldName}.txt`),
        path.posix.join(fileRenameDestinationDir, `${newName}.txt`),
        doesWorkspaceFilePathExist
    );

    return renames;
}

function collectDirectoryCarryoverRenames(parameters: {
    sourceDirectoryPath: string;
    destinationDirectoryPath: string;
    doesWorkspaceFilePathExist: (candidatePath: string) => boolean;
    doesWorkspaceDirectoryPathExist: (candidatePath: string) => boolean;
    listWorkspaceDirectoryEntries: (candidatePath: string) => Array<string>;
    excludedPaths: ReadonlySet<string>;
    excludedDirectoryPaths: ReadonlySet<string>;
}): Array<ResourceSidecarRename> {
    const renames: Array<ResourceSidecarRename> = [];

    const visitDirectory = (sourceDirectoryPath: string, destinationDirectoryPath: string): void => {
        for (const entryName of parameters.listWorkspaceDirectoryEntries(sourceDirectoryPath)) {
            const oldEntryPath = path.posix.join(sourceDirectoryPath, entryName);
            if (
                parameters.excludedPaths.has(oldEntryPath) ||
                pathIsInsideAnyDirectory(oldEntryPath, parameters.excludedDirectoryPaths)
            ) {
                continue;
            }

            const newEntryPath = path.posix.join(destinationDirectoryPath, entryName);
            if (parameters.doesWorkspaceDirectoryPathExist(oldEntryPath)) {
                if (!parameters.doesWorkspaceDirectoryPathExist(newEntryPath)) {
                    renames.push({
                        oldPath: oldEntryPath,
                        newPath: newEntryPath
                    });
                    continue;
                }

                visitDirectory(oldEntryPath, newEntryPath);
                continue;
            }

            appendRenameIfNeeded(renames, oldEntryPath, newEntryPath, parameters.doesWorkspaceFilePathExist);
        }
    };

    visitDirectory(parameters.sourceDirectoryPath, parameters.destinationDirectoryPath);
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

    const renames =
        (() => {
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
                case "GMNote":
                case "GMNotes": {
                    return collectNoteSidecarRenames(parameters);
                }
                default: {
                    return [];
                }
            }
        })() ?? [];

    const resourceDir = path.posix.dirname(parameters.currentResourcePath);
    if (parameters.fileRenameDestinationDir === resourceDir) {
        return renames;
    }

    const excludedPaths = new Set<string>([
        ...parameters.primaryRenamedPaths,
        ...renames.map((rename) => rename.oldPath)
    ]);
    const excludedDirectoryPaths = new Set<string>();
    for (const rename of renames) {
        if (parameters.doesWorkspaceDirectoryPathExist(rename.oldPath)) {
            excludedDirectoryPaths.add(rename.oldPath);
        }
    }

    renames.push(
        ...collectDirectoryCarryoverRenames({
            sourceDirectoryPath: resourceDir,
            destinationDirectoryPath: parameters.fileRenameDestinationDir,
            doesWorkspaceFilePathExist: parameters.doesWorkspaceFilePathExist,
            doesWorkspaceDirectoryPathExist: parameters.doesWorkspaceDirectoryPathExist,
            listWorkspaceDirectoryEntries: parameters.listWorkspaceDirectoryEntries,
            excludedPaths,
            excludedDirectoryPaths
        })
    );

    return renames;
}
