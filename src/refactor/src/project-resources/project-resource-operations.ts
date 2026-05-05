import { randomUUID } from "node:crypto";
import { access, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { Core } from "@gmloop/core";

import {
    defaultProjectMetadataAdapter,
    type ProjectMetadataAdapter
} from "./project-metadata-adapter.js";
import {
    ProjectResourceKind,
    type ProjectResourceKindValue,
    requireProjectResourceKind
} from "./project-resource-kinds.js";

const RESOURCE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const EMPTY_PNG_BYTES = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+tmN0AAAAASUVORK5CYII=",
    "base64"
);

type ProjectResourceArtifact = Readonly<{
    content: Buffer | string;
    path: string;
}>;

type ProjectManifestEntry = Readonly<{
    id: Readonly<{
        name: string;
        path: string;
    }>;
}>;

/**
 * Parameters for creating a new GameMaker project resource skeleton.
 */
export interface AddProjectResourceRequest {
    dryRun?: boolean;
    /** Codec for reading/writing .yy metadata files. Defaults to plain JSON. */
    metadataAdapter?: ProjectMetadataAdapter;
    projectRoot: string;
    resourceKind: ProjectResourceKindValue;
    resourceName: string;
}

/**
 * Parameters for removing a GameMaker project resource from a project manifest.
 */
export interface RemoveProjectResourceRequest {
    dryRun?: boolean;
    /** Codec for reading/writing .yy metadata files. Defaults to plain JSON. */
    metadataAdapter?: ProjectMetadataAdapter;
    projectRoot: string;
    resourceKind: ProjectResourceKindValue;
    resourceName: string;
}

/**
 * Parameters for renaming an existing GameMaker project resource.
 */
export interface RenameProjectResourceRequest {
    dryRun?: boolean;
    /** Codec for reading/writing .yy metadata files. Defaults to plain JSON. */
    metadataAdapter?: ProjectMetadataAdapter;
    newResourceName: string;
    projectRoot: string;
    resourceKind: ProjectResourceKindValue;
    resourceName: string;
}

/**
 * Parameters for duplicating an existing GameMaker project resource.
 */
export interface DuplicateProjectResourceRequest {
    dryRun?: boolean;
    /** Codec for reading/writing .yy metadata files. Defaults to plain JSON. */
    metadataAdapter?: ProjectMetadataAdapter;
    newResourceName: string;
    projectRoot: string;
    resourceKind: ProjectResourceKindValue;
    resourceName: string;
}

/**
 * Parameters for moving an existing GameMaker project resource.
 */
export interface MoveProjectResourceRequest {
    destinationFolder: string;
    dryRun?: boolean;
    /** Codec for reading/writing .yy metadata files. Defaults to plain JSON. */
    metadataAdapter?: ProjectMetadataAdapter;
    projectRoot: string;
    resourceKind: ProjectResourceKindValue;
    resourceName: string;
}

/**
 * Summary returned after project resource mutations.
 */
export interface ProjectResourceMutationResult {
    action: "add" | "duplicate" | "move" | "remove" | "rename";
    deletedPaths: Array<string>;
    dryRun: boolean;
    manifestPath: string;
    resourceKind: ProjectResourceKindValue;
    resourceName: string;
    resourcePath: string;
    warnings: Array<string>;
    writtenPaths: Array<string>;
}

type ResolvedProjectManifest = Readonly<{
    absolutePath: string;
    projectName: string;
    relativePath: string;
}>;

type ResourceTypeDescriptor = Readonly<{
    resourceDirectory: string;
    resourceType: string;
}>;

type ProjectResourceContext = Readonly<{
    manifest: ResolvedProjectManifest;
    projectRoot: string;
    resourceDirectory: string;
    resourceKind: ProjectResourceKindValue;
    resourceName: string;
    resourcePath: string;
    resourceType: string;
}>;

type ExistingProjectResource = Readonly<{
    manifestEntryIndex: number;
    manifestResourcePath: string;
}>;

const RESOURCE_TYPE_BY_KIND: Readonly<Record<ProjectResourceKindValue, ResourceTypeDescriptor>> = Object.freeze({
    [ProjectResourceKind.FONT]: Object.freeze({
        resourceDirectory: "fonts",
        resourceType: "GMFont"
    }),
    [ProjectResourceKind.OBJECT]: Object.freeze({
        resourceDirectory: "objects",
        resourceType: "GMObject"
    }),
    [ProjectResourceKind.ROOM]: Object.freeze({
        resourceDirectory: "rooms",
        resourceType: "GMRoom"
    }),
    [ProjectResourceKind.SCRIPT]: Object.freeze({
        resourceDirectory: "scripts",
        resourceType: "GMScript"
    }),
    [ProjectResourceKind.SPRITE]: Object.freeze({
        resourceDirectory: "sprites",
        resourceType: "GMSprite"
    })
});

function assertValidProjectResourceName(resourceName: string): void {
    if (!RESOURCE_NAME_PATTERN.test(resourceName)) {
        throw new TypeError(
            `Invalid resource name '${resourceName}'. Resource names must match ${RESOURCE_NAME_PATTERN.toString()}.`
        );
    }
}

function toAbsoluteProjectPath(projectRoot: string, relativeProjectPath: string): string {
    return path.resolve(projectRoot, Core.fromPosixPath(relativeProjectPath));
}

async function pathExists(candidatePath: string): Promise<boolean> {
    try {
        await access(candidatePath);
        return true;
    } catch {
        return false;
    }
}

async function resolveProjectManifest(
    projectRoot: string,
    adapter: ProjectMetadataAdapter
): Promise<ResolvedProjectManifest> {
    const directoryEntries = await readdir(projectRoot, {
        withFileTypes: true
    });
    const manifestFileNames = directoryEntries
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".yyp"))
        .map((entry) => entry.name)
        .toSorted((left, right) => left.localeCompare(right));

    if (manifestFileNames.length === 0) {
        throw new Error(`Could not locate a .yyp manifest inside '${projectRoot}'.`);
    }

    if (manifestFileNames.length > 1) {
        throw new Error(
            `Found multiple .yyp manifests in '${projectRoot}'. Resource operations require exactly one project manifest.`
        );
    }

    const manifestFileName = manifestFileNames[0];
    const manifestAbsolutePath = path.join(projectRoot, manifestFileName);
    const manifestDocument = await readProjectMetadataDocument(manifestAbsolutePath, adapter);
    const manifestName =
        Core.getNonEmptyString(manifestDocument.name) ??
        path.basename(manifestFileName, path.extname(manifestFileName));

    return Object.freeze({
        absolutePath: manifestAbsolutePath,
        projectName: manifestName,
        relativePath: Core.toPosixPath(manifestFileName)
    });
}

async function readProjectMetadataDocument(
    absolutePath: string,
    adapter: ProjectMetadataAdapter
): Promise<Record<string, unknown>> {
    const rawContent = await readFile(absolutePath, "utf8");
    return adapter.parseDocument(rawContent, absolutePath);
}

function createProjectResourceContext(
    projectRoot: string,
    resourceKind: ProjectResourceKindValue,
    resourceName: string,
    manifest: ResolvedProjectManifest
): ProjectResourceContext {
    const descriptor = RESOURCE_TYPE_BY_KIND[resourceKind];
    const resourcePath = `${descriptor.resourceDirectory}/${resourceName}/${resourceName}.yy`;

    return Object.freeze({
        manifest,
        projectRoot,
        resourceDirectory: descriptor.resourceDirectory,
        resourceKind,
        resourceName,
        resourcePath,
        resourceType: descriptor.resourceType
    });
}

function getManifestResources(document: Record<string, unknown>): Array<ProjectManifestEntry> {
    const resourceEntries = Core.asArray(document.resources);
    const normalizedEntries: Array<ProjectManifestEntry> = [];

    for (const resourceEntry of resourceEntries) {
        if (!Core.isObjectLike(resourceEntry)) {
            continue;
        }

        const resourceEntryRecord = resourceEntry as { id?: unknown };
        if (!Core.isObjectLike(resourceEntryRecord.id)) {
            continue;
        }

        const identifierRecord = resourceEntryRecord.id as { name?: unknown; path?: unknown };
        const name = Core.getNonEmptyString(identifierRecord.name);
        const resourcePath = Core.getNonEmptyString(identifierRecord.path);
        if (!name || !resourcePath) {
            continue;
        }

        normalizedEntries.push(
            Object.freeze({
                id: Object.freeze({
                    name,
                    path: resourcePath
                })
            })
        );
    }

    return normalizedEntries;
}

function createManifestEntry(resourceName: string, resourcePath: string): ProjectManifestEntry {
    return Object.freeze({
        id: Object.freeze({
            name: resourceName,
            path: resourcePath
        })
    });
}

function isCanonicalResourceDirectory(resourceName: string, resourcePath: string): boolean {
    return path.posix.basename(path.posix.dirname(resourcePath)) === resourceName;
}

function replaceResourcePathReferences<TValue>(value: TValue, previousPath: string, nextPath: string): TValue {
    if (typeof value === "string") {
        return (value === previousPath ? nextPath : value) as TValue;
    }
    if (Array.isArray(value)) {
        return value.map((entry) => replaceResourcePathReferences(entry, previousPath, nextPath)) as TValue;
    }
    if (!Core.isObjectLike(value)) {
        return value;
    }

    const record = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(record)) {
        output[key] = replaceResourcePathReferences(entry, previousPath, nextPath);
    }
    return output as TValue;
}

function updateMetadataNameAndPath(
    metadataDocument: Record<string, unknown>,
    nextResourceName: string,
    previousResourcePath: string,
    nextResourcePath: string
): Record<string, unknown> {
    const rewrittenDocument = replaceResourcePathReferences(metadataDocument, previousResourcePath, nextResourcePath);
    rewrittenDocument.name = nextResourceName;
    if (typeof rewrittenDocument["%Name"] === "string") {
        rewrittenDocument["%Name"] = nextResourceName;
    }
    rewrittenDocument.resourcePath = nextResourcePath;
    return rewrittenDocument;
}

function locateExistingProjectResource(
    manifestResources: ReadonlyArray<ProjectManifestEntry>,
    context: ProjectResourceContext
): ExistingProjectResource | null {
    const expectedPrefix = `${context.resourceDirectory}/`;

    let located: ExistingProjectResource | null = null;
    for (const [entryIndex, manifestEntry] of manifestResources.entries()) {
        if (manifestEntry.id.name !== context.resourceName || !manifestEntry.id.path.startsWith(expectedPrefix)) {
            continue;
        }

        if (located !== null) {
            throw new Error(
                `Found multiple ${context.resourceKind} resources named '${context.resourceName}' in ${context.manifest.relativePath}.`
            );
        }

        located = Object.freeze({
            manifestEntryIndex: entryIndex,
            manifestResourcePath: manifestEntry.id.path
        });
    }

    return located;
}

function createParentReference(context: ProjectResourceContext): { name: string; path: string } {
    return {
        name: context.manifest.projectName,
        path: path.posix.basename(context.manifest.relativePath)
    };
}

function createDefaultRoomViews(): Array<Record<string, number | boolean | null>> {
    return Array.from({ length: 8 }, () => ({
        hborder: 32,
        hport: 768,
        hspeed: -1,
        hview: 768,
        inherit: false,
        objectId: null,
        vborder: 32,
        visible: false,
        vspeed: -1,
        wport: 1024,
        wview: 1024,
        xport: 0,
        xview: 0,
        yport: 0,
        yview: 0
    }));
}

function createResourceMetadataDocument(context: ProjectResourceContext): Record<string, unknown> {
    const parent = createParentReference(context);

    switch (context.resourceKind) {
        case ProjectResourceKind.SCRIPT: {
            return {
                $GMScript: "v1",
                "%Name": context.resourceName,
                isCompatibility: false,
                isDnD: false,
                name: context.resourceName,
                parent,
                resourcePath: context.resourcePath,
                resourceType: context.resourceType,
                resourceVersion: "2.0"
            };
        }
        case ProjectResourceKind.OBJECT: {
            return {
                $GMObject: "",
                "%Name": context.resourceName,
                eventList: [],
                managed: true,
                name: context.resourceName,
                overriddenProperties: [],
                parent,
                parentObjectId: null,
                persistent: false,
                physicsAngularDamping: 0.1,
                physicsDensity: 0.5,
                physicsFriction: 0.2,
                physicsGroup: 1,
                physicsKinematic: false,
                physicsLinearDamping: 0.1,
                physicsObject: false,
                physicsRestitution: 0.1,
                physicsSensor: false,
                physicsShape: 1,
                physicsShapePoints: [],
                physicsStartAwake: true,
                properties: [],
                resourcePath: context.resourcePath,
                resourceType: context.resourceType,
                resourceVersion: "2.0",
                solid: false,
                spriteId: null,
                spriteMaskId: null,
                visible: true
            };
        }
        case ProjectResourceKind.ROOM: {
            return {
                $GMRoom: "v1",
                "%Name": context.resourceName,
                creationCodeFile: "",
                inheritCode: false,
                inheritCreationOrder: false,
                inheritLayers: false,
                instanceCreationOrder: [],
                isDnd: false,
                layers: [
                    {
                        $GMRInstanceLayer: "",
                        "%Name": "Instances",
                        depth: 0,
                        effectEnabled: true,
                        effectType: null,
                        gridX: 32,
                        gridY: 32,
                        hierarchyFrozen: false,
                        inheritLayerDepth: false,
                        inheritLayerSettings: false,
                        inheritSubLayers: true,
                        inheritVisibility: true,
                        instances: [],
                        layers: [],
                        name: "Instances",
                        properties: [],
                        resourceType: "GMRInstanceLayer",
                        resourceVersion: "2.0",
                        userdefinedDepth: false,
                        visible: true
                    },
                    {
                        $GMRBackgroundLayer: "",
                        "%Name": "Background",
                        animationFPS: 15,
                        animationSpeedType: 0,
                        colour: 4_278_190_080,
                        depth: 100,
                        effectEnabled: true,
                        effectType: "none",
                        gridX: 32,
                        gridY: 32,
                        hierarchyFrozen: false,
                        hspeed: 0,
                        htiled: true,
                        inheritLayerDepth: false,
                        inheritLayerSettings: false,
                        inheritSubLayers: true,
                        inheritVisibility: true,
                        layers: [],
                        name: "Background",
                        properties: [],
                        resourceType: "GMRBackgroundLayer",
                        resourceVersion: "2.0",
                        spriteId: null,
                        stretch: true,
                        userdefinedAnimFPS: false,
                        userdefinedDepth: false,
                        visible: true,
                        vspeed: 0,
                        vtiled: true,
                        x: 0,
                        y: 0
                    }
                ],
                name: context.resourceName,
                parent,
                parentRoom: null,
                physicsSettings: {
                    PhysicsWorld: false,
                    PhysicsWorldGravityX: 0,
                    PhysicsWorldGravityY: 10,
                    PhysicsWorldPixToMetres: 0.1,
                    inheritPhysicsSettings: false
                },
                resourcePath: context.resourcePath,
                resourceType: context.resourceType,
                resourceVersion: "2.0",
                roomSettings: {
                    Height: 768,
                    Width: 1024,
                    inheritRoomSettings: false,
                    persistent: false
                },
                sequenceId: null,
                viewSettings: {
                    clearDisplayBuffer: true,
                    clearViewBackground: false,
                    enableViews: false,
                    inheritViewSettings: false
                },
                views: createDefaultRoomViews(),
                volume: 1
            };
        }
        case ProjectResourceKind.SPRITE: {
            const frameName = randomUUID();
            const layerName = randomUUID();
            const keyframeName = randomUUID();

            return {
                $GMSprite: "v2",
                "%Name": context.resourceName,
                bboxMode: 0,
                bbox_bottom: 0,
                bbox_left: 0,
                bbox_right: 0,
                bbox_top: 0,
                collisionKind: 1,
                collisionTolerance: 0,
                DynamicTexturePage: false,
                edgeFiltering: false,
                For3D: false,
                frames: [
                    {
                        $GMSpriteFrame: "v1",
                        "%Name": frameName,
                        name: frameName,
                        resourceType: "GMSpriteFrame",
                        resourceVersion: "2.0"
                    }
                ],
                gridX: 0,
                gridY: 0,
                height: 1,
                HTile: false,
                layers: [
                    {
                        $GMImageLayer: "",
                        "%Name": layerName,
                        blendMode: 0,
                        displayName: "default",
                        isLocked: false,
                        name: layerName,
                        opacity: 100,
                        resourceType: "GMImageLayer",
                        resourceVersion: "2.0",
                        visible: true
                    }
                ],
                name: context.resourceName,
                nineSlice: null,
                origin: 0,
                parent,
                preMultiplyAlpha: false,
                resourcePath: context.resourcePath,
                resourceType: context.resourceType,
                resourceVersion: "2.0",
                sequence: {
                    $GMSequence: "v1",
                    "%Name": context.resourceName,
                    autoRecord: true,
                    backdropHeight: 768,
                    backdropImageOpacity: 0.5,
                    backdropImagePath: "",
                    backdropWidth: 1024,
                    backdropXOffset: 0,
                    backdropYOffset: 0,
                    events: {
                        $KeyframeStore: "",
                        Keyframes: [],
                        resourceType: "KeyframeStore<MessageEventKeyframe>",
                        resourceVersion: "2.0"
                    },
                    eventStubScript: null,
                    eventToFunction: {},
                    length: 1,
                    lockOrigin: false,
                    moments: {
                        $KeyframeStore: "",
                        Keyframes: [],
                        resourceType: "KeyframeStore<MomentsEventKeyframe>",
                        resourceVersion: "2.0"
                    },
                    name: context.resourceName,
                    playback: 1,
                    playbackSpeed: 30,
                    playbackSpeedType: 0,
                    resourceType: "GMSequence",
                    resourceVersion: "2.0",
                    showBackdrop: true,
                    showBackdropImage: false,
                    timeUnits: 1,
                    tracks: [
                        {
                            $GMSpriteFramesTrack: "",
                            builtinName: 0,
                            events: [],
                            inheritsTrackColour: true,
                            interpolation: 1,
                            isCreationTrack: false,
                            keyframes: {
                                $KeyframeStore: "",
                                Keyframes: [
                                    {
                                        $Keyframe: "",
                                        Channels: {
                                            "0": {
                                                $SpriteFrameKeyframe: "",
                                                Id: {
                                                    name: frameName,
                                                    path: context.resourcePath
                                                },
                                                resourceType: "SpriteFrameKeyframe",
                                                resourceVersion: "2.0"
                                            }
                                        },
                                        Disabled: false,
                                        id: keyframeName,
                                        IsCreationKey: false,
                                        Key: 0,
                                        Length: 1,
                                        resourceType: "Keyframe<SpriteFrameKeyframe>",
                                        resourceVersion: "2.0",
                                        Stretch: false
                                    }
                                ],
                                resourceType: "KeyframeStore<SpriteFrameKeyframe>",
                                resourceVersion: "2.0"
                            },
                            modifiers: [],
                            name: "frames",
                            resourceType: "GMSpriteFramesTrack",
                            resourceVersion: "2.0",
                            spriteId: null,
                            trackColour: 0,
                            tracks: [],
                            traits: 0
                        }
                    ],
                    visibleRange: null,
                    volume: 1,
                    xorigin: 0,
                    yorigin: 0
                },
                swatchColours: null,
                swfPrecision: 2.525,
                textureGroupId: {
                    name: "Default",
                    path: "texturegroups/Default"
                },
                type: 0,
                VTile: false,
                width: 1
            };
        }
        case ProjectResourceKind.FONT: {
            return {
                $GMFont: "",
                "%Name": context.resourceName,
                fontName: "Arial",
                glyphs: {},
                name: context.resourceName,
                parent,
                ranges: [],
                resourcePath: context.resourcePath,
                resourceType: context.resourceType,
                resourceVersion: "2.0"
            };
        }
    }
}

function createResourceArtifacts(
    context: ProjectResourceContext,
    metadataDocument: Record<string, unknown>,
    adapter: ProjectMetadataAdapter
): Array<ProjectResourceArtifact> {
    const artifacts: Array<ProjectResourceArtifact> = [
        {
            path: context.resourcePath,
            content: `${adapter.stringifyDocument(metadataDocument, context.resourcePath)}\n`
        }
    ];

    if (context.resourceKind === ProjectResourceKind.SCRIPT) {
        artifacts.push({
            path: `${context.resourceDirectory}/${context.resourceName}/${context.resourceName}.gml`,
            content: `function ${context.resourceName}() {\n}\n`
        });
        return artifacts;
    }

    if (context.resourceKind === ProjectResourceKind.SPRITE) {
        const frameName = Core.getNonEmptyString(
            (Core.asArray(metadataDocument.frames)[0] as { name?: unknown })?.name
        );
        const layerName = Core.getNonEmptyString(
            (Core.asArray(metadataDocument.layers)[0] as { name?: unknown })?.name
        );
        if (!frameName || !layerName) {
            throw new Error(`Sprite template for '${context.resourceName}' is missing frame/layer metadata.`);
        }

        artifacts.push(
            {
                path: `${context.resourceDirectory}/${context.resourceName}/${frameName}.png`,
                content: EMPTY_PNG_BYTES
            },
            {
                path: `${context.resourceDirectory}/${context.resourceName}/layers/${frameName}/${layerName}.png`,
                content: EMPTY_PNG_BYTES
            }
        );
        return artifacts;
    }

    if (context.resourceKind === ProjectResourceKind.FONT) {
        artifacts.push({
            path: `${context.resourceDirectory}/${context.resourceName}/${context.resourceName}.png`,
            content: EMPTY_PNG_BYTES
        });
    }

    return artifacts;
}

async function writeProjectArtifacts(
    projectRoot: string,
    artifacts: ReadonlyArray<ProjectResourceArtifact>
): Promise<void> {
    await Core.runSequentially(artifacts, async (artifact) => {
        const absolutePath = toAbsoluteProjectPath(projectRoot, artifact.path);
        await mkdir(path.dirname(absolutePath), { recursive: true });
        if (typeof artifact.content === "string") {
            await writeFile(absolutePath, artifact.content, "utf8");
            return;
        }

        await writeFile(absolutePath, artifact.content);
    });
}

async function copyDirectoryRecursive(sourceDirectory: string, destinationDirectory: string): Promise<void> {
    await mkdir(destinationDirectory, { recursive: true });
    const entries = await readdir(sourceDirectory, { withFileTypes: true });
    await Core.runSequentially(entries, async (entry) => {
        const sourcePath = path.join(sourceDirectory, entry.name);
        const destinationPath = path.join(destinationDirectory, entry.name);
        if (entry.isDirectory()) {
            await copyDirectoryRecursive(sourcePath, destinationPath);
            return;
        }

        if (!entry.isFile()) {
            return;
        }

        await mkdir(path.dirname(destinationPath), { recursive: true });
        await writeFile(destinationPath, await readFile(sourcePath));
    });
}

function createRenamedResourcePath(previousResourcePath: string, previousName: string, nextName: string): string {
    const previousDirectory = path.posix.dirname(previousResourcePath);
    const extension = path.posix.extname(previousResourcePath);
    if (isCanonicalResourceDirectory(previousName, previousResourcePath)) {
        return path.posix.join(path.posix.dirname(previousDirectory), nextName, `${nextName}${extension}`);
    }

    return path.posix.join(previousDirectory, `${nextName}${extension}`);
}

async function removeIfExists(absolutePath: string): Promise<void> {
    if (await pathExists(absolutePath)) {
        await rm(absolutePath, { force: true, recursive: true });
    }
}

async function renameFileIfExists(sourcePath: string, destinationPath: string): Promise<void> {
    if (!(await pathExists(sourcePath))) {
        return;
    }
    await mkdir(path.dirname(destinationPath), { recursive: true });
    await writeFile(destinationPath, await readFile(sourcePath));
    await rm(sourcePath, { force: true });
}

function validateDestinationFolder(destinationFolder: string): string {
    const normalizedFolder = Core.toPosixPath(path.posix.normalize(destinationFolder)).replace(/\/+$/u, "");
    if (
        !normalizedFolder ||
        normalizedFolder === "." ||
        normalizedFolder === ".." ||
        normalizedFolder.startsWith("../")
    ) {
        throw new TypeError(`Invalid destination folder '${destinationFolder}'. Expected a relative project path.`);
    }
    if (path.posix.isAbsolute(normalizedFolder)) {
        throw new TypeError(`Invalid destination folder '${destinationFolder}'. Absolute paths are not supported.`);
    }
    return normalizedFolder;
}

function locateExistingByManifestPath(
    manifestResources: ReadonlyArray<ProjectManifestEntry>,
    manifestResourcePath: string
): ExistingProjectResource {
    const entryIndex = manifestResources.findIndex((entry) => entry.id.path === manifestResourcePath);
    if (entryIndex === -1) {
        throw new Error(`Could not find manifest entry for '${manifestResourcePath}'.`);
    }
    return Object.freeze({
        manifestEntryIndex: entryIndex,
        manifestResourcePath
    });
}

function updateManifestResourcesForAdd(
    manifestDocument: Record<string, unknown>,
    manifestResources: ReadonlyArray<ProjectManifestEntry>,
    context: ProjectResourceContext
): string {
    manifestDocument.resources = [
        ...manifestResources,
        createManifestEntry(context.resourceName, context.resourcePath)
    ];
    return `${Semantic.stringifyProjectMetadataDocument(manifestDocument, context.manifest.absolutePath)}\n`;
}

function updateManifestResourcesForRemove(
    manifestDocument: Record<string, unknown>,
    manifestResources: ReadonlyArray<ProjectManifestEntry>,
    existingResource: ExistingProjectResource,
    manifest: ResolvedProjectManifest
): string {
    manifestDocument.resources = manifestResources.filter((_, index) => index !== existingResource.manifestEntryIndex);
    return `${Semantic.stringifyProjectMetadataDocument(manifestDocument, manifest.absolutePath)}\n`;
}

function collectSpriteFallbackDeletionPaths(
    resourceName: string,
    resourceDirectory: string,
    metadataDocument: Record<string, unknown>
): Array<string> {
    const deletionPaths = new Set<string>([`${resourceDirectory}/${resourceName}.yy`]);
    const frameEntries = Core.asArray(metadataDocument.frames);
    const layerEntries = Core.asArray(metadataDocument.layers);

    for (const frameEntry of frameEntries) {
        const frameName = Core.getNonEmptyString((frameEntry as { name?: unknown })?.name);
        if (!frameName) {
            continue;
        }

        deletionPaths.add(`${resourceDirectory}/${frameName}.png`);

        for (const layerEntry of layerEntries) {
            const layerName = Core.getNonEmptyString((layerEntry as { name?: unknown })?.name);
            if (!layerName) {
                continue;
            }

            deletionPaths.add(`${resourceDirectory}/layers/${frameName}/${layerName}.png`);
        }
    }

    return [...deletionPaths];
}

function collectFallbackDeletionPaths(
    context: ProjectResourceContext,
    metadataDocument: Record<string, unknown>
): { deletedPaths: Array<string>; warnings: Array<string> } {
    const resourceDirectory = path.posix.dirname(context.resourcePath);
    const warnings: Array<string> = [];

    switch (context.resourceKind) {
        case ProjectResourceKind.SCRIPT: {
            return {
                deletedPaths: [context.resourcePath, `${resourceDirectory}/${context.resourceName}.gml`],
                warnings
            };
        }
        case ProjectResourceKind.FONT: {
            return {
                deletedPaths: [context.resourcePath, `${resourceDirectory}/${context.resourceName}.png`],
                warnings
            };
        }
        case ProjectResourceKind.SPRITE: {
            return {
                deletedPaths: collectSpriteFallbackDeletionPaths(
                    context.resourceName,
                    resourceDirectory,
                    metadataDocument
                ),
                warnings: [
                    "Preserved the containing sprite directory because it does not use the canonical '<kind>/<name>/' layout."
                ]
            };
        }
        case ProjectResourceKind.ROOM: {
            const creationCodeFile = Core.getNonEmptyString(metadataDocument.creationCodeFile);
            const deletionPaths = [context.resourcePath];
            if (creationCodeFile) {
                deletionPaths.push(path.posix.join(resourceDirectory, creationCodeFile));
            }

            return {
                deletedPaths: deletionPaths,
                warnings: [
                    "Preserved the containing room directory because it does not use the canonical '<kind>/<name>/' layout."
                ]
            };
        }
        case ProjectResourceKind.OBJECT: {
            return {
                deletedPaths: [context.resourcePath],
                warnings: [
                    "Preserved object event source files because the metadata directory does not use the canonical '<kind>/<name>/' layout."
                ]
            };
        }
    }
}

async function collectDeletionPlan(
    context: ProjectResourceContext,
    resourceAbsolutePath: string
): Promise<{ deletedPaths: Array<string>; warnings: Array<string> }> {
    const resourceDirectoryAbsolutePath = path.dirname(resourceAbsolutePath);
    const resourceDirectoryName = path.posix.basename(path.posix.dirname(context.resourcePath));
    if (resourceDirectoryName === context.resourceName) {
        return {
            deletedPaths: [path.posix.dirname(context.resourcePath)],
            warnings: []
        };
    }

    if (!(await pathExists(resourceAbsolutePath))) {
        return {
            deletedPaths: [context.resourcePath],
            warnings: [
                `Metadata file '${context.resourcePath}' no longer exists on disk; only the manifest entry will be removed.`
            ]
        };
    }

    const metadataDocument = await readProjectMetadataDocument(resourceAbsolutePath);
    const fallbackDeletion = collectFallbackDeletionPaths(context, metadataDocument);

    if (fallbackDeletion.deletedPaths.length === 1 && fallbackDeletion.deletedPaths[0] === context.resourcePath) {
        const siblingEntries = await readdir(resourceDirectoryAbsolutePath).catch(() => []);
        if (siblingEntries.length > 1) {
            fallbackDeletion.warnings.push(
                `Preserved sibling files in '${path.posix.dirname(context.resourcePath)}' because the directory appears to be shared.`
            );
        }
    }

    return fallbackDeletion;
}

async function deleteProjectPaths(projectRoot: string, relativePaths: ReadonlyArray<string>): Promise<void> {
    await Core.runSequentially(relativePaths, async (relativePath) => {
        await rm(toAbsoluteProjectPath(projectRoot, relativePath), {
            force: true,
            recursive: true
        });
    });
}

/**
 * Add a new GameMaker resource skeleton to a project's `.yyp` manifest.
 *
 * @param request - Resource creation request.
 * @returns Summary of manifest updates and created files.
 */
export async function addProjectResource(request: AddProjectResourceRequest): Promise<ProjectResourceMutationResult> {
    const resourceKind = requireProjectResourceKind(request.resourceKind, "addProjectResource");
    assertValidProjectResourceName(request.resourceName);

    const projectRoot = path.resolve(request.projectRoot);
    const manifest = await resolveProjectManifest(projectRoot);
    const context = createProjectResourceContext(projectRoot, resourceKind, request.resourceName, manifest);
    const manifestDocument = await readProjectMetadataDocument(manifest.absolutePath);
    const manifestResources = getManifestResources(manifestDocument);

    if (locateExistingProjectResource(manifestResources, context) !== null) {
        throw new Error(
            `A ${context.resourceKind} resource named '${context.resourceName}' already exists in ${context.manifest.relativePath}.`
        );
    }

    const resourceAbsolutePath = toAbsoluteProjectPath(projectRoot, context.resourcePath);
    if (await pathExists(resourceAbsolutePath)) {
        throw new Error(`Resource metadata path '${context.resourcePath}' already exists on disk.`);
    }

    const metadataDocument = createResourceMetadataDocument(context);
    const resourceArtifacts = createResourceArtifacts(context, metadataDocument);
    const manifestContent = updateManifestResourcesForAdd(manifestDocument, manifestResources, context);
    const writtenPaths = [context.manifest.relativePath, ...resourceArtifacts.map((artifact) => artifact.path)];
    const dryRun = request.dryRun !== false;

    if (!dryRun) {
        await writeProjectArtifacts(projectRoot, resourceArtifacts);
        await writeFile(manifest.absolutePath, manifestContent, "utf8");
    }

    return {
        action: "add",
        deletedPaths: [],
        dryRun,
        manifestPath: manifest.relativePath,
        resourceKind: context.resourceKind,
        resourceName: context.resourceName,
        resourcePath: context.resourcePath,
        warnings: [],
        writtenPaths
    };
}

/**
 * Remove an existing GameMaker resource from the project manifest and delete its
 * canonical on-disk artifacts when present.
 *
 * @param request - Resource removal request.
 * @returns Summary of manifest updates and deleted files/directories.
 */
export async function removeProjectResource(
    request: RemoveProjectResourceRequest
): Promise<ProjectResourceMutationResult> {
    const resourceKind = requireProjectResourceKind(request.resourceKind, "removeProjectResource");
    assertValidProjectResourceName(request.resourceName);

    const projectRoot = path.resolve(request.projectRoot);
    const manifest = await resolveProjectManifest(projectRoot);
    const context = createProjectResourceContext(projectRoot, resourceKind, request.resourceName, manifest);
    const manifestDocument = await readProjectMetadataDocument(manifest.absolutePath);
    const manifestResources = getManifestResources(manifestDocument);
    const existingResource = locateExistingProjectResource(manifestResources, context);

    if (existingResource === null) {
        throw new Error(
            `Could not find a ${context.resourceKind} resource named '${context.resourceName}' in ${context.manifest.relativePath}.`
        );
    }

    const resourcePath = existingResource.manifestResourcePath;
    const removalContext = Object.freeze({
        ...context,
        resourcePath
    });
    const manifestContent = updateManifestResourcesForRemove(
        manifestDocument,
        manifestResources,
        existingResource,
        manifest
    );
    const deletionPlan = await collectDeletionPlan(removalContext, toAbsoluteProjectPath(projectRoot, resourcePath));
    const dryRun = request.dryRun !== false;

    if (!dryRun) {
        await writeFile(manifest.absolutePath, manifestContent, "utf8");
        await deleteProjectPaths(projectRoot, deletionPlan.deletedPaths);
    }

    return {
        action: "remove",
        deletedPaths: deletionPlan.deletedPaths,
        dryRun,
        manifestPath: manifest.relativePath,
        resourceKind: removalContext.resourceKind,
        resourceName: removalContext.resourceName,
        resourcePath,
        warnings: deletionPlan.warnings,
        writtenPaths: [manifest.relativePath]
    };
}

/**
 * Rename an existing GameMaker resource in the project manifest and on disk.
 *
 * @param request - Resource rename request.
 * @returns Summary of manifest updates and file moves.
 */
export async function renameProjectResource(
    request: RenameProjectResourceRequest
): Promise<ProjectResourceMutationResult> {
    const resourceKind = requireProjectResourceKind(request.resourceKind, "renameProjectResource");
    assertValidProjectResourceName(request.resourceName);
    assertValidProjectResourceName(request.newResourceName);
    if (request.resourceName === request.newResourceName) {
        throw new Error("The new resource name must differ from the current resource name.");
    }

    const projectRoot = path.resolve(request.projectRoot);
    const manifest = await resolveProjectManifest(projectRoot);
    const sourceContext = createProjectResourceContext(projectRoot, resourceKind, request.resourceName, manifest);
    const manifestDocument = await readProjectMetadataDocument(manifest.absolutePath);
    const manifestResources = getManifestResources(manifestDocument);
    const existingResource = locateExistingProjectResource(manifestResources, sourceContext);
    if (existingResource === null) {
        throw new Error(
            `Could not find a ${sourceContext.resourceKind} resource named '${sourceContext.resourceName}' in ${sourceContext.manifest.relativePath}.`
        );
    }

    const nextResourcePath = createRenamedResourcePath(
        existingResource.manifestResourcePath,
        request.resourceName,
        request.newResourceName
    );
    const destinationContext = Object.freeze({
        ...sourceContext,
        resourceName: request.newResourceName,
        resourcePath: nextResourcePath
    });
    if (locateExistingProjectResource(manifestResources, destinationContext) !== null) {
        throw new Error(
            `A ${destinationContext.resourceKind} resource named '${destinationContext.resourceName}' already exists in ${destinationContext.manifest.relativePath}.`
        );
    }

    const sourceMetadataAbsolutePath = toAbsoluteProjectPath(projectRoot, existingResource.manifestResourcePath);
    if (!(await pathExists(sourceMetadataAbsolutePath))) {
        throw new Error(`Resource metadata path '${existingResource.manifestResourcePath}' does not exist on disk.`);
    }
    const destinationMetadataAbsolutePath = toAbsoluteProjectPath(projectRoot, nextResourcePath);
    if (await pathExists(destinationMetadataAbsolutePath)) {
        throw new Error(`Resource metadata path '${nextResourcePath}' already exists on disk.`);
    }

    const metadataDocument = await readProjectMetadataDocument(sourceMetadataAbsolutePath);
    const updatedMetadata = updateMetadataNameAndPath(
        metadataDocument,
        request.newResourceName,
        existingResource.manifestResourcePath,
        nextResourcePath
    );
    const sourceDirectoryPath = path.posix.dirname(existingResource.manifestResourcePath);
    const destinationDirectoryPath = path.posix.dirname(nextResourcePath);
    const sourceDirectoryAbsolutePath = toAbsoluteProjectPath(projectRoot, sourceDirectoryPath);
    const destinationDirectoryAbsolutePath = toAbsoluteProjectPath(projectRoot, destinationDirectoryPath);

    const updatedManifestResources = [...manifestResources];
    updatedManifestResources[existingResource.manifestEntryIndex] = createManifestEntry(
        request.newResourceName,
        nextResourcePath
    );
    manifestDocument.resources = updatedManifestResources;
    const manifestContent = `${Semantic.stringifyProjectMetadataDocument(manifestDocument, manifest.absolutePath)}\n`;
    const dryRun = request.dryRun !== false;

    if (!dryRun) {
        if (isCanonicalResourceDirectory(request.resourceName, existingResource.manifestResourcePath)) {
            await mkdir(path.dirname(destinationDirectoryAbsolutePath), { recursive: true });
            await rm(destinationDirectoryAbsolutePath, { recursive: true, force: true });
            await mkdir(destinationDirectoryAbsolutePath, { recursive: true });
            await copyDirectoryRecursive(sourceDirectoryAbsolutePath, destinationDirectoryAbsolutePath);
            await rm(sourceDirectoryAbsolutePath, { recursive: true, force: true });
            await removeIfExists(path.join(destinationDirectoryAbsolutePath, `${request.resourceName}.yy`));
            if (resourceKind === ProjectResourceKind.SCRIPT) {
                await renameFileIfExists(
                    path.join(destinationDirectoryAbsolutePath, `${request.resourceName}.gml`),
                    path.join(destinationDirectoryAbsolutePath, `${request.newResourceName}.gml`)
                );
            }
            if (resourceKind === ProjectResourceKind.FONT) {
                await renameFileIfExists(
                    path.join(destinationDirectoryAbsolutePath, `${request.resourceName}.png`),
                    path.join(destinationDirectoryAbsolutePath, `${request.newResourceName}.png`)
                );
            }
        } else {
            await mkdir(path.dirname(destinationMetadataAbsolutePath), { recursive: true });
            await writeFile(destinationMetadataAbsolutePath, await readFile(sourceMetadataAbsolutePath));
            await rm(sourceMetadataAbsolutePath, { force: true });
            if (resourceKind === ProjectResourceKind.SCRIPT) {
                const sourceGmlPath = path.join(
                    path.dirname(sourceMetadataAbsolutePath),
                    `${request.resourceName}.gml`
                );
                const destinationGmlPath = path.join(
                    path.dirname(destinationMetadataAbsolutePath),
                    `${request.newResourceName}.gml`
                );
                if (await pathExists(sourceGmlPath)) {
                    await writeFile(destinationGmlPath, await readFile(sourceGmlPath, "utf8"), "utf8");
                    await rm(sourceGmlPath, { force: true });
                }
            }
        }

        await writeFile(
            destinationMetadataAbsolutePath,
            `${Semantic.stringifyProjectMetadataDocument(updatedMetadata, destinationMetadataAbsolutePath)}\n`,
            "utf8"
        );
        await writeFile(manifest.absolutePath, manifestContent, "utf8");
    }

    return {
        action: "rename",
        deletedPaths: isCanonicalResourceDirectory(request.resourceName, existingResource.manifestResourcePath)
            ? [sourceDirectoryPath]
            : [existingResource.manifestResourcePath],
        dryRun,
        manifestPath: manifest.relativePath,
        resourceKind: destinationContext.resourceKind,
        resourceName: destinationContext.resourceName,
        resourcePath: nextResourcePath,
        warnings: [],
        writtenPaths: [manifest.relativePath, nextResourcePath]
    };
}

/**
 * Duplicate an existing GameMaker resource.
 *
 * @param request - Resource duplicate request.
 * @returns Summary of manifest updates and written files.
 */
export async function duplicateProjectResource(
    request: DuplicateProjectResourceRequest
): Promise<ProjectResourceMutationResult> {
    const resourceKind = requireProjectResourceKind(request.resourceKind, "duplicateProjectResource");
    assertValidProjectResourceName(request.resourceName);
    assertValidProjectResourceName(request.newResourceName);
    if (request.resourceName === request.newResourceName) {
        throw new Error("The new resource name must differ from the source resource name.");
    }

    const projectRoot = path.resolve(request.projectRoot);
    const manifest = await resolveProjectManifest(projectRoot);
    const sourceContext = createProjectResourceContext(projectRoot, resourceKind, request.resourceName, manifest);
    const destinationContext = createProjectResourceContext(
        projectRoot,
        resourceKind,
        request.newResourceName,
        manifest
    );
    const manifestDocument = await readProjectMetadataDocument(manifest.absolutePath);
    const manifestResources = getManifestResources(manifestDocument);
    const existingResource = locateExistingProjectResource(manifestResources, sourceContext);
    if (existingResource === null) {
        throw new Error(
            `Could not find a ${sourceContext.resourceKind} resource named '${sourceContext.resourceName}' in ${sourceContext.manifest.relativePath}.`
        );
    }
    if (locateExistingProjectResource(manifestResources, destinationContext) !== null) {
        throw new Error(
            `A ${destinationContext.resourceKind} resource named '${destinationContext.resourceName}' already exists in ${destinationContext.manifest.relativePath}.`
        );
    }

    const sourceMetadataAbsolutePath = toAbsoluteProjectPath(projectRoot, existingResource.manifestResourcePath);
    if (!(await pathExists(sourceMetadataAbsolutePath))) {
        throw new Error(`Resource metadata path '${existingResource.manifestResourcePath}' does not exist on disk.`);
    }
    const destinationMetadataAbsolutePath = toAbsoluteProjectPath(projectRoot, destinationContext.resourcePath);
    if (await pathExists(destinationMetadataAbsolutePath)) {
        throw new Error(`Resource metadata path '${destinationContext.resourcePath}' already exists on disk.`);
    }

    const sourceMetadataDocument = await readProjectMetadataDocument(sourceMetadataAbsolutePath);
    const updatedMetadata = updateMetadataNameAndPath(
        sourceMetadataDocument,
        request.newResourceName,
        existingResource.manifestResourcePath,
        destinationContext.resourcePath
    );

    manifestDocument.resources = [
        ...manifestResources,
        createManifestEntry(destinationContext.resourceName, destinationContext.resourcePath)
    ];
    const manifestContent = `${Semantic.stringifyProjectMetadataDocument(manifestDocument, manifest.absolutePath)}\n`;
    const dryRun = request.dryRun !== false;
    const sourceDirectoryPath = path.posix.dirname(existingResource.manifestResourcePath);
    const destinationDirectoryPath = path.posix.dirname(destinationContext.resourcePath);

    if (!dryRun) {
        if (isCanonicalResourceDirectory(request.resourceName, existingResource.manifestResourcePath)) {
            await copyDirectoryRecursive(
                toAbsoluteProjectPath(projectRoot, sourceDirectoryPath),
                toAbsoluteProjectPath(projectRoot, destinationDirectoryPath)
            );
            await removeIfExists(
                path.join(toAbsoluteProjectPath(projectRoot, destinationDirectoryPath), `${request.resourceName}.yy`)
            );
            if (resourceKind === ProjectResourceKind.SCRIPT) {
                await renameFileIfExists(
                    path.join(
                        toAbsoluteProjectPath(projectRoot, destinationDirectoryPath),
                        `${request.resourceName}.gml`
                    ),
                    path.join(
                        toAbsoluteProjectPath(projectRoot, destinationDirectoryPath),
                        `${request.newResourceName}.gml`
                    )
                );
            }
            if (resourceKind === ProjectResourceKind.FONT) {
                await renameFileIfExists(
                    path.join(
                        toAbsoluteProjectPath(projectRoot, destinationDirectoryPath),
                        `${request.resourceName}.png`
                    ),
                    path.join(
                        toAbsoluteProjectPath(projectRoot, destinationDirectoryPath),
                        `${request.newResourceName}.png`
                    )
                );
            }
        } else {
            await mkdir(path.dirname(destinationMetadataAbsolutePath), { recursive: true });
        }

        await writeFile(
            destinationMetadataAbsolutePath,
            `${Semantic.stringifyProjectMetadataDocument(updatedMetadata, destinationMetadataAbsolutePath)}\n`,
            "utf8"
        );
        if (resourceKind === ProjectResourceKind.SCRIPT) {
            const sourceScriptPath = path.join(path.dirname(sourceMetadataAbsolutePath), `${request.resourceName}.gml`);
            const destinationScriptPath = path.join(
                path.dirname(destinationMetadataAbsolutePath),
                `${request.newResourceName}.gml`
            );
            if (await pathExists(sourceScriptPath)) {
                await writeFile(destinationScriptPath, await readFile(sourceScriptPath, "utf8"), "utf8");
            }
        }
        await writeFile(manifest.absolutePath, manifestContent, "utf8");
    }

    return {
        action: "duplicate",
        deletedPaths: [],
        dryRun,
        manifestPath: manifest.relativePath,
        resourceKind: destinationContext.resourceKind,
        resourceName: destinationContext.resourceName,
        resourcePath: destinationContext.resourcePath,
        warnings: [],
        writtenPaths: [manifest.relativePath, destinationContext.resourcePath]
    };
}

/**
 * Move an existing GameMaker resource to a different folder path.
 *
 * @param request - Resource move request.
 * @returns Summary of manifest updates and written/deleted paths.
 */
export async function moveProjectResource(request: MoveProjectResourceRequest): Promise<ProjectResourceMutationResult> {
    const resourceKind = requireProjectResourceKind(request.resourceKind, "moveProjectResource");
    assertValidProjectResourceName(request.resourceName);
    const destinationFolder = validateDestinationFolder(request.destinationFolder);

    const projectRoot = path.resolve(request.projectRoot);
    const manifest = await resolveProjectManifest(projectRoot);
    const sourceContext = createProjectResourceContext(projectRoot, resourceKind, request.resourceName, manifest);
    const manifestDocument = await readProjectMetadataDocument(manifest.absolutePath);
    const manifestResources = getManifestResources(manifestDocument);
    const existingResource = locateExistingProjectResource(manifestResources, sourceContext);
    if (existingResource === null) {
        throw new Error(
            `Could not find a ${sourceContext.resourceKind} resource named '${sourceContext.resourceName}' in ${sourceContext.manifest.relativePath}.`
        );
    }

    const nextResourcePath = path.posix.join(destinationFolder, `${request.resourceName}.yy`);
    if (existingResource.manifestResourcePath === nextResourcePath) {
        throw new Error(`Resource '${request.resourceName}' is already in '${destinationFolder}'.`);
    }
    const destinationMetadataAbsolutePath = toAbsoluteProjectPath(projectRoot, nextResourcePath);
    if (await pathExists(destinationMetadataAbsolutePath)) {
        throw new Error(`Resource metadata path '${nextResourcePath}' already exists on disk.`);
    }

    const sourceMetadataAbsolutePath = toAbsoluteProjectPath(projectRoot, existingResource.manifestResourcePath);
    if (!(await pathExists(sourceMetadataAbsolutePath))) {
        throw new Error(`Resource metadata path '${existingResource.manifestResourcePath}' does not exist on disk.`);
    }
    const sourceMetadataDocument = await readProjectMetadataDocument(sourceMetadataAbsolutePath);
    const updatedMetadata = updateMetadataNameAndPath(
        sourceMetadataDocument,
        request.resourceName,
        existingResource.manifestResourcePath,
        nextResourcePath
    );

    const existingByPath = locateExistingByManifestPath(manifestResources, existingResource.manifestResourcePath);
    const updatedManifestResources = [...manifestResources];
    updatedManifestResources[existingByPath.manifestEntryIndex] = createManifestEntry(
        request.resourceName,
        nextResourcePath
    );
    manifestDocument.resources = updatedManifestResources;
    const manifestContent = `${Semantic.stringifyProjectMetadataDocument(manifestDocument, manifest.absolutePath)}\n`;
    const dryRun = request.dryRun !== false;
    const sourceDirectoryPath = path.posix.dirname(existingResource.manifestResourcePath);
    const destinationDirectoryPath = path.posix.dirname(nextResourcePath);

    if (!dryRun) {
        if (isCanonicalResourceDirectory(request.resourceName, existingResource.manifestResourcePath)) {
            await mkdir(path.dirname(destinationMetadataAbsolutePath), { recursive: true });
            await rm(toAbsoluteProjectPath(projectRoot, destinationDirectoryPath), { force: true, recursive: true });
            await copyDirectoryRecursive(
                toAbsoluteProjectPath(projectRoot, sourceDirectoryPath),
                toAbsoluteProjectPath(projectRoot, destinationDirectoryPath)
            );
            await rm(toAbsoluteProjectPath(projectRoot, sourceDirectoryPath), { force: true, recursive: true });
            await removeIfExists(
                path.join(toAbsoluteProjectPath(projectRoot, destinationDirectoryPath), `${request.resourceName}.yy`)
            );
        } else {
            await mkdir(path.dirname(destinationMetadataAbsolutePath), { recursive: true });
            await writeFile(destinationMetadataAbsolutePath, await readFile(sourceMetadataAbsolutePath));
            await rm(sourceMetadataAbsolutePath, { force: true });
            if (resourceKind === ProjectResourceKind.SCRIPT) {
                const sourceScriptPath = path.join(
                    path.dirname(sourceMetadataAbsolutePath),
                    `${request.resourceName}.gml`
                );
                const destinationScriptPath = path.join(
                    path.dirname(destinationMetadataAbsolutePath),
                    `${request.resourceName}.gml`
                );
                if (await pathExists(sourceScriptPath)) {
                    await writeFile(destinationScriptPath, await readFile(sourceScriptPath, "utf8"), "utf8");
                    await rm(sourceScriptPath, { force: true });
                }
            }
        }
        await writeFile(
            destinationMetadataAbsolutePath,
            `${Semantic.stringifyProjectMetadataDocument(updatedMetadata, destinationMetadataAbsolutePath)}\n`,
            "utf8"
        );
        await writeFile(manifest.absolutePath, manifestContent, "utf8");
    }

    return {
        action: "move",
        deletedPaths: [sourceDirectoryPath],
        dryRun,
        manifestPath: manifest.relativePath,
        resourceKind,
        resourceName: request.resourceName,
        resourcePath: nextResourcePath,
        warnings: [],
        writtenPaths: [manifest.relativePath, nextResourcePath]
    };
}
