/**
 * Built-in GML identifier metadata loader.
 *
 * Lives in the `symbols` namespace because the cached identifier set is
 * consumed by the SCIP symbol-building path. The module depends on `Core`
 * primitives directly so the `project-index` ↔ `symbols` dependency arrow
 * stays one-way (the `project-index/builder.ts` imports
 * `loadBuiltInIdentifiers` from here).
 */
import { Core, type FsFacade } from "@gmloop/core";

/** Canonical abort message for the built-in identifier loader. The symbols
 * module owns this message because it is the single authority over its own
 * long-running IO; the project-index layer surfaces its own messages
 * independently. */
const LOAD_BUILT_IN_IDENTIFIERS_ABORT_MESSAGE = "Project index build was aborted.";

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
    fsFacade: Required<Pick<FsFacade, "readFile" | "stat">> = Core.defaultFsFacade as Required<FsFacade>,
    metrics: MetricsCacheTools | null = null,
    options: Parameters<typeof Core.createAbortGuard>[0] = {}
) {
    return Promise.resolve().then(() => {
        const { signal, ensureNotAborted } = Core.createAbortGuard(options, {
            fallbackMessage: LOAD_BUILT_IN_IDENTIFIERS_ABORT_MESSAGE
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
