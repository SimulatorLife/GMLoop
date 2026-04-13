import { Core } from "@gmloop/core";

import { executeNamingConventionCodemod } from "./codemods/naming-convention/index.js";
import { normalizeNamingConventionPolicy } from "./naming-convention-policy.js";
import {
    assertRefactorConfigPlainObject,
    assertRefactorConfigPlainObjectWithAllowedKeys
} from "./refactor-config-assertions.js";
import type {
    CodemodEngine,
    ConfiguredCodemodRunRequest,
    ConfiguredCodemodRunResult,
    ConfiguredCodemodSummary,
    NamingConventionPolicy,
    RefactorCodemodConfigEntry,
    RefactorCodemodConfigMap,
    RefactorCodemodId,
    RefactorProjectConfig,
    RegisteredCodemod,
    RegisteredCodemodSelection
} from "./types.js";

type RegisteredCodemodDefinition<T extends RefactorCodemodId> = {
    id: T;
    description: string;
    requiresSemanticProjectIndex: boolean;
    normalizeConfig: (value: unknown, context: string) => RefactorCodemodConfigEntry<T>;
    execute: (
        engine: CodemodEngine,
        request: ConfiguredCodemodRunRequest,
        effectiveConfig: RefactorCodemodConfigMap[T]
    ) => Promise<ConfiguredCodemodExecutionResult>;
};

type RegisteredCodemodDefinitions = {
    [T in RefactorCodemodId]: RegisteredCodemodDefinition<T>;
};

type ConfiguredCodemodExecutionResult = {
    appliedFiles: Map<string, string>;
    summary: ConfiguredCodemodSummary;
};

function isNullableString(value: unknown): value is string | null {
    return typeof value === "string" || value === null;
}

const GLOBALVAR_TO_GLOBAL_ALLOWED_KEYS = new Set(["excludeNames"]);

function normalizeGlobalvarToGlobalConfig(
    value: unknown,
    context: string
): RefactorCodemodConfigEntry<"globalvarToGlobal"> {
    if (value === false) {
        return false;
    }

    const object = assertRefactorConfigPlainObjectWithAllowedKeys(value, GLOBALVAR_TO_GLOBAL_ALLOWED_KEYS, context);

    if (object.excludeNames === undefined) {
        return {};
    }

    if (!Array.isArray(object.excludeNames)) {
        throw new TypeError(`${context}.excludeNames must be an array of strings`);
    }

    const excludeNames: Array<string> = [];
    for (const [index, entry] of object.excludeNames.entries()) {
        if (typeof entry !== "string") {
            throw new TypeError(`${context}.excludeNames[${String(index)}] must be a string, received ${typeof entry}`);
        }
        excludeNames.push(entry);
    }

    return { excludeNames };
}

const LOOP_LENGTH_HOISTING_ALLOWED_KEYS = new Set(["functionSuffixes"]);

function normalizeLoopLengthHoistingConfig(
    value: unknown,
    context: string
): RefactorCodemodConfigEntry<"loopLengthHoisting"> {
    if (value === false) {
        return false;
    }

    const object = assertRefactorConfigPlainObjectWithAllowedKeys(value, LOOP_LENGTH_HOISTING_ALLOWED_KEYS, context);

    if (object.functionSuffixes === undefined) {
        return {};
    }

    const functionSuffixesObject = assertRefactorConfigPlainObject(
        object.functionSuffixes,
        `${context}.functionSuffixes`
    );
    const functionSuffixes: Record<string, string | null> = {};

    for (const [functionName, suffixValue] of Object.entries(functionSuffixesObject)) {
        if (isNullableString(suffixValue)) {
            functionSuffixes[functionName] = suffixValue;
            continue;
        }

        throw new TypeError(
            `${context}.functionSuffixes.${functionName} must be a string or null, received ${typeof suffixValue}`
        );
    }

    return {
        functionSuffixes
    };
}

function normalizeNamingConventionConfig(
    value: unknown,
    context: string
): RefactorCodemodConfigEntry<"namingConvention"> {
    if (value === false) {
        return false;
    }
    return normalizeNamingConventionPolicy(value as NamingConventionPolicy | undefined, context);
}

const REGISTERED_CODEMOD_DEFINITIONS: RegisteredCodemodDefinitions = Object.freeze({
    globalvarToGlobal: Object.freeze({
        id: "globalvarToGlobal",
        description:
            "Remove legacy `globalvar` declarations and replace all bare identifier references with `global.<name>`.",
        requiresSemanticProjectIndex: false,
        normalizeConfig: normalizeGlobalvarToGlobalConfig,
        async execute(
            engine: CodemodEngine,
            request: ConfiguredCodemodRunRequest,
            effectiveConfig: RefactorCodemodConfigMap["globalvarToGlobal"]
        ): Promise<ConfiguredCodemodExecutionResult> {
            if (request.gmlFilePaths.length === 0) {
                return {
                    appliedFiles: new Map(),
                    summary: {
                        id: "globalvarToGlobal",
                        changed: false,
                        changedFiles: [],
                        warnings: ["No .gml files were selected for globalvar-to-global migration."],
                        errors: []
                    }
                };
            }

            const result = await engine.executeGlobalvarToGlobalCodemod({
                filePaths: request.gmlFilePaths,
                readFile: request.readFile,
                writeFile: request.writeFile,
                options: effectiveConfig,
                dryRun: request.dryRun
            });

            return {
                appliedFiles: result.applied,
                summary: {
                    id: "globalvarToGlobal",
                    changed: result.changedFiles.length > 0,
                    changedFiles: result.changedFiles.map((entry) => entry.path),
                    warnings: [],
                    errors: []
                }
            };
        }
    }),
    loopLengthHoisting: Object.freeze({
        id: "loopLengthHoisting",
        description: "Hoist repeated loop-length helper calls out of for-loop test expressions.",
        requiresSemanticProjectIndex: false,
        normalizeConfig: normalizeLoopLengthHoistingConfig,
        async execute(
            engine: CodemodEngine,
            request: ConfiguredCodemodRunRequest,
            effectiveConfig: RefactorCodemodConfigMap["loopLengthHoisting"]
        ): Promise<ConfiguredCodemodExecutionResult> {
            if (request.gmlFilePaths.length === 0) {
                return {
                    appliedFiles: new Map(),
                    summary: {
                        id: "loopLengthHoisting",
                        changed: false,
                        changedFiles: [],
                        warnings: ["No .gml files were selected for loop-length hoisting."],
                        errors: []
                    }
                };
            }

            const result = await engine.executeLoopLengthHoistingCodemod({
                filePaths: request.gmlFilePaths,
                readFile: request.readFile,
                writeFile: request.writeFile,
                options: effectiveConfig,
                dryRun: request.dryRun
            });

            return {
                appliedFiles: result.applied,
                summary: {
                    id: "loopLengthHoisting",
                    changed: result.changedFiles.length > 0,
                    changedFiles: result.changedFiles.map((entry) => entry.path),
                    warnings: [],
                    errors: []
                }
            };
        }
    }),
    namingConvention: Object.freeze({
        id: "namingConvention",
        description: "Plan and apply naming-policy-driven renames.",
        requiresSemanticProjectIndex: true,
        normalizeConfig: normalizeNamingConventionConfig,
        async execute(
            engine: CodemodEngine,
            request: ConfiguredCodemodRunRequest,
            effectiveConfig: RefactorCodemodConfigMap["namingConvention"]
        ): Promise<ConfiguredCodemodExecutionResult> {
            const result = await executeNamingConventionCodemod(engine, {
                projectRoot: request.projectRoot,
                config: {
                    codemods: {
                        ...request.config.codemods,
                        namingConvention: effectiveConfig
                    }
                },
                targetPaths: request.targetPaths,
                gmlFilePaths: request.gmlFilePaths,
                applyOptions: {
                    dryRun: request.dryRun,
                    readFile: request.readFile,
                    writeFile: request.writeFile,
                    renameFile: request.renameFile,
                    deleteFile: request.deleteFile
                }
            });

            const changedFiles = new Set<string>(result.applied.keys());
            for (const fileRename of result.plan.workspace.fileRenames) {
                changedFiles.add(fileRename.oldPath);
                changedFiles.add(fileRename.newPath);
            }

            return {
                appliedFiles: result.applied,
                summary: {
                    id: "namingConvention",
                    changed: changedFiles.size > 0,
                    changedFiles: [...changedFiles],
                    warnings: result.plan.warnings,
                    errors: result.plan.errors
                }
            };
        }
    })
});

function getRegisteredCodemodDefinition<T extends RefactorCodemodId>(codemodId: T): RegisteredCodemodDefinition<T> {
    return REGISTERED_CODEMOD_DEFINITIONS[codemodId];
}

/**
 * List codemods that can be configured and executed by the refactor workspace.
 */
export function listRegisteredCodemods(): Array<RegisteredCodemod> {
    return Object.values(REGISTERED_CODEMOD_DEFINITIONS).map((definition) => ({
        id: definition.id,
        description: definition.description
    }));
}

/**
 * Normalize a single codemod config entry from `gmloop.json`.
 */
export function normalizeRegisteredCodemodConfig<T extends RefactorCodemodId>(
    codemodId: T,
    value: unknown,
    context: string
): RefactorCodemodConfigEntry<T> {
    return getRegisteredCodemodDefinition(codemodId).normalizeConfig(value, context);
}

/**
 * Return the codemod ids that require an up-to-date semantic project index
 * before they execute.
 */
export function listSemanticProjectIndexDependentCodemodIds(): Array<RefactorCodemodId> {
    return Object.values(REGISTERED_CODEMOD_DEFINITIONS)
        .filter((definition) => definition.requiresSemanticProjectIndex)
        .map((definition) => definition.id);
}

/**
 * Resolve the configured/selected state for all registered codemods.
 */
export function listConfiguredCodemods(
    config: RefactorProjectConfig,
    selectedCodemods: ReadonlyArray<RefactorCodemodId> = []
): Array<RegisteredCodemodSelection> {
    const selectedCodemodSet = new Set(selectedCodemods);
    const configuredCodemods = config.codemods ?? {};

    return Object.values(REGISTERED_CODEMOD_DEFINITIONS).map((definition) => {
        const configuredEntry = configuredCodemods[definition.id];
        const configured = configuredEntry !== undefined && configuredEntry !== false;
        const selected = selectedCodemodSet.size === 0 || selectedCodemodSet.has(definition.id);

        return {
            id: definition.id,
            description: definition.description,
            configured,
            selected,
            effectiveConfig: configured && selected ? configuredEntry : null
        };
    });
}

/**
 * Execute the configured codemod set in stable registry order.
 */
export async function executeRegisteredCodemods(
    engine: CodemodEngine,
    request: ConfiguredCodemodRunRequest
): Promise<ConfiguredCodemodRunResult> {
    Core.assertArray(request.targetPaths, {
        errorMessage: "executeConfiguredCodemods requires targetPaths"
    });
    Core.assertArray(request.gmlFilePaths, {
        errorMessage: "executeConfiguredCodemods requires gmlFilePaths"
    });

    const configuredSelections = listConfiguredCodemods(request.config, request.onlyCodemods ?? []).filter(
        (selection) => selection.configured && selection.selected && selection.effectiveConfig !== null
    );
    const appliedFiles = new Map<string, string>();
    const summaries: Array<ConfiguredCodemodSummary> = [];

    await Core.runSequentially(configuredSelections, async (selection) => {
        const definition = getRegisteredCodemodDefinition(selection.id);
        const result = await definition.execute(engine, request, selection.effectiveConfig);

        for (const [filePath, content] of result.appliedFiles.entries()) {
            appliedFiles.set(filePath, content);
        }

        summaries.push(result.summary);

        if (request.onAfterCodemod) {
            await request.onAfterCodemod(result.summary, {
                readFile: request.readFile
            });
        }
    });

    return {
        dryRun: request.dryRun ?? true,
        summaries,
        appliedFiles
    };
}
