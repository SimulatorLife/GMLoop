import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { Core } from "@gmloop/core";

import { defaultGmlProgramParser } from "../parser-adapter.js";
import {
    getManifestResources,
    readProjectMetadataDocument,
    resolveProjectManifestFile
} from "./project-resource-operations.js";
import { locateObjectReference, type ResourceReference } from "./room-resource-helpers.js";

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

type ObjectEventMutationContext = Readonly<{
    event: Record<string, unknown>;
    eventIndex: number;
    eventFilePath: string;
    eventType: number;
    eventNumber: number;
    objectAbsolutePath: string;
    objectDocument: Record<string, unknown>;
    objectReference: ResourceReference;
    projectRoot: string;
}>;

type ObjectEventInspectionContext = Readonly<{
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
 * Parameters for adding a new GameMaker object event and GML source file.
 */
export interface AddObjectEventRequest {
    descriptor: ObjectEventDescriptor;
    dryRun?: boolean;
    handlerSource: string;
    objectName: string;
    projectRoot: string;
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
 * Parameters for deleting an existing GameMaker object event and its GML source file.
 */
export interface DeleteObjectEventRequest {
    descriptor: ObjectEventDescriptor;
    dryRun?: boolean;
    objectName: string;
    projectRoot: string;
}

/**
 * Summary returned after an object event source mutation.
 */
export interface ObjectEventMutationResult {
    action: "add" | "update" | "delete";
    deletedPaths: Array<string>;
    dryRun: boolean;
    eventFilePath: string;
    eventNumber: number;
    eventType: number;
    objectName: string;
    objectPath: string;
    warnings: Array<string>;
    writtenPaths: Array<string>;
}

/**
 * Read-only parse status for an object event handler source file.
 */
export interface ObjectEventParseSummary {
    diagnostic: string | null;
    ok: boolean;
}

/**
 * Summary of a GameMaker object event handler for graph-aware inspection.
 */
export interface ObjectEventInspectionResult {
    descriptor: string;
    eventFilePath: string;
    eventNumber: number;
    eventType: number;
    objectName: string;
    objectPath: string;
    parse: ObjectEventParseSummary;
    source: Readonly<{
        byteLength: number;
        lineCount: number;
        present: boolean;
        summary: string;
    }>;
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

function findObjectEventIndex(objectDocument: Record<string, unknown>, eventType: number, eventNumber: number): number {
    const eventList = Core.asArray(objectDocument.eventList);
    for (const [eventIndex, eventEntry] of eventList.entries()) {
        if (!Core.isObjectLike(eventEntry)) {
            continue;
        }

        const event = eventEntry as Record<string, unknown>;
        const candidateEventType = readNumericEventField(event, ["eventType", "eventtype"]);
        const candidateEventNumber = readNumericEventField(event, ["eventNum", "enumb"]);
        if (candidateEventType === eventType && candidateEventNumber === eventNumber) {
            return eventIndex;
        }
    }

    return -1;
}

function findObjectEvent(
    objectDocument: Record<string, unknown>,
    eventType: number,
    eventNumber: number
): Record<string, unknown> | null {
    const eventIndex = findObjectEventIndex(objectDocument, eventType, eventNumber);
    if (eventIndex < 0) {
        return null;
    }

    const event = Core.asArray(objectDocument.eventList)[eventIndex];
    return Core.isObjectLike(event) ? (event as Record<string, unknown>) : null;
}

function locateObjectEvent(
    objectDocument: Record<string, unknown>,
    objectName: string,
    eventType: number,
    eventNumber: number
): Record<string, unknown> {
    const event = findObjectEvent(objectDocument, eventType, eventNumber);
    if (event === null) {
        throw new Error(`Could not find object event ${eventType}:${eventNumber} on object '${objectName}'.`);
    }
    return event;
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

function createObjectEventDescriptor(eventType: number, eventNumber: number): string {
    for (const [category, categoryEventType] of Object.entries(OBJECT_EVENT_TYPES)) {
        if (categoryEventType !== eventType) {
            continue;
        }

        const eventNumbers = OBJECT_EVENT_NUMBERS[category as keyof typeof OBJECT_EVENT_NUMBERS];
        if (eventNumbers !== undefined) {
            for (const [descriptor, descriptorEventNumber] of Object.entries(eventNumbers)) {
                if (descriptorEventNumber === eventNumber) {
                    return `${category}:${descriptor}`;
                }
            }
        }

        return `${category}:${String(eventNumber)}`;
    }

    return `${String(eventType)}:${String(eventNumber)}`;
}

function createSourceSummary(sourceText: string): ObjectEventInspectionResult["source"] {
    const firstNonEmptyLine = sourceText
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .find((line) => line.length > 0);
    return Object.freeze({
        byteLength: Buffer.byteLength(sourceText, "utf8"),
        lineCount: sourceText.length === 0 ? 0 : sourceText.split(/\r?\n/u).length,
        present: true,
        summary: firstNonEmptyLine ?? ""
    });
}

function createMissingSourceSummary(): ObjectEventInspectionResult["source"] {
    return Object.freeze({
        byteLength: 0,
        lineCount: 0,
        present: false,
        summary: ""
    });
}

async function readObjectEventSource(
    projectRoot: string,
    eventFilePath: string
): Promise<Readonly<{ sourceText: string; source: ObjectEventInspectionResult["source"] }>> {
    try {
        const sourceText = await readFile(path.join(projectRoot, Core.fromPosixPath(eventFilePath)), "utf8");
        return Object.freeze({
            source: createSourceSummary(sourceText),
            sourceText
        });
    } catch {
        return Object.freeze({
            source: createMissingSourceSummary(),
            sourceText: ""
        });
    }
}

function parseObjectEventSource(sourceText: string, sourcePresent: boolean): ObjectEventParseSummary {
    if (!sourcePresent) {
        return Object.freeze({
            diagnostic: "Object event source file is missing.",
            ok: false
        });
    }

    try {
        defaultGmlProgramParser(sourceText);
        return Object.freeze({
            diagnostic: null,
            ok: true
        });
    } catch (error) {
        return Object.freeze({
            diagnostic: Core.getErrorMessage(error),
            ok: false
        });
    }
}

function normalizeHandlerSource(handlerSource: string): string {
    return handlerSource.endsWith("\n") ? handlerSource : `${handlerSource}\n`;
}

function getObjectEventListForMutation(objectDocument: Record<string, unknown>, objectName: string): Array<unknown> {
    if (objectDocument.eventList === undefined) {
        objectDocument.eventList = [];
    }

    if (!Array.isArray(objectDocument.eventList)) {
        throw new TypeError(`Object '${objectName}' metadata has a non-array eventList and cannot be safely mutated.`);
    }

    return objectDocument.eventList;
}

function createObjectEventMetadata(
    eventType: number,
    eventNumber: number,
    eventFilePath: string
): Record<string, unknown> {
    return {
        $GMEvent: "",
        "%Name": "",
        collisionObjectId: null,
        eventContents: eventFilePath,
        eventNum: eventNumber,
        eventType,
        isDnD: false,
        name: "",
        resourceType: "GMEvent",
        resourceVersion: "2.0"
    };
}

async function writeObjectMetadataIfApplying(
    dryRun: boolean,
    objectAbsolutePath: string,
    objectDocument: Record<string, unknown>
): Promise<void> {
    if (dryRun) {
        return;
    }

    await writeFile(
        objectAbsolutePath,
        `${Core.stringifyProjectMetadataDocument(objectDocument, objectAbsolutePath)}\n`,
        "utf8"
    );
}

async function resolveObjectEventMutationContext(
    projectRoot: string,
    objectName: string,
    descriptor: ObjectEventDescriptor
): Promise<ObjectEventMutationContext> {
    const manifest = await resolveProjectManifestFile(projectRoot);
    const manifestDocument = await readProjectMetadataDocument(manifest.absolutePath);
    const objectReference = locateObjectReference(getManifestResources(manifestDocument), objectName);
    const objectAbsolutePath = path.join(projectRoot, Core.fromPosixPath(objectReference.path));
    const objectDocument = await readProjectMetadataDocument(objectAbsolutePath);
    const eventType = resolveObjectEventType(descriptor.category);
    const eventNumber = resolveObjectEventNumber(descriptor.category, descriptor.descriptor);
    const eventIndex = findObjectEventIndex(objectDocument, eventType, eventNumber);
    if (eventIndex < 0) {
        throw new Error(`Could not find object event ${eventType}:${eventNumber} on object '${objectReference.name}'.`);
    }
    const event = locateObjectEvent(objectDocument, objectReference.name, eventType, eventNumber);
    const eventFilePath = resolveEventFilePath(event, objectReference, eventType, eventNumber);

    return Object.freeze({
        event,
        eventIndex,
        eventFilePath,
        eventNumber,
        eventType,
        objectAbsolutePath,
        objectDocument,
        objectReference,
        projectRoot
    });
}

async function resolveObjectEventInspectionContext(
    projectRootInput: string,
    objectName: string
): Promise<ObjectEventInspectionContext> {
    const projectRoot = path.resolve(projectRootInput);
    const manifest = await resolveProjectManifestFile(projectRoot);
    const manifestDocument = await readProjectMetadataDocument(manifest.absolutePath);
    const objectReference = locateObjectReference(getManifestResources(manifestDocument), objectName);
    const objectAbsolutePath = path.join(projectRoot, Core.fromPosixPath(objectReference.path));
    const objectDocument = await readProjectMetadataDocument(objectAbsolutePath);

    return Object.freeze({
        objectAbsolutePath,
        objectDocument,
        objectReference,
        projectRoot
    });
}

async function inspectObjectEventRecord(
    context: ObjectEventInspectionContext,
    event: Record<string, unknown>
): Promise<ObjectEventInspectionResult | null> {
    const eventType = readNumericEventField(event, ["eventType", "eventtype"]);
    const eventNumber = readNumericEventField(event, ["eventNum", "enumb"]);
    if (eventType === null || eventNumber === null) {
        return null;
    }

    const eventFilePath = resolveEventFilePath(event, context.objectReference, eventType, eventNumber);
    const sourceRead = await readObjectEventSource(context.projectRoot, eventFilePath);
    return Object.freeze({
        descriptor: createObjectEventDescriptor(eventType, eventNumber),
        eventFilePath,
        eventNumber,
        eventType,
        objectName: context.objectReference.name,
        objectPath: context.objectReference.path,
        parse: parseObjectEventSource(sourceRead.sourceText, sourceRead.source.present),
        source: sourceRead.source
    });
}

/**
 * List event handlers declared by one GameMaker object.
 *
 * @param request - Project root and object name to inspect.
 * @returns Deterministic event summaries sorted by event type and number.
 */
export async function listObjectEvents(request: {
    objectName: string;
    projectRoot: string;
}): Promise<ReadonlyArray<ObjectEventInspectionResult>> {
    const context = await resolveObjectEventInspectionContext(request.projectRoot, request.objectName);
    const inspectedEvents = await Promise.all(
        Core.asArray(context.objectDocument.eventList).map(async (eventEntry) => {
            if (!Core.isObjectLike(eventEntry)) {
                return null;
            }
            return await inspectObjectEventRecord(context, eventEntry as Record<string, unknown>);
        })
    );
    return Object.freeze(
        inspectedEvents
            .filter((event): event is ObjectEventInspectionResult => event !== null)
            .sort((left, right) => left.eventType - right.eventType || left.eventNumber - right.eventNumber)
    );
}

/**
 * Inspect one event handler declared by a GameMaker object.
 *
 * @param request - Project root, object name, and event descriptor to inspect.
 * @returns The matching event summary.
 */
export async function inspectObjectEvent(request: {
    descriptor: ObjectEventDescriptor;
    objectName: string;
    projectRoot: string;
}): Promise<ObjectEventInspectionResult> {
    const context = await resolveObjectEventInspectionContext(request.projectRoot, request.objectName);
    const eventType = resolveObjectEventType(request.descriptor.category);
    const eventNumber = resolveObjectEventNumber(request.descriptor.category, request.descriptor.descriptor);
    const event = locateObjectEvent(context.objectDocument, context.objectReference.name, eventType, eventNumber);
    const inspected = await inspectObjectEventRecord(context, event);
    if (inspected === null) {
        throw new Error(
            `Could not inspect object event ${eventType}:${eventNumber} on '${context.objectReference.name}'.`
        );
    }
    return inspected;
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
 * Add a new GameMaker object event and associated GML source file.
 *
 * @param request - Object event creation request.
 * @returns Summary of the planned or applied object event metadata and source mutation.
 */
export async function addObjectEvent(request: AddObjectEventRequest): Promise<ObjectEventMutationResult> {
    const normalizedHandlerSource = normalizeHandlerSource(request.handlerSource);
    defaultGmlProgramParser(normalizedHandlerSource);

    const manifest = await resolveProjectManifestFile(request.projectRoot);
    const manifestDocument = await readProjectMetadataDocument(manifest.absolutePath);
    const objectReference = locateObjectReference(getManifestResources(manifestDocument), request.objectName);
    const objectAbsolutePath = path.join(request.projectRoot, Core.fromPosixPath(objectReference.path));
    const objectDocument = await readProjectMetadataDocument(objectAbsolutePath);
    const eventType = resolveObjectEventType(request.descriptor.category);
    const eventNumber = resolveObjectEventNumber(request.descriptor.category, request.descriptor.descriptor);
    if (findObjectEvent(objectDocument, eventType, eventNumber) !== null) {
        throw new Error(`Object '${objectReference.name}' already has event ${eventType}:${eventNumber}.`);
    }

    const eventFilePath = path.posix.join(path.posix.dirname(objectReference.path), `${eventType}_${eventNumber}.gml`);
    getObjectEventListForMutation(objectDocument, objectReference.name).push(
        createObjectEventMetadata(eventType, eventNumber, eventFilePath)
    );

    const dryRun = request.dryRun !== false;
    await writeObjectMetadataIfApplying(dryRun, objectAbsolutePath, objectDocument);
    await writeObjectEventSourceIfApplying(dryRun, request.projectRoot, eventFilePath, normalizedHandlerSource);

    return {
        action: "add",
        deletedPaths: [],
        dryRun,
        eventFilePath,
        eventNumber,
        eventType,
        objectName: objectReference.name,
        objectPath: objectReference.path,
        warnings: [],
        writtenPaths: [objectReference.path, eventFilePath]
    };
}

/**
 * Replace the GML source for an existing GameMaker object event.
 *
 * @param request - Object event update request.
 * @returns Summary of the planned or applied object event source mutation.
 */
export async function updateObjectEvent(request: UpdateObjectEventRequest): Promise<ObjectEventMutationResult> {
    const normalizedHandlerSource = normalizeHandlerSource(request.handlerSource);
    defaultGmlProgramParser(normalizedHandlerSource);

    const context = await resolveObjectEventMutationContext(
        request.projectRoot,
        request.objectName,
        request.descriptor
    );
    const dryRun = request.dryRun !== false;
    await writeObjectEventSourceIfApplying(dryRun, context.projectRoot, context.eventFilePath, normalizedHandlerSource);

    return {
        action: "update",
        deletedPaths: [],
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

/**
 * Delete an existing GameMaker object event and its associated GML source file.
 *
 * @param request - Object event deletion request.
 * @returns Summary of the planned or applied object event metadata and source deletion.
 */
export async function deleteObjectEvent(request: DeleteObjectEventRequest): Promise<ObjectEventMutationResult> {
    const context = await resolveObjectEventMutationContext(
        request.projectRoot,
        request.objectName,
        request.descriptor
    );
    const eventList = getObjectEventListForMutation(context.objectDocument, context.objectReference.name);
    eventList.splice(context.eventIndex, 1);

    const dryRun = request.dryRun !== false;
    await writeObjectMetadataIfApplying(dryRun, context.objectAbsolutePath, context.objectDocument);
    if (!dryRun) {
        await rm(path.join(context.projectRoot, Core.fromPosixPath(context.eventFilePath)), { force: true });
    }

    return {
        action: "delete",
        deletedPaths: [context.eventFilePath],
        dryRun,
        eventFilePath: context.eventFilePath,
        eventNumber: context.eventNumber,
        eventType: context.eventType,
        objectName: context.objectReference.name,
        objectPath: context.objectReference.path,
        warnings: [],
        writtenPaths: [context.objectReference.path]
    };
}
