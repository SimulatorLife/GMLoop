import path from "node:path";

import { Core } from "@gmloop/core";

import {
    isProjectManifestPath,
    matchProjectResourceMetadataExtension,
    PROJECT_MANIFEST_EXTENSION
} from "./constants.js";
import { defaultFsFacade, type ProjectIndexFsFacade } from "./fs-facade.js";
import { runWithMissingPathFallback } from "./missing-path-fallback.js";
import { normalizeProjectResourcePath } from "./path-normalization.js";
import { logProjectIndexDebug, type ProjectIndexLogger } from "./project-index-logger.js";
import { extractAssetReferencesFromMetadataDocument } from "./resource-reference-extractor.js";

const RESOURCE_ANALYSIS_ABORT_MESSAGE = "Project index build was aborted.";

function normalizeResourceDocumentMetadata(resourceData) {
    if (!Core.isObjectLike(resourceData)) {
        return { name: null, resourceType: null };
    }

    const { name, resourceType } = resourceData;
    const normalizedName = Core.isNonEmptyTrimmedString(name) ? name : null;
    const normalizedResourceType = Core.isNonEmptyTrimmedString(resourceType) ? resourceType : null;

    return { name: normalizedName, resourceType: normalizedResourceType };
}

function deriveScopeId(kind, parts) {
    const suffix = Array.isArray(parts) ? parts.join("::") : String(parts ?? "");
    return `scope:${kind}:${suffix}`;
}

function ensureResourceRecord(resourcesMap, resourcePath, resourceData = {}) {
    const { name: normalizedName, resourceType: normalizedResourceType } =
        normalizeResourceDocumentMetadata(resourceData);
    const record = Core.getOrCreateMapEntry(resourcesMap, resourcePath, () => {
        const defaultName = deriveDefaultResourceName(resourcePath);

        return {
            path: resourcePath,
            name: normalizedName ?? defaultName,
            resourceType: normalizedResourceType ?? "unknown",
            scopes: [],
            gmlFiles: [],
            assetReferences: []
        };
    });

    if (normalizedName && record.name !== normalizedName) {
        record.name = normalizedName;
    }
    if (normalizedResourceType && record.resourceType !== normalizedResourceType) {
        record.resourceType = normalizedResourceType;
    }

    return record;
}

function deriveDefaultResourceName(resourcePath) {
    const baseName = path.posix.basename(resourcePath);
    const matchedExtension = matchProjectResourceMetadataExtension(resourcePath);
    if (matchedExtension) {
        const trimmed = resourcePath.slice(0, -matchedExtension.length);
        return path.posix.basename(trimmed);
    }

    if (isProjectManifestPath(resourcePath)) {
        return path.posix.basename(resourcePath, PROJECT_MANIFEST_EXTENSION);
    }

    return baseName;
}

function createScriptScopeDescriptor(resourceRecord, gmlRelativePath) {
    const scopeId = deriveScopeId("script", [resourceRecord.name]);
    return {
        id: scopeId,
        kind: "script",
        name: resourceRecord.name,
        displayName: `script.${resourceRecord.name}`,
        resourcePath: resourceRecord.path,
        gmlFile: gmlRelativePath
    };
}

function getNumericEventField(event, keys) {
    for (const key of keys) {
        const value = event?.[key];
        if (typeof value === "number") {
            return value;
        }
    }

    return null;
}

const EVENT_TYPE_NAMES: Record<number, string> = {
    0: "Create",
    1: "Destroy",
    2: "CleanUp",
    3: "Step",
    4: "Collision",
    5: "Keyboard",
    6: "Mouse",
    7: "Other",
    8: "Draw",
    9: "KeyPress",
    10: "KeyRelease",
    12: "Gesture"
};

function resolveEventMetadata(event) {
    const eventType = getNumericEventField(event, ["eventType", "eventtype"]);
    const eventNum = getNumericEventField(event, ["eventNum", "enumb"]);

    if (Core.isNonEmptyTrimmedString(event?.name)) {
        return { eventType, eventNum, displayName: event.name };
    }

    if (eventType === null && eventNum === null) {
        return { eventType, eventNum, displayName: "event" };
    }

    if (eventType !== null) {
        const eventName = EVENT_TYPE_NAMES[eventType];
        if (eventName) {
            const numSuffix = eventNum === null ? "_0" : `_${eventNum}`;
            return { eventType, eventNum, displayName: `${eventName}${numSuffix}` };
        }
    }

    if (eventNum === null) {
        return { eventType, eventNum, displayName: String(eventType) };
    }

    return { eventType, eventNum, displayName: `${eventType}_${eventNum}` };
}

function createObjectEventScopeDescriptor(resourceRecord, event, gmlRelativePath) {
    const { displayName, eventType, eventNum } = resolveEventMetadata(event);
    const scopeId = deriveScopeId("object", [resourceRecord.name, displayName]);
    return {
        id: scopeId,
        kind: "objectEvent",
        name: `${resourceRecord.name}.${displayName}`,
        displayName: `object.${resourceRecord.name}.${displayName}`,
        resourcePath: resourceRecord.path,
        gmlFile: gmlRelativePath,
        event: {
            name: displayName,
            eventType,
            eventNum
        }
    };
}

export function createFileScopeDescriptor(relativePath) {
    const fileBaseName = path.posix.basename(relativePath, path.extname(relativePath));
    const scopeId = deriveScopeId("file", [relativePath]);
    return {
        id: scopeId,
        kind: "file",
        name: fileBaseName,
        displayName: `file.${relativePath}`,
        resourcePath: null,
        gmlFile: relativePath
    };
}

async function extractEventGmlPath(event, resourceRecord, resourceRelativeDir, projectRoot, fsFacade) {
    const { displayName } = resolveEventMetadata(event);
    for (const candidate of [
        event?.eventContents,
        event?.event,
        event?.event?.path,
        event?.eventId?.path,
        event?.code
    ]) {
        if (typeof candidate !== "string") {
            continue;
        }

        const normalized = normalizeProjectResourcePath(candidate);
        if (normalized) {
            return normalized;
        }
    }

    if (!resourceRecord?.name) {
        return null;
    }

    const standardRelativePath = path.posix.join(resourceRelativeDir, `${displayName}.gml`);
    const standardAbsolutePath = path.join(projectRoot, standardRelativePath);
    try {
        if (fsFacade && typeof fsFacade.stat === "function") {
            const stats = await fsFacade.stat(standardAbsolutePath);
            if (stats) {
                return standardRelativePath;
            }
        }
    } catch {
        // Fall back to legacy format
    }

    return path.posix.join(resourceRelativeDir, `${resourceRecord.name}_${displayName}.gml`);
}

function createResourceAnalysisContext() {
    return {
        resourcesMap: new Map(),
        gmlScopeMap: new Map(),
        assetReferences: [],
        scriptNameToScopeId: new Map(),
        scriptNameToResourcePath: new Map()
    };
}

async function loadResourceDocument(
    file,
    fsFacade: Required<Pick<ProjectIndexFsFacade, "readFile">> = defaultFsFacade,
    options = {}
) {
    const { ensureNotAborted } = Core.createAbortGuard(options, {
        fallbackMessage: RESOURCE_ANALYSIS_ABORT_MESSAGE
    });
    const rawContents = await runWithMissingPathFallback(
        () => fsFacade.readFile(file.absolutePath, "utf8"),
        () => null
    );

    ensureNotAborted();

    try {
        // Use plain parse (no schema) to preserve the original document structure.
        // Schema-validated parsing fills in schema defaults and can replace custom
        // fields (e.g. sprite sequence channel data) with empty defaults, causing
        // asset reference data loss. Schema validation is only needed for mutation
        // workflows, not for read-only resource analysis.
        return Core.parseProjectMetadataDocument(rawContents, file.absolutePath ?? file.relativePath);
    } catch (error) {
        if (Core.isProjectMetadataParseError(error)) {
            return null;
        }
        throw error;
    }
}

function ensureResourceRecordForDocument(context, file, parsed) {
    return ensureResourceRecord(context.resourcesMap, file.relativePath, {
        name: parsed?.name,
        resourceType: parsed?.resourceType
    });
}

function attachScopeDescriptor({ context, resourceRecord, gmlRelativePath, descriptor }) {
    Core.pushUnique(resourceRecord.gmlFiles, gmlRelativePath);
    context.gmlScopeMap.set(gmlRelativePath, descriptor);
    Core.pushUnique(resourceRecord.scopes, descriptor.id);
}

function registerScriptResourceIfNeeded({ context, parsed, resourceRecord, resourceDir }) {
    if (parsed?.resourceType !== "GMScript") {
        return;
    }

    const gmlRelativePath = path.posix.join(resourceDir, `${resourceRecord.name}.gml`);
    const descriptor = createScriptScopeDescriptor(resourceRecord, gmlRelativePath);

    attachScopeDescriptor({
        context,
        resourceRecord,
        gmlRelativePath,
        descriptor
    });

    context.scriptNameToScopeId.set(resourceRecord.name, descriptor.id);
    context.scriptNameToResourcePath.set(resourceRecord.name, resourceRecord.path);
}

async function registerResourceEvents({ context, parsed, resourceRecord, resourceDir, projectRoot, fsFacade }) {
    const eventList = parsed?.eventList;
    if (!Core.isNonEmptyArray(eventList)) {
        return;
    }

    for (const event of eventList) {
        const eventGmlPath = await extractEventGmlPath(event, resourceRecord, resourceDir, projectRoot, fsFacade);
        if (!eventGmlPath) {
            continue;
        }

        const descriptor = createObjectEventScopeDescriptor(resourceRecord, event, eventGmlPath);

        attachScopeDescriptor({
            context,
            resourceRecord,
            gmlRelativePath: eventGmlPath,
            descriptor
        });
    }
}

function collectResourceAssetReferences({ context, parsed, resourceRecord, resourcePath, projectRoot }) {
    const extractedReferences = extractAssetReferencesFromMetadataDocument({
        document: parsed,
        sourcePath: resourcePath,
        projectRoot
    });

    for (const { propertyPath, targetPath, targetName } of extractedReferences) {
        const referenceRecord = {
            fromResourcePath: resourcePath,
            fromResourceName: resourceRecord.name,
            propertyPath,
            targetPath,
            targetName: targetName ?? null,
            targetResourceType: null
        };

        context.assetReferences.push(referenceRecord);
        resourceRecord.assetReferences.push(referenceRecord);
    }
}

async function processResourceDocument({ context, parsed, resourceRecord, resourcePath, projectRoot, fsFacade }) {
    const resourceDir = path.posix.dirname(resourcePath);

    registerScriptResourceIfNeeded({
        context,
        parsed,
        resourceRecord,
        resourceDir
    });

    await registerResourceEvents({
        context,
        parsed,
        resourceRecord,
        resourceDir,
        projectRoot,
        fsFacade
    });

    collectResourceAssetReferences({
        context,
        parsed,
        resourceRecord,
        resourcePath,
        projectRoot
    });
}

function annotateAssetReferenceTargets(assetReferences, resourcesMap) {
    for (const reference of assetReferences) {
        const targetResource = resourcesMap.get(reference.targetPath);
        if (targetResource) {
            reference.targetResourceType = targetResource.resourceType;
            if (!reference.targetName && targetResource.name) {
                reference.targetName = targetResource.name;
            }
        }
    }
}

export async function analyseResourceFiles({
    projectRoot,
    yyFiles,
    fsFacade = defaultFsFacade,
    signal = null,
    logger = null
}: {
    projectRoot: string;
    yyFiles: Array<{ relativePath: string; absolutePath: string }>;
    fsFacade?: Required<Pick<ProjectIndexFsFacade, "readFile">> & ProjectIndexFsFacade;
    signal?: AbortSignal | null;
    logger?: ProjectIndexLogger;
}) {
    const context = createResourceAnalysisContext();

    let parsedCount = 0;
    let skippedCount = 0;

    await Core.runSequentially(yyFiles, async (file) => {
        Core.throwIfAborted(signal, RESOURCE_ANALYSIS_ABORT_MESSAGE);
        const parsed = await loadResourceDocument(file, fsFacade, { signal });
        if (!parsed) {
            skippedCount++;
            return;
        }

        parsedCount++;

        const resourceRecord = ensureResourceRecordForDocument(context, file, parsed);

        await processResourceDocument({
            context,
            parsed,
            resourceRecord,
            resourcePath: file.relativePath,
            projectRoot,
            fsFacade
        });
    });

    if (logger) {
        logProjectIndexDebug(
            logger,
            `DEBUG: analyseResourceFiles parsed ${parsedCount}, skipped ${skippedCount}, resourcesMap size = ${context.resourcesMap.size}`
        );
    }

    annotateAssetReferenceTargets(context.assetReferences, context.resourcesMap);

    return context;
}
