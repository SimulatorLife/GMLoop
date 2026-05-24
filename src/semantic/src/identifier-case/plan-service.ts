import { type GameMakerAstNode } from "@gmloop/core";

import { prepareIdentifierCasePlan as defaultPrepareIdentifierCasePlan } from "./local-plan.js";
import {
    applyIdentifierCasePlanSnapshot as defaultApplyIdentifierCasePlanSnapshot,
    captureIdentifierCasePlanSnapshot as defaultCaptureIdentifierCasePlanSnapshot,
    getIdentifierCaseRenameForNode as defaultGetIdentifierCaseRenameForNode
} from "./plan-state.js";

// Use canonical Core namespace instead of destructuring
// Helpers used from Core.Utils:
// - Core.assertFunction
// - Core.assertPlainObject

/**
 * Unified service contract covering plan preparation, rename lookups, and
 * snapshot capture/apply. Consolidates four formerly separate service types
 * into one object so callers receive the complete set of helpers without
 * needing to wire up multiple registries or resolve multiple services.
 *
 * Before: callers needed to resolve four separate services (preparation,
 * rename-lookup, snapshot-capture, snapshot-apply) via four separate registries.
 * After: a single service object with one frozen interface containing all
 * four helpers, backed by a single registry with one normalization step.
 */
export type IdentifierCasePlanService = {
    prepareIdentifierCasePlan(options: object | null | undefined): Promise<void>;
    getIdentifierCaseRenameForNode(
        node: GameMakerAstNode | null,
        options: Record<string, unknown> | null | undefined
    ): string | null;
    captureIdentifierCasePlanSnapshot(options: unknown): ReturnType<typeof defaultCaptureIdentifierCasePlanSnapshot>;
    applyIdentifierCasePlanSnapshot(
        snapshot: ReturnType<typeof defaultCaptureIdentifierCasePlanSnapshot>,
        options: Record<string, unknown> | null | undefined
    ): void;
};

export type IdentifierCasePlanProvider = () => IdentifierCasePlanService;

// Legacy type aliases for backward compatibility with existing call sites.
// These were the separate service types before the consolidation into a
// single IdentifierCasePlanService.
export type IdentifierCasePlanPreparationService = {
    prepareIdentifierCasePlan(options: object | null | undefined): Promise<void>;
};

export type IdentifierCaseRenameLookupService = {
    getIdentifierCaseRenameForNode(
        node: GameMakerAstNode | null,
        options: Record<string, unknown> | null | undefined
    ): string | null;
};

export type IdentifierCasePlanSnapshotCaptureService = {
    captureIdentifierCasePlanSnapshot(options: unknown): ReturnType<typeof defaultCaptureIdentifierCasePlanSnapshot>;
};

export type IdentifierCasePlanSnapshotApplyService = {
    applyIdentifierCasePlanSnapshot(
        snapshot: ReturnType<typeof defaultCaptureIdentifierCasePlanSnapshot>,
        options: Record<string, unknown> | null | undefined
    ): void;
};

export type IdentifierCasePlanPreparationProvider = () => IdentifierCasePlanPreparationService;
export type IdentifierCaseRenameLookupProvider = () => IdentifierCaseRenameLookupService;
export type IdentifierCasePlanSnapshotCaptureProvider = () => IdentifierCasePlanSnapshotCaptureService;
export type IdentifierCasePlanSnapshotApplyProvider = () => IdentifierCasePlanSnapshotApplyService;

const defaultService: IdentifierCasePlanService = Object.freeze({
    prepareIdentifierCasePlan: defaultPrepareIdentifierCasePlan,
    // The default implementation has a looser signature than the public contract.
    // Cast through `unknown` to keep TypeScript satisfied while preserving runtime
    // correctness; callers receive the canonical type from the service interface.
    getIdentifierCaseRenameForNode:
        defaultGetIdentifierCaseRenameForNode as IdentifierCasePlanService["getIdentifierCaseRenameForNode"],
    captureIdentifierCasePlanSnapshot: defaultCaptureIdentifierCasePlanSnapshot,
    applyIdentifierCasePlanSnapshot: defaultApplyIdentifierCasePlanSnapshot
});

function assertServiceMethod(
    service: Record<string, unknown>,
    methodName: string,
    errorMessage: string
): (...args: unknown[]) => unknown {
    const fn = service[methodName];
    if (typeof fn !== "function") {
        throw new TypeError(errorMessage);
    }
    return fn as (...args: unknown[]) => unknown;
}

function normalizeService(service: Record<string, unknown>): IdentifierCasePlanService {
    if (typeof service !== "object" || service === null) {
        throw new TypeError("Identifier case plan service must be provided as an object");
    }

    const prepareFn = assertServiceMethod(
        service,
        "prepareIdentifierCasePlan",
        "Identifier case plan service must provide a prepareIdentifierCasePlan function"
    );
    const lookupFn = assertServiceMethod(
        service,
        "getIdentifierCaseRenameForNode",
        "Identifier case plan service must provide a getIdentifierCaseRenameForNode function"
    );
    const captureFn = assertServiceMethod(
        service,
        "captureIdentifierCasePlanSnapshot",
        "Identifier case plan service must provide a captureIdentifierCasePlanSnapshot function"
    );
    const applyFn = assertServiceMethod(
        service,
        "applyIdentifierCasePlanSnapshot",
        "Identifier case plan service must provide an applyIdentifierCasePlanSnapshot function"
    );

    // Cast each method to the expected signature. The assertions above ensure
    // they exist and are callable; the downstream call sites receive the correct
    // types through the IdentifierCasePlanService interface.
    return Object.freeze({
        prepareIdentifierCasePlan: prepareFn as IdentifierCasePlanService["prepareIdentifierCasePlan"],
        getIdentifierCaseRenameForNode: lookupFn as IdentifierCasePlanService["getIdentifierCaseRenameForNode"],
        captureIdentifierCasePlanSnapshot: captureFn as IdentifierCasePlanService["captureIdentifierCasePlanSnapshot"],
        applyIdentifierCasePlanSnapshot: applyFn as IdentifierCasePlanService["applyIdentifierCasePlanSnapshot"]
    });
}

const MISSING_PROVIDER_MESSAGE = "No identifier case plan provider has been registered";
const PROVIDER_TYPE_ERROR_MESSAGE = "Identifier case plan provider must be a function";

let currentProvider: IdentifierCasePlanProvider = () => defaultService;
let cachedService: IdentifierCasePlanService | null = null;

/**
 * Inject a custom provider so embedders can override the complete identifier-
 * case plan behaviour (preparation, rename lookups, and snapshot operations).
 * Passing `null` or a non-function will surface a descriptive `TypeError` via
 * the shared assertion helpers.
 *
 * @param {IdentifierCasePlanProvider} provider Factory returning the service
 *        to use for subsequent calls.
 */
export function registerIdentifierCasePlanProvider(provider: IdentifierCasePlanProvider) {
    if (typeof provider !== "function") {
        throw new TypeError(PROVIDER_TYPE_ERROR_MESSAGE);
    }
    currentProvider = provider;
    cachedService = null;
}

/**
 * Restore the default provider. Useful for tests that temporarily swap in
 * bespoke collaborators and need a predictable baseline afterwards.
 */
export function resetIdentifierCasePlanProvider() {
    currentProvider = () => defaultService;
    cachedService = null;
}

/**
 * Resolve the active plan service.
 *
 * @returns {IdentifierCasePlanService}
 */
export function resolveIdentifierCasePlanService(): IdentifierCasePlanService {
    if (!currentProvider) {
        throw new Error(MISSING_PROVIDER_MESSAGE);
    }

    if (!cachedService) {
        cachedService = normalizeService(currentProvider() as Record<string, unknown>);
    }

    return cachedService;
}

/**
 * Prepare the identifier-case plan using the active service.
 *
 * @param {object | null | undefined} options Caller-provided configuration.
 * @returns {Promise<void>}
 */
export function prepareIdentifierCasePlan(options) {
    return resolveIdentifierCasePlanService().prepareIdentifierCasePlan(options);
}

/**
 * Look up the rename to apply for a given AST node using the active service.
 *
 * @param node AST node under consideration.
 * @param options Identifier-case options bag captured from the formatter.
 * @returns The rename that should be applied or `null` when none exists.
 */
export function getIdentifierCaseRenameForNode(
    node: GameMakerAstNode | null,
    options: Record<string, string> | null | undefined
) {
    return resolveIdentifierCasePlanService().getIdentifierCaseRenameForNode(node, options);
}

/**
 * Capture the identifier-case plan snapshot for later reuse.
 *
 * @param {unknown} options Snapshot configuration passed through to the
 *        provider.
 * @returns {ReturnType<typeof defaultCaptureIdentifierCasePlanSnapshot>}
 */
export function captureIdentifierCasePlanSnapshot(options) {
    return resolveIdentifierCasePlanService().captureIdentifierCasePlanSnapshot(options);
}

/**
 * Rehydrate identifier-case plan state from a previously captured snapshot.
 *
 * @param {ReturnType<typeof defaultCaptureIdentifierCasePlanSnapshot>} snapshot
 * @param {Record<string, unknown> | null | undefined} options
 * @returns {void}
 */
export function applyIdentifierCasePlanSnapshot(snapshot, options) {
    return resolveIdentifierCasePlanService().applyIdentifierCasePlanSnapshot(snapshot, options);
}

// Backward-compatible aliases for existing call sites that reference the
// segregated-resolver names. These forward to the unified service so callers
// can migrate incrementally. Remove in a future release once all consumers
// have switched to the unified API.
export { resolveIdentifierCasePlanService as resolveIdentifierCasePlanPreparationService };
export { resolveIdentifierCasePlanService as resolveIdentifierCasePlanSnapshotCaptureService };
export { resolveIdentifierCasePlanService as resolveIdentifierCasePlanSnapshotApplyService };
export { resolveIdentifierCasePlanService as resolveIdentifierCasePlanRenameLookupService };

// Legacy registration functions for backward compatibility. These wrap the
// unified registration but still allow callers to register just one aspect
// of the service.
export function registerIdentifierCasePlanPreparationProvider(provider: IdentifierCasePlanPreparationProvider) {
    const service = provider();
    registerIdentifierCasePlanProvider(function (this: unknown) {
        return {
            prepareIdentifierCasePlan: service.prepareIdentifierCasePlan.bind(service),
            getIdentifierCaseRenameForNode: (node, options) =>
                defaultGetIdentifierCaseRenameForNode(
                    node as Parameters<typeof defaultGetIdentifierCaseRenameForNode>[0],
                    options
                ),
            captureIdentifierCasePlanSnapshot: defaultCaptureIdentifierCasePlanSnapshot,
            applyIdentifierCasePlanSnapshot: defaultApplyIdentifierCasePlanSnapshot
        } as IdentifierCasePlanService;
    });
}

export function registerIdentifierCaseRenameLookupProvider(provider: IdentifierCaseRenameLookupProvider) {
    const service = provider();
    registerIdentifierCasePlanProvider(function (this: unknown) {
        return {
            prepareIdentifierCasePlan: defaultPrepareIdentifierCasePlan,
            getIdentifierCaseRenameForNode: (node, options) =>
                service.getIdentifierCaseRenameForNode(
                    node as Parameters<typeof service.getIdentifierCaseRenameForNode>[0],
                    options as Parameters<typeof service.getIdentifierCaseRenameForNode>[1]
                ),
            captureIdentifierCasePlanSnapshot: defaultCaptureIdentifierCasePlanSnapshot,
            applyIdentifierCasePlanSnapshot: defaultApplyIdentifierCasePlanSnapshot
        } as IdentifierCasePlanService;
    });
}

export function registerIdentifierCasePlanSnapshotCaptureProvider(provider: IdentifierCasePlanSnapshotCaptureProvider) {
    const service = provider();
    registerIdentifierCasePlanProvider(function (this: unknown) {
        return {
            prepareIdentifierCasePlan: defaultPrepareIdentifierCasePlan,
            getIdentifierCaseRenameForNode: (node, options) =>
                defaultGetIdentifierCaseRenameForNode(
                    node as Parameters<typeof defaultGetIdentifierCaseRenameForNode>[0],
                    options
                ),
            captureIdentifierCasePlanSnapshot: service.captureIdentifierCasePlanSnapshot.bind(service),
            applyIdentifierCasePlanSnapshot: defaultApplyIdentifierCasePlanSnapshot
        } as IdentifierCasePlanService;
    });
}

export function registerIdentifierCasePlanSnapshotApplyProvider(provider: IdentifierCasePlanSnapshotApplyProvider) {
    const service = provider();
    registerIdentifierCasePlanProvider(function (this: unknown) {
        return {
            prepareIdentifierCasePlan: defaultPrepareIdentifierCasePlan,
            getIdentifierCaseRenameForNode: (node, options) =>
                defaultGetIdentifierCaseRenameForNode(
                    node as Parameters<typeof defaultGetIdentifierCaseRenameForNode>[0],
                    options
                ),
            captureIdentifierCasePlanSnapshot: defaultCaptureIdentifierCasePlanSnapshot,
            applyIdentifierCasePlanSnapshot: service.applyIdentifierCasePlanSnapshot.bind(service)
        } as IdentifierCasePlanService;
    });
}

/**
 * Restore the default provider. Alias of {@link resetIdentifierCasePlanProvider}
 * for backward compatibility.
 */
export function resetIdentifierCasePlanServiceProvider() {
    resetIdentifierCasePlanProvider();
}
