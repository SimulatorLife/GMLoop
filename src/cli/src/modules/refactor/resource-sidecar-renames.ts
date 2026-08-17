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

function collectSingleFileSidecarRenames(parameters: {
    currentResourcePath: string;
    fileRenameDestinationDir: string;
    oldFileName: string;
    newFileName: string;
    doesWorkspaceFilePathExist: (candidatePath: string) => boolean;
}): Array<ResourceSidecarRename> {
    const resourceDir = path.posix.dirname(parameters.currentResourcePath);
    const renames: Array<ResourceSidecarRename> = [];
    appendRenameIfNeeded(
        renames,
        path.posix.join(resourceDir, parameters.oldFileName),
        path.posix.join(parameters.fileRenameDestinationDir, parameters.newFileName),
        parameters.doesWorkspaceFilePathExist
    );
    return renames;
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

    return collectSingleFileSidecarRenames({
        currentResourcePath,
        fileRenameDestinationDir,
        oldFileName: soundFile,
        newFileName: renamedSoundFile,
        doesWorkspaceFilePathExist
    });
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

/**
 * Plans sidecar renames for resources whose payload file sits beside the
 * `.yy` metadata and uses the resource basename plus a fixed extension.
 *
 * GameMaker bitmap fonts keep a generated texture page (`<name>.png`) beside
 * the `.yy`, and notes keep a sibling `<name>.txt`.  Both rely on the
 * resource basename, so they share the exact same rename flow and only
 * differ in the file extension.  Routing both through this helper keeps the
 * file-naming logic in one place.
 *
 * @param parameters - Resource rename planning inputs.
 * @param fileExtension - Payload file extension, including the leading `.`.
 * @returns Single-file sidecar rename when the payload exists, otherwise `[]`.
 */
function collectNamedExtensionSidecarRenames(
    parameters: Pick<
        SidecarRenamePlanningParameters,
        "currentResourcePath" | "fileRenameDestinationDir" | "oldName" | "newName" | "doesWorkspaceFilePathExist"
    >,
    fileExtension: string
): Array<ResourceSidecarRename> {
    return collectSingleFileSidecarRenames({
        currentResourcePath: parameters.currentResourcePath,
        fileRenameDestinationDir: parameters.fileRenameDestinationDir,
        oldFileName: `${parameters.oldName}${fileExtension}`,
        newFileName: `${parameters.newName}${fileExtension}`,
        doesWorkspaceFilePathExist: parameters.doesWorkspaceFilePathExist
    });
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

    const lowercasedExcludedPaths = new Set(Array.from(parameters.excludedPaths).map((p) => p.toLowerCase()));
    const lowercasedExcludedDirectoryPaths = new Set(
        Array.from(parameters.excludedDirectoryPaths).map((p) => p.toLowerCase())
    );

    const visitDirectory = (sourceDirectoryPath: string, destinationDirectoryPath: string): void => {
        for (const entryName of parameters.listWorkspaceDirectoryEntries(sourceDirectoryPath)) {
            const oldEntryPath = path.posix.join(sourceDirectoryPath, entryName);
            const oldEntryPathLower = oldEntryPath.toLowerCase();
            if (
                lowercasedExcludedPaths.has(oldEntryPathLower) ||
                pathIsInsideAnyDirectory(oldEntryPathLower, lowercasedExcludedDirectoryPaths)
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

function dispatchResourceSidecarRenamesByType(
    resourceType: string | null | undefined,
    parameters: SidecarRenamePlanningParameters
): Array<ResourceSidecarRename> {
    switch (resourceType) {
        case "GMSound": {
            return collectSoundSidecarRenames(parameters);
        }
        case "GMSprite": {
            return collectSpriteSidecarRenames(parameters);
        }
        case "GMFont": {
            return collectNamedExtensionSidecarRenames(parameters, ".png");
        }
        case "GMNote":
        case "GMNotes": {
            return collectNamedExtensionSidecarRenames(parameters, ".txt");
        }
        default: {
            return [];
        }
    }
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

    const renames = dispatchResourceSidecarRenamesByType(resourceType, parameters);

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
