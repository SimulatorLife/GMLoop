import { listRegisteredCodemods, normalizeRegisteredCodemodConfig } from "./codemod-registry.js";
import {
    assertRefactorConfigPlainObject,
    assertRefactorConfigPlainObjectWithAllowedKeys
} from "./refactor-config-assertions.js";
import type { RefactorCodemodConfigEntry, RefactorCodemodId, RefactorProjectConfig } from "./types.js";

const REFACTOR_CONFIG_KEYS = new Set(["codemods"]);

/**
 * Build the set of registered codemod ids at call time rather than module
 * load time. This ensures project-config normalization remains correct even
 * when dist files are stale or the module is consumed before the full
 * codemod registry has been initialised.
 */
function buildRegisteredCodemodIdSet(): Set<RefactorCodemodId> {
    return new Set<RefactorCodemodId>(listRegisteredCodemods().map((codemod) => codemod.id));
}

function assignNormalizedCodemodConfigEntry<T extends RefactorCodemodId>(
    codemods: NonNullable<RefactorProjectConfig["codemods"]>,
    codemodId: T,
    value: NonNullable<RefactorProjectConfig["codemods"]>[T]
): void {
    codemods[codemodId] = value;
}

/**
 * Normalize and validate the `refactor` section of `gmloop.json`.
 * Returns `null` when the config contains unknown top-level keys, unknown
 * codemod ids, or invalid codemod config, making it suitable for project-open
 * flows where unknown gmloop properties should not crash the UI.
 */
export function normalizeRefactorProjectConfigOrNull(config: unknown): RefactorProjectConfig | null {
    if (config === undefined) {
        return {};
    }

    let object: Record<string, unknown>;
    try {
        object = assertRefactorConfigPlainObjectWithAllowedKeys(
            config,
            REFACTOR_CONFIG_KEYS,
            "gmloop.json refactor config"
        );
    } catch {
        return null;
    }

    const normalized: RefactorProjectConfig = {};

    if (object.codemods !== undefined) {
        let codemodsObject: Record<string, unknown>;
        try {
            codemodsObject = assertRefactorConfigPlainObject(object.codemods, "gmloop.json refactor.codemods");
        } catch {
            return null;
        }
        const codemods: RefactorProjectConfig["codemods"] = {};
        const knownCodemodIds = buildRegisteredCodemodIdSet();

        for (const [rawCodemodId, codemodConfig] of Object.entries(codemodsObject)) {
            if (!knownCodemodIds.has(rawCodemodId as RefactorCodemodId)) {
                return null;
            }

            const codemodId = rawCodemodId as RefactorCodemodId;
            let normalizedEntry: RefactorCodemodConfigEntry<RefactorCodemodId>;
            try {
                normalizedEntry = normalizeRegisteredCodemodConfig(
                    codemodId,
                    codemodConfig,
                    `gmloop.json refactor.codemods.${codemodId}`
                );
            } catch {
                return null;
            }
            assignNormalizedCodemodConfigEntry(codemods, codemodId, normalizedEntry);
        }

        normalized.codemods = codemods;
    }

    return normalized;
}

/**
 * Normalize and validate the `refactor` section of `gmloop.json`.
 */
export function normalizeRefactorProjectConfig(config: unknown): RefactorProjectConfig {
    if (config === undefined) {
        return {};
    }

    const object = assertRefactorConfigPlainObjectWithAllowedKeys(
        config,
        REFACTOR_CONFIG_KEYS,
        "gmloop.json refactor config"
    );

    const normalized: RefactorProjectConfig = {};

    if (object.codemods !== undefined) {
        const codemodsObject = assertRefactorConfigPlainObject(object.codemods, "gmloop.json refactor.codemods");
        const codemods: RefactorProjectConfig["codemods"] = {};
        const REFACTOR_CODEMOD_IDS = buildRegisteredCodemodIdSet();

        for (const [rawCodemodId, codemodConfig] of Object.entries(codemodsObject)) {
            if (!REFACTOR_CODEMOD_IDS.has(rawCodemodId as RefactorCodemodId)) {
                throw new TypeError(`Unknown refactor codemod ${JSON.stringify(rawCodemodId)} in gmloop.json`);
            }

            const codemodId = rawCodemodId as RefactorCodemodId;
            assignNormalizedCodemodConfigEntry(
                codemods,
                codemodId,
                normalizeRegisteredCodemodConfig(codemodId, codemodConfig, `gmloop.json refactor.codemods.${codemodId}`)
            );
        }

        normalized.codemods = codemods;
    }

    return normalized;
}
