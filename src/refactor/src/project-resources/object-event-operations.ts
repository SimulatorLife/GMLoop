import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { Core } from "@gmloop/core";
import { Parser } from "@gmloop/parser";

const OBJECT_RESOURCE_DIRECTORY = "objects";

const OBJECT_EVENT_TYPES = Object.freeze({
    cleanup: 2,
    collision: 4,
    create: 0,
    destroy: 1,
    draw: 8,
    gesture: 12,
    keyboard: 5,
    keypress: 9,
    keyrelease: 10,
    mouse: 6,
    other: 7,
    step: 3
});

const OBJECT_EVENT_NUMBERS = Object.freeze({
    cleanup: Object.freeze({ cleanup: 0 }),
    create: Object.freeze({ create: 0 }),
    destroy: Object.freeze({ destroy: 0 }),
    draw: Object.freeze({ begin: 72, draw: 0, end: 73, gui: 64, guibegin: 65, guiend: 66, pre: 76, post: 77 }),
    step: Object.freeze({ begin: 1, end: 2, normal: 0, step: 0 })
});

type ProjectManifestEntry = Readonly<{
    id: Readonly<{
        name: string;
        path: string;
    }>;
}>;

type ResourceReference = Readonly<{
    name: string;
    path: string;
}>;

type ObjectEventMutationContext = Readonly<{
    event: Record<string, unknown>;
    eventFilePath: string;
    eventType: number;
    eventNumber: number;
    objectAbsolutePath: string;
    objectDocument: Record<string, unknown>;
    objectReference: ResourceReference;
    projectRoot: string;
}>;

/**
 * Stable descriptor for a GameMaker object event such as `Step:Begin` or `Create:0`.
 */
export interface ObjectEventDescriptor {
    category: string;
    descriptor: string;
}

/**
 * Parameters for replacing the GML source for an existing GameMaker object event.
 */
export interface UpdateObjectEventRequest {
    descriptor: ObjectEventDescriptor;
    dryRun?: boolean;
    handlerSource: string;
    objectName: string;
    projectRoot: string;
}

/**
 * Summary returned after an object event source mutation.
 */
export interface ObjectEventMutationResult {
    action: "update";
    dryRun: boolean;
    eventFilePath: string;
    eventNumber: number;
    eventType: number;
    objectName: string;
    objectPath: string;
    warnings: Array<string>;
    writtenPaths: Array<string>;
}

async function readProjectMetadataDocument(absolutePath: string): Promise<Record<string, unknown>> {
    const rawContent = await readFile(absolutePath, "utf8");
    return Core.parseProjectMetadataDocumentForMutation(rawContent, absolutePath).document;
}

async function resolveProjectManifestPath(projectRoot: string): Promise<string> {
    const directoryEntries = await readdir(projectRoot, { withFileTypes: true });
    const manifestFileNames = directoryEntries
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".yyp"))
        .map((entry) => entry.name)
        .toSorted((left, right) => left.localeCompare(right));

    if (manifestFileNames.length === 0) {
        throw new Error(`Could not locate a .yyp manifest inside '${projectRoot}'.`);
    }
    if (manifestFileNames.length > 1) {
        throw new Error(
            `Found multiple .yyp manifests in '${projectRoot}'. Object event operations require exactly one project manifest.`
        );
    }

    return path.join(projectRoot, manifestFileNames[0]);
}

function getManifestResources(document: Record<string, unknown>): Array<ProjectManifestEntry> {
    const resources: Array<ProjectManifestEntry> = [];
    for (const resourceEntry of Core.asArray(document.resources)) {
        if (!Core.isObjectLike(resourceEntry)) {
            continue;
        }

        const identifier = (resourceEntry as { id?: unknown }).id;
        if (!Core.isObjectLike(identifier)) {
            continue;
        }

        const name = Core.getNonEmptyString((identifier as { name?: unknown }).name);
        const resourcePath = Core.getNonEmptyString((identifier as { path?: unknown }).path);
        if (!name || !resourcePath) {
            continue;
        }

        resources.push(
            Object.freeze({
                id: Object.freeze({
                    name,
                    path: resourcePath
                })
            })
        );
    }
    return resources;
}

function locateObjectReference(
    manifestResources: ReadonlyArray<ProjectManifestEntry>,
    objectName: string
): ResourceReference {
    const expectedPrefix = `${OBJECT_RESOURCE_DIRECTORY}/`;
    let located: ResourceReference | null = null;

    for (const manifestResource of manifestResources) {
        if (manifestResource.id.name !== objectName || !manifestResource.id.path.startsWith(expectedPrefix)) {
            continue;
        }
        if (located !== null) {
            throw new Error(`Found multiple object resources named '${objectName}' in the project manifest.`);
        }
        located = Object.freeze({
            name: manifestResource.id.name,
            path: manifestResource.id.path
        });
    }

    if (located === null) {
        throw new Error(`Could not find object resource '${objectName}' in the project manifest.`);
    }

    return located;
}

function normalizeDescriptorKey(value: string): string {
    return value.replaceAll(/[^A-Za-z0-9]/gu, "").toLowerCase();
}

function resolveObjectEventType(category: string): number {
    const key = normalizeDescriptorKey(category);
    const eventType = OBJECT_EVENT_TYPES[key as keyof typeof OBJECT_EVENT_TYPES];
    if (typeof eventType === "number") {
        return eventType;
    }

    const numericCategory = Number(category);
    if (Number.isInteger(numericCategory) && numericCategory >= 0) {
        return numericCategory;
    }

    throw new Error(
        `Unsupported object event category '${category}'. Use a GameMaker event name or numeric event type.`
    );
}

function resolveObjectEventNumber(category: string, descriptor: string): number {
    const numericDescriptor = Number(descriptor);
    if (Number.isInteger(numericDescriptor) && numericDescriptor >= 0) {
        return numericDescriptor;
    }

    const categoryKey = normalizeDescriptorKey(category);
    const descriptorKey = normalizeDescriptorKey(descriptor);
    const descriptorNumbers = OBJECT_EVENT_NUMBERS[categoryKey as keyof typeof OBJECT_EVENT_NUMBERS];
    const eventNumber = descriptorNumbers?.[descriptorKey as keyof typeof descriptorNumbers];
    if (typeof eventNumber === "number") {
        return eventNumber;
    }

    throw new Error(
        `Unsupported object event descriptor '${category}:${descriptor}'. Use a numeric event number for this category.`
    );
}

function readNumericEventField(event: Record<string, unknown>, fieldNames: ReadonlyArray<string>): number | null {
    for (const fieldName of fieldNames) {
        const fieldValue = event[fieldName];
        if (typeof fieldValue === "number") {
            return fieldValue;
        }
    }
    return null;
}

function locateObjectEvent(
    objectDocument: Record<string, unknown>,
    objectName: string,
    eventType: number,
    eventNumber: number
): Record<string, unknown> {
    for (const eventEntry of Core.asArray(objectDocument.eventList)) {
        if (!Core.isObjectLike(eventEntry)) {
            continue;
        }

        const event = eventEntry as Record<string, unknown>;
        const candidateEventType = readNumericEventField(event, ["eventType", "eventtype"]);
        const candidateEventNumber = readNumericEventField(event, ["eventNum", "enumb"]);
        if (candidateEventType === eventType && candidateEventNumber === eventNumber) {
            return event;
        }
    }

    throw new Error(`Could not find object event ${eventType}:${eventNumber} on object '${objectName}'.`);
}

function resolveEventFilePath(
    event: Record<string, unknown>,
    objectReference: ResourceReference,
    eventType: number,
    eventNumber: number
): string {
    for (const candidate of [event.eventContents, event.event, event.code]) {
        if (typeof candidate === "string" && candidate.trim().length > 0) {
            return Core.toPosixPath(candidate);
        }
        if (Core.isObjectLike(candidate)) {
            const nestedPath = Core.getNonEmptyString((candidate as { path?: unknown }).path);
            if (nestedPath) {
                return Core.toPosixPath(nestedPath);
            }
        }
    }

    return path.posix.join(path.posix.dirname(objectReference.path), `${eventType}_${eventNumber}.gml`);
}

function normalizeHandlerSource(handlerSource: string): string {
    return handlerSource.endsWith("\n") ? handlerSource : `${handlerSource}\n`;
}

async function resolveObjectEventMutationContext(
    projectRoot: string,
    objectName: string,
    descriptor: ObjectEventDescriptor
): Promise<ObjectEventMutationContext> {
    const manifestPath = await resolveProjectManifestPath(projectRoot);
    const manifestDocument = await readProjectMetadataDocument(manifestPath);
    const objectReference = locateObjectReference(getManifestResources(manifestDocument), objectName);
    const objectAbsolutePath = path.join(projectRoot, Core.fromPosixPath(objectReference.path));
    const objectDocument = await readProjectMetadataDocument(objectAbsolutePath);
    const eventType = resolveObjectEventType(descriptor.category);
    const eventNumber = resolveObjectEventNumber(descriptor.category, descriptor.descriptor);
    const event = locateObjectEvent(objectDocument, objectReference.name, eventType, eventNumber);
    const eventFilePath = resolveEventFilePath(event, objectReference, eventType, eventNumber);

    return Object.freeze({
        event,
        eventFilePath,
        eventNumber,
        eventType,
        objectAbsolutePath,
        objectDocument,
        objectReference,
        projectRoot
    });
}

async function writeObjectEventSourceIfApplying(
    dryRun: boolean,
    projectRoot: string,
    eventFilePath: string,
    handlerSource: string
): Promise<void> {
    if (dryRun) {
        return;
    }

    await writeFile(path.join(projectRoot, Core.fromPosixPath(eventFilePath)), handlerSource, "utf8");
}

/**
 * Replace the GML source for an existing GameMaker object event.
 *
 * @param request - Object event update request.
 * @returns Summary of the planned or applied object event source mutation.
 */
export async function updateObjectEvent(request: UpdateObjectEventRequest): Promise<ObjectEventMutationResult> {
    const normalizedHandlerSource = normalizeHandlerSource(request.handlerSource);
    Parser.GMLParser.parse(normalizedHandlerSource);

    const context = await resolveObjectEventMutationContext(
        request.projectRoot,
        request.objectName,
        request.descriptor
    );
    const dryRun = request.dryRun !== false;
    await writeObjectEventSourceIfApplying(dryRun, context.projectRoot, context.eventFilePath, normalizedHandlerSource);

    return {
        action: "update",
        dryRun,
        eventFilePath: context.eventFilePath,
        eventNumber: context.eventNumber,
        eventType: context.eventType,
        objectName: context.objectReference.name,
        objectPath: context.objectReference.path,
        warnings: [],
        writtenPaths: [context.eventFilePath]
    };
}
