import path from "node:path";

import { Core } from "@gmloop/core";

import * as SymbolQueries from "./symbol-queries.js";
import type {
    FeatherRenamePlanner,
    GlobalVarRewriteAssessor,
    IdentifierOccupancyChecker,
    LoopHoistIdentifierResolver,
    RefactorProjectAnalysisContext,
    RefactorProjectAnalysisProvider
} from "./types.js";

type FeatherRenamePlanEntry = {
    identifierName: string;
    mode: "local-fallback" | "project-aware";
    preferredReplacementName: string;
    replacementName: string | null;
    skipReason?: string;
};

type PrepareRenamePlan = RefactorProjectAnalysisContext["prepareRenamePlan"];

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
 * Default identifier-occupancy checker for the default project analysis
 * provider. Exposed independently so consumers that only need overlap
 * queries (for example, lint rules checking name collisions) can depend
 * on the narrow role interface without pulling in Feather, globalvar, or
 * loop-hoist collaborators.
 */
const DEFAULT_IDENTIFIER_OCCUPANCY_CHECKER: IdentifierOccupancyChecker = Object.freeze({
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
    }
});

/**
 * Default Feather rename planner for the default project analysis
 * provider. Splitting this from the identifier-occupancy checker keeps
 * the Feather-only collaborators (rename plan retries, file-path
 * scoping) out of the overlap-query code path.
 */
const DEFAULT_FEATHER_RENAME_PLANNER: FeatherRenamePlanner = Object.freeze({
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
    }
});

/**
 * Default globalvar-to-global rewrite assessor. The decision is a local
 * structural check, so this role interface owns no shared state.
 */
const DEFAULT_GLOBAL_VAR_REWRITE_ASSESSOR: GlobalVarRewriteAssessor = Object.freeze({
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
    }
});

/**
 * Default loop-hoist identifier resolver. Like the globalvar assessor
 * this is a pure mapping that requires no shared state.
 */
const DEFAULT_LOOP_HOIST_IDENTIFIER_RESOLVER: LoopHoistIdentifierResolver = Object.freeze({
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

/**
 * Default project analysis provider for RefactorEngine overlap checks.
 *
 * The composite delegates each role to the matching default
 * implementation above, so the four role interfaces can evolve (and be
 * tested) independently while the composite stays a stable seam for
 * {@link RefactorEngine}. This is a stateless, immutable singleton —
 * all methods receive their context as parameters, so a single shared
 * instance is always safe.
 */
export const DEFAULT_PROJECT_ANALYSIS_PROVIDER: RefactorProjectAnalysisProvider = Object.freeze({
    ...DEFAULT_IDENTIFIER_OCCUPANCY_CHECKER,
    ...DEFAULT_FEATHER_RENAME_PLANNER,
    ...DEFAULT_GLOBAL_VAR_REWRITE_ASSESSOR,
    ...DEFAULT_LOOP_HOIST_IDENTIFIER_RESOLVER
});
