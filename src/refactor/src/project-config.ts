import { listRegisteredCodemods, normalizeRegisteredCodemodConfig } from "./codemod-registry.js";
import {
    assertRefactorConfigPlainObject,
    assertRefactorConfigPlainObjectWithAllowedKeys
} from "./refactor-config-assertions.js";
import type { RefactorCodemodId, RefactorProjectConfig } from "./types.js";

const REFACTOR_CONFIG_KEYS = new Set(["codemods"]);
const REFACTOR_CODEMOD_IDS = new Set<RefactorCodemodId>(listRegisteredCodemods().map((codemod) => codemod.id));

function assignNormalizedCodemodConfigEntry<T extends RefactorCodemodId>(
    codemods: NonNullable<RefactorProjectConfig["codemods"]>,
    codemodId: T,
    value: NonNullable<RefactorProjectConfig["codemods"]>[T]
): void {
    codemods[codemodId] = value;
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
