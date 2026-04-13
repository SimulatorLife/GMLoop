import path from "node:path";

import { Core } from "@gmloop/core";

import {
    getProjectMetadataValueAtPath,
    parseProjectMetadataDocumentForMutation,
    readProjectMetadataDocumentForMutationFromFile,
    stringifyProjectMetadataDocument,
    updateProjectMetadataReferenceByPath,
    writeProjectMetadataDocumentToFile
} from "../../project-metadata/index.js";
import { DEFAULT_WRITE_ACCESS_MODE, defaultIdentifierCaseFsFacade as defaultFsFacade } from "../fs-facade.js";

type IdentifierCaseProjectIndex = {
    projectRoot?: string | null;
};

type AssetRenameExecutorLogger = {
    warn?: (message: string) => void;
};

type AssetRenameExecutorOptions = {
    projectIndex?: IdentifierCaseProjectIndex | null;
    fsFacade?: typeof defaultFsFacade | null;
    logger?: AssetRenameExecutorLogger | null;
};

const DEFAULT_WRITE_ACCESS_ARGS = DEFAULT_WRITE_ACCESS_MODE === undefined ? [] : [DEFAULT_WRITE_ACCESS_MODE];

function tryAccess(fsFacade, method, targetPath, ...args) {
    if (!targetPath || !fsFacade) {
        return false;
    }

    const fn = fsFacade[method];
    if (typeof fn !== "function") {
        return false;
    }

    try {
        const result = fn.call(fsFacade, targetPath, ...args);
        return method === "existsSync" ? Boolean(result) : true;
    } catch (error) {
        if (Core.isErrorWithCode(error, "ENOENT")) {
            return false;
        }
        throw error;
    }
}

function resolveAbsolutePath(projectRoot, relativePath) {
    if (!relativePath) {
        return projectRoot;
    }

    if (path.isAbsolute(relativePath)) {
        return relativePath;
    }

    const systemRelative = Core.fromPosixPath(relativePath);
    return path.join(projectRoot, systemRelative);
}

function readJsonFile(fsFacade, absolutePath, cache, preferYyFileIo = false) {
    if (cache && cache.has(absolutePath)) {
        return cache.get(absolutePath);
    }

    const resourceJson = preferYyFileIo
        ? readProjectMetadataDocumentForMutationFromFile(absolutePath).document
        : parseProjectMetadataDocumentForMutation(fsFacade.readFileSync(absolutePath, "utf8"), absolutePath).document;
    if (cache) {
        cache.set(absolutePath, resourceJson);
    }
    return resourceJson;
}

function getObjectAtPath(json, propertyPath) {
    if (!Core.isObjectLike(json)) {
        return null;
    }

    return getProjectMetadataValueAtPath(json, propertyPath ?? "");
}

function updateReferenceObject(json, propertyPath, newResourcePath, newName) {
    if (!Core.isObjectLike(json)) {
        return false;
    }

    return updateProjectMetadataReferenceByPath({
        document: json,
        propertyPath: Core.getNonEmptyString(propertyPath) ?? "",
        newResourcePath: Core.getNonEmptyString(newResourcePath) ?? null,
        newName: Core.getNonEmptyString(newName) ?? null
    });
}

function hasWriteAccess(fsFacade, targetPath, probeMethod) {
    if (tryAccess(fsFacade, "accessSync", targetPath, ...DEFAULT_WRITE_ACCESS_ARGS)) {
        return true;
    }

    return tryAccess(fsFacade, probeMethod, targetPath);
}
function ensureWritableDirectory(fsFacade, directoryPath) {
    if (!directoryPath) {
        return;
    }

    if (hasWriteAccess(fsFacade, directoryPath, "existsSync")) {
        return;
    }

    if (typeof fsFacade.mkdirSync === "function") {
        fsFacade.mkdirSync(directoryPath);
    }
}

function ensureWritableFile(fsFacade, filePath) {
    if (hasWriteAccess(fsFacade, filePath, "statSync")) {
        return;
    }

    ensureWritableDirectory(fsFacade, path.dirname(filePath));
}

export function createAssetRenameExecutor({
    projectIndex,
    fsFacade = null,
    logger = null
}: AssetRenameExecutorOptions = {}) {
    if (!Core.isObjectLike(projectIndex) || typeof projectIndex.projectRoot !== "string") {
        return {
            queueRename() {
                return false;
            },
            commit() {
                return { writes: [], renames: [] };
            }
        };
    }

    const effectiveFs = fsFacade ? { ...defaultFsFacade, ...fsFacade } : defaultFsFacade;
    const preferYyFileIo = fsFacade === null;
    const projectRoot = projectIndex.projectRoot;
    const jsonCache = new Map();
    const pendingWrites = new Map();
    const renameActions = [];
    // Release per-commit caches to avoid retaining large JSON blobs across
    // multiple rename batches in long-lived editor sessions.
    const resetCaches = () => {
        jsonCache.clear();
        pendingWrites.clear();
        renameActions.length = 0;
    };

    return {
        queueRename(rename) {
            if (
                !Core.isObjectLike(rename) ||
                !Core.isNonEmptyString(rename.resourcePath) ||
                !Core.isNonEmptyString(rename.toName)
            ) {
                return false;
            }

            const resourceAbsolute = resolveAbsolutePath(projectRoot, rename.resourcePath);
            const resourceJson = readJsonFile(effectiveFs, resourceAbsolute, jsonCache, preferYyFileIo);

            if (!Core.isObjectLike(resourceJson)) {
                throw new TypeError(`Unable to parse resource metadata at '${rename.resourcePath}'.`);
            }

            let resourceChanged = false;
            if (resourceJson.name !== rename.toName) {
                resourceJson.name = rename.toName;
                resourceChanged = true;
            }

            if (
                Core.isNonEmptyString(rename.newResourcePath) &&
                Object.hasOwn(resourceJson, "resourcePath") &&
                resourceJson.resourcePath !== rename.newResourcePath
            ) {
                resourceJson.resourcePath = rename.newResourcePath;
                resourceChanged = true;
            }

            if (resourceChanged) {
                pendingWrites.set(resourceAbsolute, resourceJson);
            }

            const groupedReferences = new Map();
            for (const mutation of rename.referenceMutations ?? []) {
                if (!Core.isObjectLike(mutation) || !Core.isNonEmptyString(mutation.filePath)) {
                    continue;
                }
                const entries = Core.getOrCreateMapEntry(groupedReferences, mutation.filePath, () => []);
                entries.push(mutation);
            }

            for (const [filePath, mutations] of groupedReferences.entries()) {
                const absolutePath = resolveAbsolutePath(projectRoot, filePath);
                let targetJson;
                try {
                    targetJson = readJsonFile(effectiveFs, absolutePath, jsonCache, preferYyFileIo);
                } catch (error) {
                    if (logger && typeof logger.warn === "function") {
                        const message = Core.getErrorMessageOrFallback(error);
                        logger.warn(`Skipping asset reference update for '${filePath}': ${message}`);
                    }
                    continue;
                }

                if (!Core.isObjectLike(targetJson)) {
                    continue;
                }

                let updated = false;
                for (const mutation of mutations) {
                    const changed = updateReferenceObject(
                        targetJson,
                        mutation.propertyPath,
                        rename.newResourcePath,
                        rename.toName
                    );
                    if (changed) {
                        updated = true;
                    }
                }

                if (updated) {
                    pendingWrites.set(absolutePath, targetJson);
                }
            }

            const newResourceAbsolute = resolveAbsolutePath(projectRoot, rename.newResourcePath);

            if (newResourceAbsolute !== resourceAbsolute) {
                renameActions.push({
                    from: resourceAbsolute,
                    to: newResourceAbsolute
                });
            }

            for (const gmlRename of rename.gmlRenames ?? []) {
                if (
                    !Core.isObjectLike(gmlRename) ||
                    !Core.isNonEmptyString(gmlRename.from) ||
                    !Core.isNonEmptyString(gmlRename.to)
                ) {
                    continue;
                }

                const fromAbsolute = resolveAbsolutePath(projectRoot, gmlRename.from);
                const toAbsolute = resolveAbsolutePath(projectRoot, gmlRename.to);

                if (fromAbsolute === toAbsolute) {
                    continue;
                }

                renameActions.push({ from: fromAbsolute, to: toAbsolute });
            }

            return true;
        },

        commit() {
            const writeActions = [...pendingWrites.entries()].map(([filePath, jsonData]) => ({
                filePath,
                jsonData,
                contents: stringifyProjectMetadataDocument(jsonData, filePath)
            }));

            if (writeActions.length === 0 && renameActions.length === 0) {
                resetCaches();
                return { writes: [], renames: [] };
            }

            for (const action of writeActions) {
                ensureWritableFile(effectiveFs, action.filePath);
            }

            for (const action of renameActions) {
                ensureWritableFile(effectiveFs, action.from);
                ensureWritableDirectory(effectiveFs, path.dirname(action.to));
                if (typeof effectiveFs.existsSync === "function" && effectiveFs.existsSync(action.to)) {
                    throw new Error(`Cannot rename '${action.from}' to existing path '${action.to}'.`);
                }
            }

            for (const action of writeActions) {
                ensureWritableDirectory(effectiveFs, path.dirname(action.filePath));
                if (preferYyFileIo) {
                    writeProjectMetadataDocumentToFile(action.filePath, action.jsonData);
                    continue;
                }

                effectiveFs.writeFileSync(action.filePath, action.contents);
            }

            for (const action of renameActions) {
                ensureWritableDirectory(effectiveFs, path.dirname(action.to));
                effectiveFs.renameSync(action.from, action.to);
            }

            const result = { writes: writeActions, renames: [...renameActions] };
            resetCaches();
            return result;
        }
    };
}

export const __private__: any = {
    defaultFsFacade,
    fromPosixPath: Core.fromPosixPath,
    resolveAbsolutePath,
    readJsonFile,
    getObjectAtPath,
    updateReferenceObject,
    tryAccess,
    ensureWritableFile,
    ensureWritableDirectory
};
