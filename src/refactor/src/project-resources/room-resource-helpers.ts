import { writeFile } from "node:fs/promises";

import { Core } from "@gmloop/core";

import type { ProjectManifestEntry } from "./project-resource-operations.js";

export const OBJECT_RESOURCE_DIRECTORY = "objects";
export const ROOM_RESOURCE_DIRECTORY = "rooms";

export type ResourceReference = Readonly<{
    name: string;
    path: string;
}>;

function locateManifestEntry(
    manifestResources: ReadonlyArray<ProjectManifestEntry>,
    resourceDirectory: string,
    resourceName: string,
    duplicateLabel: string,
    missingLabel: string
): ResourceReference {
    const expectedPrefix = `${resourceDirectory}/`;
    let located: ResourceReference | null = null;

    for (const manifestResource of manifestResources) {
        if (manifestResource.id.name !== resourceName || !manifestResource.id.path.startsWith(expectedPrefix)) {
            continue;
        }
        if (located !== null) {
            throw new Error(`Found multiple ${duplicateLabel} named '${resourceName}' in the project manifest.`);
        }
        located = Object.freeze({
            name: manifestResource.id.name,
            path: manifestResource.id.path
        });
    }

    if (located === null) {
        throw new Error(`Could not find ${missingLabel} '${resourceName}' in the project manifest.`);
    }

    return located;
}

export function locateObjectReference(
    manifestResources: ReadonlyArray<ProjectManifestEntry>,
    objectName: string
): ResourceReference {
    return locateManifestEntry(
        manifestResources,
        OBJECT_RESOURCE_DIRECTORY,
        objectName,
        "object resources",
        "object resource"
    );
}

export function locateRoomReference(
    manifestResources: ReadonlyArray<ProjectManifestEntry>,
    roomName: string
): ResourceReference {
    return locateManifestEntry(manifestResources, ROOM_RESOURCE_DIRECTORY, roomName, "room resources", "room resource");
}

export async function writeRoomDocumentIfApplying(
    dryRun: boolean,
    roomAbsolutePath: string,
    roomDocument: Record<string, unknown>
): Promise<void> {
    if (dryRun) {
        return;
    }

    await writeFile(
        roomAbsolutePath,
        `${Core.stringifyProjectMetadataDocument(roomDocument, roomAbsolutePath)}\n`,
        "utf8"
    );
}

export function assertFiniteCoordinate(value: number, coordinateName: "x" | "y"): void {
    if (!Number.isFinite(value)) {
        throw new TypeError(`Invalid ${coordinateName} coordinate ${String(value)}. Expected a finite numeric value.`);
    }
}
