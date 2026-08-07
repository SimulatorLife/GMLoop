import path from "node:path";

import { Core } from "@gmloop/core";

import { applyLoopLengthHoistingCodemod } from "./codemods/loop-length-hoisting/index.js";
import { executeNamingConventionCodemod } from "./codemods/naming-convention/index.js";
import { applyRepairArgumentSeparatorsCodemod } from "./codemods/repair-argument-separators/index.js";
import { applyRepairAudioEmitterCreationGuardCodemod } from "./codemods/repair-audio-emitter-creation-guard/repair-audio-emitter-creation-guard-codemod.js";
import { applyRepairEventCallbackOtherCodemod } from "./codemods/repair-event-callback-other/index.js";
import { applyRepairInvalidTexturePointerGuardCodemod } from "./codemods/repair-invalid-texture-pointer-guard/repair-invalid-texture-pointer-guard-codemod.js";
import { applyRepairLogicalNotCodemod } from "./codemods/repair-logical-not/index.js";
import { applyRepairSpriteTextureUvResolutionCodemod } from "./codemods/repair-sprite-texture-uv-resolution/repair-sprite-texture-uv-resolution-codemod.js";
import { applyRepairTexturePrefetchGuardCodemod } from "./codemods/repair-texture-prefetch-guard/repair-texture-prefetch-guard-codemod.js";
import { applyScientificNotationCodemod } from "./codemods/scientific-notation/index.js";
import { normalizeNamingConventionPolicy } from "./naming-convention-policy.js";
import { assertRefactorConfigPlainObjectWithAllowedKeys } from "./refactor-config-assertions.js";
import { SINGLE_FILE_TEXT_CODEMOD_IO_CONCURRENCY_LIMIT } from "./refactor-constants.js";
import type {
    CodemodEngine,
    ConfiguredCodemodRunRequest,
    ConfiguredCodemodRunResult,
    ConfiguredCodemodSummary,
    NamingConventionPolicy,
    PartialSemanticAnalyzer,
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

const EMPTY_ALLOWED_KEYS = new Set<string>();

const GLOBALVAR_TO_GLOBAL_ALLOWED_KEYS = new Set(["excludeNames"]);

function isGmlSourceFilePath(candidatePath: string): boolean {
    return path.extname(candidatePath.trim()).toLowerCase() === ".gml";
}

function normalizeRepairEventCallbackOtherConfig(
    value: unknown,
    context: string
): RefactorCodemodConfigEntry<"repairEventCallbackOther"> {
    if (value === false) {
        return false;
    }
    assertRefactorConfigPlainObjectWithAllowedKeys(value, new Set(["sourcePath"]), context);
    const record = value as { sourcePath?: unknown };
    if (record.sourcePath !== undefined && typeof record.sourcePath !== "string") {
        throw new TypeError(`${context}.sourcePath must be a string path`);
    }
    return { sourcePath: typeof record.sourcePath === "string" ? record.sourcePath : undefined };
}

function normalizeEmptyObjectConfig<
    T extends
        | "scientificNotation"
        | "loopLengthHoisting"
        | "repairLogicalNot"
        | "repairArgumentSeparators"
        | "repairTexturePrefetchGuard"
        | "repairInvalidTexturePointerGuard"
        | "repairAudioEmitterCreationGuard"
        | "repairSpriteTextureUvResolution"
>(value: unknown, context: string): RefactorCodemodConfigEntry<T> {
    if (value === false) {
        return false;
    }
    assertRefactorConfigPlainObjectWithAllowedKeys(value, EMPTY_ALLOWED_KEYS, context);
    return {};
}

async function executeSingleFileTextCodemod(
    engine: CodemodEngine,
    request: ConfiguredCodemodRunRequest,
    codemodId:
        | "scientificNotation"
        | "loopLengthHoisting"
        | "repairLogicalNot"
        | "repairArgumentSeparators"
        | "repairTexturePrefetchGuard"
        | "repairInvalidTexturePointerGuard"
        | "repairAudioEmitterCreationGuard"
        | "repairSpriteTextureUvResolution"
        | "repairEventCallbackOther",
    warningMessage: string,
    transform: (
        sourceText: string,
        semantic: PartialSemanticAnalyzer | null
    ) =>
        Promise<Readonly<{ changed: boolean; outputText: string }>> | Readonly<{ changed: boolean; outputText: string }>
): Promise<ConfiguredCodemodExecutionResult> {
    const gmlSourceFilePaths = request.gmlFilePaths.filter((filePath) => isGmlSourceFilePath(filePath));

    if (gmlSourceFilePaths.length === 0) {
        return {
            appliedFiles: new Map(),
            summary: {
                id: codemodId,
                changed: false,
                changedFiles: [],
                warnings: [warningMessage],
                errors: []
            }
        };
    }

    if (request.dryRun === false) {
        Core.assertFunction(request.writeFile, "writeFile", {
            errorMessage: `${codemodId} codemod requires writeFile when dryRun is false`
        });
    }

    const appliedFiles = new Map<string, string>();
    const changedFiles: Array<string> = [];
    const semantic = engine.semantic;
    const total = gmlSourceFilePaths.length;

    // Each file is read, transformed, and (in write mode) saved independently of
    // every other file, so the per-file work is processed with bounded
    // concurrency instead of one file at a time. This overlaps disk I/O wait
    // time across files while still parsing/transforming on the main thread.
    // `runInParallelWithLimit` preserves result order, so the file-order
    // behavior of `changedFiles`/`appliedFiles` stays identical to the
    // sequential implementation this replaces.
    let completedCount = 0;
    const fileResults = await Core.runInParallelWithLimit(
        gmlSourceFilePaths,
        async (filePath) => {
            const sourceText = await request.readFile(filePath);
            const result = await transform(sourceText, semantic);

            if (result.changed && request.dryRun === false && request.writeFile) {
                await request.writeFile(filePath, result.outputText);
            }

            completedCount += 1;
            if (request.onProgress) {
                await request.onProgress({ current: completedCount, total, filePath });
            }

            return { changed: result.changed, filePath, outputText: result.outputText };
        },
        SINGLE_FILE_TEXT_CODEMOD_IO_CONCURRENCY_LIMIT
    );

    for (const fileResult of fileResults) {
        if (!fileResult.changed) {
            continue;
        }

        changedFiles.push(fileResult.filePath);
        appliedFiles.set(fileResult.filePath, request.dryRun === false ? "" : fileResult.outputText);
    }

    return {
        appliedFiles,
        summary: {
            id: codemodId,
            changed: changedFiles.length > 0,
            changedFiles,
            warnings: [],
            errors: []
        }
    };
}

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
    scientificNotation: Object.freeze({
        id: "scientificNotation",
        description: "Expand unsupported scientific-notation number literals into plain decimal literals.",
        requiresSemanticProjectIndex: false,
        normalizeConfig: (value: unknown, context: string) => normalizeEmptyObjectConfig(value, context),
        execute(
            _engine: CodemodEngine,
            request: ConfiguredCodemodRunRequest
        ): Promise<ConfiguredCodemodExecutionResult> {
            return executeSingleFileTextCodemod(
                _engine,
                request,
                "scientificNotation",
                "No .gml files were selected for scientific-notation migration.",
                applyScientificNotationCodemod
            );
        }
    }),
    repairLogicalNot: Object.freeze({
        id: "repairLogicalNot",
        description: "Rewrite invalid logical 'not' and 'NOT' operators to '!'.",
        requiresSemanticProjectIndex: false,
        normalizeConfig: (value: unknown, context: string) => normalizeEmptyObjectConfig(value, context),
        execute(
            _engine: CodemodEngine,
            request: ConfiguredCodemodRunRequest
        ): Promise<ConfiguredCodemodExecutionResult> {
            return executeSingleFileTextCodemod(
                _engine,
                request,
                "repairLogicalNot",
                "No .gml files were selected for logical 'not' repair.",
                applyRepairLogicalNotCodemod
            );
        }
    }),
    repairArgumentSeparators: Object.freeze({
        id: "repairArgumentSeparators",
        description: "Insert missing call argument separators (commas) where omitted.",
        requiresSemanticProjectIndex: false,
        normalizeConfig: (value: unknown, context: string) => normalizeEmptyObjectConfig(value, context),
        execute(
            _engine: CodemodEngine,
            request: ConfiguredCodemodRunRequest
        ): Promise<ConfiguredCodemodExecutionResult> {
            return executeSingleFileTextCodemod(
                _engine,
                request,
                "repairArgumentSeparators",
                "No .gml files were selected for argument separator repair.",
                applyRepairArgumentSeparatorsCodemod
            );
        }
    }),

    repairTexturePrefetchGuard: Object.freeze({
        id: "repairTexturePrefetchGuard",
        description: "Prefetch texture pages when they are not ready before using their texture pointers.",
        requiresSemanticProjectIndex: false,
        normalizeConfig: (value: unknown, context: string) => normalizeEmptyObjectConfig(value, context),
        execute(
            _engine: CodemodEngine,
            request: ConfiguredCodemodRunRequest
        ): Promise<ConfiguredCodemodExecutionResult> {
            return executeSingleFileTextCodemod(
                _engine,
                request,
                "repairTexturePrefetchGuard",
                "No .gml files were selected for texture-prefetch guard repair.",
                applyRepairTexturePrefetchGuardCodemod
            );
        }
    }),

    repairInvalidTexturePointerGuard: Object.freeze({
        id: "repairInvalidTexturePointerGuard",
        description: "Return a declared texture-info fallback when a texture pointer is not ready during startup.",
        requiresSemanticProjectIndex: false,
        normalizeConfig: (value: unknown, context: string) => normalizeEmptyObjectConfig(value, context),
        execute(
            _engine: CodemodEngine,
            request: ConfiguredCodemodRunRequest
        ): Promise<ConfiguredCodemodExecutionResult> {
            return executeSingleFileTextCodemod(
                _engine,
                request,
                "repairInvalidTexturePointerGuard",
                "No .gml files were selected for invalid-texture-pointer guard repair.",
                applyRepairInvalidTexturePointerGuardCodemod
            );
        }
    }),

    repairAudioEmitterCreationGuard: Object.freeze({
        id: "repairAudioEmitterCreationGuard",
        description: "Defer audio-emitter creation until the HTML5 audio engine is initialized.",
        requiresSemanticProjectIndex: false,
        normalizeConfig: (value: unknown, context: string) => normalizeEmptyObjectConfig(value, context),
        execute(
            _engine: CodemodEngine,
            request: ConfiguredCodemodRunRequest
        ): Promise<ConfiguredCodemodExecutionResult> {
            return executeSingleFileTextCodemod(
                _engine,
                request,
                "repairAudioEmitterCreationGuard",
                "No .gml files were selected for audio-emitter creation guard repair.",
                applyRepairAudioEmitterCreationGuardCodemod
            );
        }
    }),

    repairSpriteTextureUvResolution: Object.freeze({
        id: "repairSpriteTextureUvResolution",
        description: "Resolve sprite UVs before numeric texture-page handles in HTML5-compatible scr_get_uvs helpers.",
        requiresSemanticProjectIndex: false,
        normalizeConfig: (value: unknown, context: string) => normalizeEmptyObjectConfig(value, context),
        execute(
            _engine: CodemodEngine,
            request: ConfiguredCodemodRunRequest
        ): Promise<ConfiguredCodemodExecutionResult> {
            return executeSingleFileTextCodemod(
                _engine,
                request,
                "repairSpriteTextureUvResolution",
                "No .gml files were selected for sprite-texture UV resolution repair.",
                applyRepairSpriteTextureUvResolutionCodemod
            );
        }
    }),

    repairEventCallbackOther: Object.freeze({
        id: "repairEventCallbackOther",
        description:
            "Rewrite `other.<name>` references inside inline function expressions in event bodies to `self.<name>` so the closure reaches the event instance. Outside of inline callbacks the original `other` access is preserved because the GameMaker HTML5 runtime correctly supplies the calling instance for top-level event references.",
        requiresSemanticProjectIndex: false,
        normalizeConfig: (value: unknown, context: string) => normalizeRepairEventCallbackOtherConfig(value, context),
        execute(
            _engine: CodemodEngine,
            request: ConfiguredCodemodRunRequest
        ): Promise<ConfiguredCodemodExecutionResult> {
            return executeSingleFileTextCodemod(
                _engine,
                request,
                "repairEventCallbackOther",
                "No .gml files were selected for event-callback `other` repair.",
                (sourceText) => {
                    const filePath = request.gmlFilePaths[0] ?? "";
                    return applyRepairEventCallbackOtherCodemod(
                        sourceText,
                        { type: "Program" },
                        { sourcePath: filePath }
                    );
                }
            );
        }
    }),
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
        description: "Hoist array_length(...) calls from safe for-loop conditions into local length variables.",
        requiresSemanticProjectIndex: false,
        normalizeConfig: (value: unknown, context: string) => normalizeEmptyObjectConfig(value, context),
        execute(
            _engine: CodemodEngine,
            request: ConfiguredCodemodRunRequest
        ): Promise<ConfiguredCodemodExecutionResult> {
            return executeSingleFileTextCodemod(
                _engine,
                request,
                "loopLengthHoisting",
                "No .gml files were selected for loop-length hoisting.",
                applyLoopLengthHoistingCodemod
            );
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
            for (const touchedPath of result.plan.workspace.collectChangedFilePaths()) {
                changedFiles.add(touchedPath);
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
        if (request.onBeforeCodemod) {
            await request.onBeforeCodemod(selection.id);
        }
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
