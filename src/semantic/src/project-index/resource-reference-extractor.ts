import { Core } from "@gmloop/core";

import { type ProjectMetadataSchemaName, resolveProjectMetadataSchemaName } from "../project-metadata/yy-adapter.js";
import { isProjectManifestPath, matchProjectResourceMetadataExtension } from "./constants.js";
import { normalizeProjectResourcePath } from "./path-normalization.js";

type AssetReferenceCandidate = {
    propertyPath: string;
    targetPath: string;
    targetName: string | null;
};

const DEFAULT_REFERENCE_KEYS = Object.freeze(
    new Set<string>([
        "id",
        "Id",
        "roomId",
        "objectId",
        "spriteId",
        "spriteMaskId",
        "parentObjectId",
        "collisionObjectId",
        "pathId",
        "tilesetId",
        "sequenceId",
        "script",
        "scriptId",
        "scriptExecute",
        "creationCodeScript",
        "linkedScript"
    ])
);

const RESOURCE_REFERENCE_KEYS_BY_SCHEMA: Partial<Record<ProjectMetadataSchemaName, ReadonlySet<string>>> =
    Object.freeze({});

function getReferenceKeySet(schemaName: ProjectMetadataSchemaName | null): ReadonlySet<string> {
    return schemaName
        ? (RESOURCE_REFERENCE_KEYS_BY_SCHEMA[schemaName] ?? DEFAULT_REFERENCE_KEYS)
        : DEFAULT_REFERENCE_KEYS;
}

function extractTerminalPropertyName(propertyPath: string): string | null {
    if (!Core.isNonEmptyString(propertyPath)) {
        return null;
    }

    const parts = Core.trimStringEntries(propertyPath.split("."));
    if (parts.length === 0) {
        return null;
    }

    for (let index = parts.length - 1; index >= 0; index -= 1) {
        const segment = parts[index];
        if (!/^\d+$/.test(segment)) {
            return segment;
        }
    }

    return null;
}

function isMetadataReferenceTarget(targetPath: string): boolean {
    return Boolean(matchProjectResourceMetadataExtension(targetPath) || isProjectManifestPath(targetPath));
}

function pushChildNode(
    stack: Array<{ value: Record<string, unknown> | Array<unknown>; path: string }>,
    parentPath: string,
    key: string | number,
    candidate: unknown
) {
    if (!Core.isObjectLike(candidate)) {
        return;
    }

    const childPath = parentPath ? `${parentPath}.${key}` : String(key);
    const childValue = candidate as Record<string, unknown> | Array<unknown>;
    stack.push({
        value: childValue,
        path: childPath
    });
}

function pushAssetReferenceCandidate(
    candidates: Array<AssetReferenceCandidate>,
    propertyPath: string,
    targetPath: unknown,
    targetName: unknown = null
) {
    if (!Core.isNonEmptyString(propertyPath) || !Core.isNonEmptyString(targetPath)) {
        return;
    }

    candidates.push({
        propertyPath,
        targetPath,
        targetName: Core.getNonEmptyString(targetName)
    });
}

function collectProjectManifestReferenceCandidates(root: Record<string, unknown>): Array<AssetReferenceCandidate> {
    const collected: Array<AssetReferenceCandidate> = [];

    const resources = root.resources;
    if (Array.isArray(resources)) {
        for (const [index, entry] of resources.entries()) {
            if (!Core.isObjectLike(entry) || !Core.isObjectLike(entry.id)) {
                continue;
            }

            pushAssetReferenceCandidate(collected, `resources.${index}.id`, entry.id.path, entry.id.name);
        }
    }

    const roomOrderNodes = root.RoomOrderNodes;
    if (Array.isArray(roomOrderNodes)) {
        for (const [index, node] of roomOrderNodes.entries()) {
            if (!Core.isObjectLike(node) || !Core.isObjectLike(node.roomId)) {
                continue;
            }

            pushAssetReferenceCandidate(
                collected,
                `RoomOrderNodes.${index}.roomId`,
                node.roomId.path,
                node.roomId.name
            );
        }
    }

    const folders = root.Folders;
    if (Array.isArray(folders)) {
        for (const [index, folder] of folders.entries()) {
            if (!Core.isObjectLike(folder)) {
                continue;
            }

            pushAssetReferenceCandidate(collected, `Folders.${index}.folderPath`, folder.folderPath, folder.name);
        }
    }

    const options = root.Options;
    if (Array.isArray(options)) {
        for (const [index, option] of options.entries()) {
            if (!Core.isObjectLike(option)) {
                continue;
            }

            pushAssetReferenceCandidate(collected, `Options.${index}.path`, option.path, option.name);
        }
    }

    return collected;
}

function collectAssetReferenceCandidates(
    root: Record<string, unknown>,
    schemaName: ProjectMetadataSchemaName | null
): Array<AssetReferenceCandidate> {
    const acceptedReferenceKeys = getReferenceKeySet(schemaName);
    const collected: Array<AssetReferenceCandidate> = [];
    const stack: Array<{ value: Record<string, unknown> | Array<unknown>; path: string }> = [{ value: root, path: "" }];

    while (stack.length > 0) {
        const current = stack.pop();
        if (!current) {
            continue;
        }

        const { value, path: nodePath } = current;

        if (Array.isArray(value)) {
            for (let index = value.length - 1; index >= 0; index -= 1) {
                pushChildNode(stack, nodePath, index, value[index]);
            }
            continue;
        }

        if (typeof value.path === "string") {
            const referenceKey = extractTerminalPropertyName(nodePath);
            if (referenceKey && acceptedReferenceKeys.has(referenceKey)) {
                collected.push({
                    propertyPath: nodePath,
                    targetPath: value.path,
                    targetName: Core.getNonEmptyString(value.name)
                });
            }
        }

        const entries = Object.entries(value);
        for (let i = entries.length - 1; i >= 0; i -= 1) {
            const [key, child] = entries[i];
            pushChildNode(stack, nodePath, key, child);
        }
    }

    return collected;
}

/**
 * Extract resource-to-resource metadata references from a parsed .yy/.yyp document.
 *
 * Project manifest files (.yyp) are handled via a dedicated collector that
 * extracts references from top-level arrays (resources, RoomOrderNodes, Options,
 * Folders) using their structural shape rather than the generic schema-driven
 * traversal. The @bscotch/yy "project" schema is intentionally avoided for
 * `.yyp` files to prevent data loss, so manifest detection is done by file path.
 */
export function extractAssetReferencesFromMetadataDocument({
    document,
    sourcePath,
    projectRoot
}: {
    document: Record<string, unknown>;
    sourcePath: string;
    projectRoot: string;
}) {
    const collected = isProjectManifestPath(sourcePath)
        ? collectProjectManifestReferenceCandidates(document)
        : collectAssetReferenceCandidates(
              document,
              resolveProjectMetadataSchemaName(sourcePath, document.resourceType)
          );

    return collected
        .map((candidate) => {
            const normalizedTargetPath = normalizeProjectResourcePath(candidate.targetPath, {
                projectRoot
            });

            if (!normalizedTargetPath || !isMetadataReferenceTarget(normalizedTargetPath)) {
                return null;
            }

            return {
                propertyPath: candidate.propertyPath,
                targetPath: normalizedTargetPath,
                targetName: candidate.targetName
            };
        })
        .filter((entry): entry is { propertyPath: string; targetPath: string; targetName: string | null } =>
            Core.isObjectLike(entry)
        );
}
