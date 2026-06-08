import { Core } from "@gmloop/core";

import { createProjectIndexAbortGuard } from "../project-index/abort-guard.js";
import type { ProjectIndexFsFacade } from "../project-index/fs-facade.js";

export interface MetricsCacheTools {
    caches?: {
        recordHit: (cacheName: string) => void;
        recordMiss: (cacheName: string) => void;
        recordStale: (cacheName: string) => void;
        recordMetric: (cacheName: string, key: string, amount?: number) => void;
    };
}

const GML_IDENTIFIER_FILE_PATH = Core.getGmlIdentifierMetadataPath();

let cachedBuiltInIdentifiers = null;

interface NormalizedIdentifierEntry {
    name: string;
    type: string;
    descriptor: unknown;
}

function extractBuiltInIdentifierNames(payload: unknown): Set<string> {
    if (!Core.isPlainObject(payload)) {
        throw new TypeError("Built-in identifier metadata must be an object payload.");
    }

    const { identifiers } = payload as { identifiers?: unknown };
    if (!Core.isPlainObject(identifiers)) {
        throw new TypeError("Built-in identifier metadata must expose an identifiers object.");
    }

    const entries: NormalizedIdentifierEntry[] = Core.normalizeIdentifierMetadataEntries(payload);
    const names = new Set<string>();

    for (const { name, type } of entries) {
        if (type.length === 0) {
            continue;
        }

        names.add(name);
    }

    return names;
}

function parseBuiltInIdentifierNames(rawContents: string): Set<string> {
    const payload = Core.parseJsonWithContext(rawContents, {
        source: GML_IDENTIFIER_FILE_PATH,
        description: "built-in identifier metadata"
    });

    return extractBuiltInIdentifierNames(payload);
}

function areMtimesEquivalent(cachedMtime: number | null, currentMtime: number | null): boolean {
    if (cachedMtime === currentMtime) {
        return true;
    }

    if (typeof cachedMtime !== "number" || typeof currentMtime !== "number") {
        return false;
    }

    return Core.areNumbersApproximatelyEqual(cachedMtime, currentMtime);
}

export function loadBuiltInIdentifiers(
    fsFacade: Required<
        Pick<ProjectIndexFsFacade, "readFile" | "stat">
    > = Core.defaultFsFacade as Required<ProjectIndexFsFacade>,
    metrics: MetricsCacheTools | null = null,
    options: Record<string, unknown> = {}
) {
    const { fallbackMessage, ...guardOptions } = options ?? {};

    return Promise.resolve().then(() => {
        const { signal, ensureNotAborted } = createProjectIndexAbortGuard(guardOptions, {
            fallbackMessage: fallbackMessage as string | null | undefined
        });

        return Core.getFileMtime(fsFacade, GML_IDENTIFIER_FILE_PATH, { signal }).then((currentMtime) => {
            ensureNotAborted();
            const cached = cachedBuiltInIdentifiers;
            const cachedMtime = cached?.metadata?.mtimeMs ?? null;

            if (cached && areMtimesEquivalent(cachedMtime, currentMtime)) {
                metrics?.caches?.recordHit("builtInIdentifiers");
                return cached;
            }

            if (cached) {
                metrics?.caches?.recordStale("builtInIdentifiers");
            } else {
                metrics?.caches?.recordMiss("builtInIdentifiers");
            }

            return fsFacade
                .readFile(GML_IDENTIFIER_FILE_PATH, "utf8")
                .then((rawContents) => {
                    ensureNotAborted();
                    const names = parseBuiltInIdentifierNames(rawContents);
                    const updated = {
                        metadata: { mtimeMs: currentMtime },
                        names
                    };
                    cachedBuiltInIdentifiers = updated;
                    return updated;
                })
                .catch(() => {
                    const updated = {
                        metadata: { mtimeMs: currentMtime },
                        names: new Set<string>()
                    };
                    cachedBuiltInIdentifiers = updated;
                    return updated;
                });
        });
    });
}

export { GML_IDENTIFIER_FILE_PATH as __BUILT_IN_IDENTIFIER_PATH_FOR_TESTS };
export const __loadBuiltInIdentifiersForTests = loadBuiltInIdentifiers;
