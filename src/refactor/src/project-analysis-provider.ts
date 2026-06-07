import path from "node:path";

import { Core } from "@gmloop/core";

import * as SymbolQueries from "./symbol-queries.js";
import type { PartialSemanticAnalyzer, RefactorProjectAnalysisProvider, RenamePlanSummary } from "./types.js";

type FeatherRenamePlanEntry = {
    identifierName: string;
    mode: "local-fallback" | "project-aware";
    preferredReplacementName: string;
    replacementName: string | null;
    skipReason?: string;
};

type PrepareRenamePlan = (
    request: { symbolId: string; newName: string },
    options: { validateHotReload: boolean }
) => Promise<RenamePlanSummary>;

type RefactorProjectAnalysisContext = {
    semantic: PartialSemanticAnalyzer | null;
    prepareRenamePlan: PrepareRenamePlan;
};

function enumerateRenameCandidates(preferredName: string): ReadonlyArray<string> {
    if (!Core.isNonEmptyString(preferredName)) {
        return ["__featherFix_reserved"];
    }

    const candidates = [preferredName];
    for (let index = 1; index <= 32; index += 1) {
        candidates.push(`${preferredName}_${index}`);
    }

    return candidates;
}

async function resolveReplacementName(parameters: {
    candidateNames: ReadonlyArray<string>;
    normalizedFilePath: string | null;
    projectRoot: string;
    symbolId: string;
    prepareRenamePlan: PrepareRenamePlan;
}): Promise<{ replacementName: string | null; skipReason?: string }> {
    const tryCandidateAtIndex = async (
        index: number,
        lastSkipReason?: string
    ): Promise<{ replacementName: string | null; skipReason?: string }> => {
        if (index >= parameters.candidateNames.length) {
            return {
                replacementName: null,
                skipReason: lastSkipReason
            };
        }

        const candidateName = parameters.candidateNames[index];
        try {
            const plan = await parameters.prepareRenamePlan(
                {
                    symbolId: parameters.symbolId,
                    newName: candidateName
                },
                {
                    validateHotReload: false
                }
            );

            if (!plan.validation.valid) {
                return await tryCandidateAtIndex(index + 1, plan.validation.errors.join("; "));
            }

            const affectedAbsolutePaths = new Set<string>();
            for (const edit of plan.workspace.edits) {
                affectedAbsolutePaths.add(path.resolve(parameters.projectRoot, edit.path));
            }

            const touchesOnlyCurrentFile =
                parameters.normalizedFilePath === null ||
                [...affectedAbsolutePaths.values()].every(
                    (affectedPath) => affectedPath === parameters.normalizedFilePath
                );
            if (!touchesOnlyCurrentFile) {
                return await tryCandidateAtIndex(
                    index + 1,
                    "Rename requires project-wide edits and cannot be applied safely inside formatter-only mode."
                );
            }

            return { replacementName: candidateName };
        } catch (error) {
            return await tryCandidateAtIndex(index + 1, Core.getErrorMessage(error));
        }
    };

    return await tryCandidateAtIndex(0);
}

async function planSingleFeatherRename(parameters: {
    request: { identifierName: string; preferredReplacementName: string };
    normalizedFilePath: string | null;
    projectRoot: string;
    context: RefactorProjectAnalysisContext;
}): Promise<FeatherRenamePlanEntry | null> {
    if (!parameters.request || !Core.isNonEmptyString(parameters.request.identifierName)) {
        return null;
    }

    const symbolId = await SymbolQueries.resolveSymbolId(
        parameters.request.identifierName,
        parameters.context.semantic
    );
    if (!Core.isNonEmptyString(symbolId)) {
        return {
            identifierName: parameters.request.identifierName,
            mode: "local-fallback",
            preferredReplacementName: parameters.request.preferredReplacementName,
            replacementName: parameters.request.preferredReplacementName
        };
    }

    const candidateNames = enumerateRenameCandidates(parameters.request.preferredReplacementName);
    const resolution = await resolveReplacementName({
        candidateNames,
        normalizedFilePath: parameters.normalizedFilePath,
        projectRoot: parameters.projectRoot,
        symbolId,
        prepareRenamePlan: parameters.context.prepareRenamePlan
    });

    return {
        identifierName: parameters.request.identifierName,
        mode: "project-aware",
        preferredReplacementName: parameters.request.preferredReplacementName,
        replacementName: resolution.replacementName,
        skipReason: resolution.skipReason
    };
}

/**
 * Default project analysis provider for RefactorEngine overlap checks.
 * This is a stateless, immutable singleton — all methods receive their
 * context as parameters, so a single shared instance is always safe.
 */
export const DEFAULT_PROJECT_ANALYSIS_PROVIDER: RefactorProjectAnalysisProvider = Object.freeze({
    async isIdentifierOccupied(identifierName: string, context: RefactorProjectAnalysisContext): Promise<boolean> {
        if (!context.semantic) {
            return false;
        }

        const occurrences = await context.semantic.getSymbolOccurrences?.(identifierName);
        if (Core.isNonEmptyArray(occurrences)) {
            return true;
        }

        const symbolId = await SymbolQueries.resolveSymbolId(identifierName, context.semantic);
        return Core.isNonEmptyString(symbolId);
    },
    async listIdentifierOccurrences(
        identifierName: string,
        context: RefactorProjectAnalysisContext
    ): Promise<Set<string>> {
        const files = new Set<string>();
        if (!context.semantic) {
            return files;
        }

        const occurrences = await context.semantic.getSymbolOccurrences?.(identifierName);
        if (!Core.isNonEmptyArray(occurrences)) {
            return files;
        }

        for (const occurrence of occurrences) {
            if (Core.isObjectLike(occurrence) && Core.isNonEmptyString(occurrence.path)) {
                files.add(occurrence.path);
            }
        }

        return files;
    },
    async planFeatherRenames(
        requests: ReadonlyArray<{ identifierName: string; preferredReplacementName: string }>,
        filePath: string | null,
        projectRoot: string,
        context: RefactorProjectAnalysisContext
    ): Promise<Array<FeatherRenamePlanEntry>> {
        const normalizedFilePath = Core.isNonEmptyString(filePath) ? path.resolve(filePath) : null;
        const plannedEntries: Array<FeatherRenamePlanEntry> = [];

        await Core.runSequentially(requests, async (request) => {
            const plannedEntry = await planSingleFeatherRename({
                request,
                normalizedFilePath,
                projectRoot,
                context
            });
            if (plannedEntry) {
                plannedEntries.push(plannedEntry);
            }
        });

        return plannedEntries;
    },
    assessGlobalVarRewrite(
        filePath: string | null,
        hasInitializer: boolean
    ): {
        allowRewrite: boolean;
        initializerMode: "existing" | "undefined";
        mode: "project-aware";
    } {
        const normalizedFilePath = Core.isNonEmptyString(filePath) ? path.resolve(filePath) : null;
        return {
            allowRewrite: hasInitializer || normalizedFilePath !== null,
            initializerMode: hasInitializer ? "existing" : "undefined",
            mode: "project-aware"
        };
    },
    resolveLoopHoistIdentifier(preferredName: string): {
        identifierName: string;
        mode: "project-aware";
    } {
        return {
            identifierName: preferredName,
            mode: "project-aware"
        };
    }
});
