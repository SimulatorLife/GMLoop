/**
 * Compare-target resolution helpers for the `replay compare` and
 * `profile compare` CLI commands.
 *
 * Both actions orchestrate the same three-step ceremony:
 *
 *   1. list the available artifact/snapshot ids for the project;
 *   2. resolve the baseline id and candidate id, defaulting to the
 *      penultimate and ultimate entries of the available id list when the
 *      caller did not supply explicit overrides;
 *   3. load the corresponding records and classify any missing side.
 *
 * Without this helper the ceremony was inlined in every orchestrator,
 * interleaving array indexing (`ids.at(-2) ?? ""`) with length checks
 * (`baselineId.length > 0 ? ... : null`) and conditional failure
 * classification. That made the action handlers read as a mixture of
 * primitive bookkeeping and high-level delegation, and forced every new
 * compare command to re-derive the default-pair semantics.
 *
 * {@link resolveBaselineAndCandidateTargets} lifts the bookkeeping into a
 * single dependency-injected helper so the orchestrators can read as a
 * sequence of high-level delegation steps at one abstraction layer:
 *
 * - call the helper with the caller-supplied hooks (list, load, classify);
 * - inspect the structured outcome (ids, records, reasons) the helper
 *   returns;
 * - render the action-specific JSON payload without re-implementing the
 *   default-pair resolution or the failure classification.
 */

/**
 * Inputs accepted by {@link resolveBaselineAndCandidateTargets}.
 *
 * The contract is deliberately dependency-injected so the helper does not
 * reach into any specific artifact store or classification strategy. Each
 * hook is the narrow surface the helper actually exercises:
 *
 * - {@link ResolveBaselineAndCandidateTargetsParameters.listAvailableIds}
 *   enumerates the on-disk record ids in ascending order. The last entry
 *   is the "latest" id, and the second-to-last entry is the "penultimate"
 *   id used as the default baseline.
 * - {@link ResolveBaselineAndCandidateTargetsParameters.loadRecord} reads
 *   the typed record for an id. Returning `null` indicates either a
 *   missing file or a structurally invalid payload; the helper treats
 *   both cases identically and surfaces a structured reason through
 *   {@link ResolveBaselineAndCandidateTargetsParameters.classifyMissing}.
 * - {@link ResolveBaselineAndCandidateTargetsParameters.classifyMissing}
 *   optionally distinguishes "absent" from "malformed" for the missing
 *   side. Callers that do not maintain that split (or that always treat a
 *   missing record the same way) may omit it; the helper will then surface
 *   `null` for the corresponding reason field.
 */
export type ResolveBaselineAndCandidateTargetsParameters<T> = Readonly<{
    /**
     * Classifies a missing-record situation for a given id. Returning a
     * non-null string records that string as the reason on the resolved
     * payload; returning `null` indicates the helper has nothing to report
     * for that side (either the id was empty or the caller did not supply
     * a classifier).
     */
    classifyMissing?: (projectRoot: string, id: string) => Promise<string | null>;
    /**
     * Caller-supplied override for the baseline id. When omitted, the
     * helper falls back to the penultimate id returned by
     * {@link ResolveBaselineAndCandidateTargetsParameters.listAvailableIds}
     * so the most recently recorded pair is compared by default.
     */
    explicitBaselineId?: string;
    /**
     * Caller-supplied override for the candidate id. When omitted, the
     * helper falls back to the latest id returned by
     * {@link ResolveBaselineAndCandidateTargetsParameters.listAvailableIds}.
     */
    explicitCandidateId?: string;
    /**
     * Reads the typed record for a given id. The helper invokes this once
     * per side that resolves to a non-empty id; a `null` return is
     * classified via {@link ResolveBaselineAndCandidateTargetsParameters.classifyMissing}.
     */
    loadRecord: (projectRoot: string, id: string) => Promise<T | null>;
    /**
     * Lists the available record ids in ascending order. The list is
     * surfaced verbatim on the resolved payload so orchestrators can
     * include it in the structured "available ids" diagnostic when one of
     * the sides is missing.
     */
    listAvailableIds: (projectRoot: string) => Promise<ReadonlyArray<string>>;
    /** Resolved project root; passed through to every caller-supplied hook. */
    projectRoot: string;
}>;

/**
 * Structured outcome of {@link resolveBaselineAndCandidateTargets}.
 *
 * The helper returns every field the orchestrator needs to render its
 * action-specific JSON payload in one struct, so the orchestrator never
 * has to re-perform the default-pair resolution or the conditional
 * classification that previously lived inline in each action handler.
 *
 * @typeParam T - The record shape produced by the caller-supplied loader.
 */
export type BaselineAndCandidateTargets<T> = Readonly<{
    /** The full sorted list of ids the helper observed. */
    availableIds: ReadonlyArray<string>;
    /** The resolved baseline record, or `null` if it could not be loaded. */
    baseline: T | null;
    /**
     * The resolved baseline id. An empty string indicates no baseline id
     * was available (e.g. the project has no recorded artifacts); the
     * orchestrator should treat that as "no baseline" rather than as a
     * sentinel id.
     */
    baselineId: string;
    /**
     * Structured failure reason for the baseline side; `null` when the
     * baseline loaded successfully, when the id was empty, or when the
     * caller did not supply a {@link ResolveBaselineAndCandidateTargetsParameters.classifyMissing}
     * hook.
     */
    baselineReason: string | null;
    /** The resolved candidate record, or `null` if it could not be loaded. */
    candidate: T | null;
    /**
     * The resolved candidate id. Empty when no candidate id was available.
     */
    candidateId: string;
    /**
     * Structured failure reason for the candidate side; `null` when the
     * candidate loaded successfully, when the id was empty, or when no
     * classifier was supplied.
     */
    candidateReason: string | null;
}>;

/**
 * Resolve the baseline and candidate record pair for a compare-style action.
 *
 * Centralises the three pieces of bookkeeping that every compare
 * orchestrator previously inlined:
 *
 * 1. Pick the default baseline/candidate ids from the available id list
 *    (penultimate for baseline, latest for candidate) when the caller did
 *    not override them via the explicit options.
 * 2. Load both records in parallel via the caller-supplied loader,
 *    tolerating `null` returns for missing or malformed records and
 *    skipping the load entirely when the resolved id is empty.
 * 3. Classify each missing record via the caller-supplied classifier so
 *    the orchestrator can surface a structured "absent vs malformed"
 *    reason alongside the available id list.
 *
 * The helper returns a single {@link BaselineAndCandidateTargets} value
 * that exposes every field the orchestrator needs to render its JSON
 * payload, so the orchestrator can read as a sequence of high-level
 * delegation steps rather than intermixing array indexing with loader
 * invocations.
 */
export async function resolveBaselineAndCandidateTargets<T>(
    parameters: ResolveBaselineAndCandidateTargetsParameters<T>
): Promise<BaselineAndCandidateTargets<T>> {
    const { projectRoot, classifyMissing, explicitBaselineId, explicitCandidateId } = parameters;

    const availableIds = await parameters.listAvailableIds(projectRoot);
    const baselineId = explicitBaselineId ?? availableIds.at(-2) ?? "";
    const candidateId = explicitCandidateId ?? availableIds.at(-1) ?? "";

    const [baseline, candidate] = await Promise.all([
        baselineId.length > 0 ? parameters.loadRecord(projectRoot, baselineId) : Promise.resolve(null),
        candidateId.length > 0 ? parameters.loadRecord(projectRoot, candidateId) : Promise.resolve(null)
    ]);

    const baselineReason =
        classifyMissing && baselineId.length > 0 && baseline === null
            ? await classifyMissing(projectRoot, baselineId)
            : null;
    const candidateReason =
        classifyMissing && candidateId.length > 0 && candidate === null
            ? await classifyMissing(projectRoot, candidateId)
            : null;

    return {
        availableIds,
        baseline,
        baselineId,
        baselineReason,
        candidate,
        candidateId,
        candidateReason
    };
}
