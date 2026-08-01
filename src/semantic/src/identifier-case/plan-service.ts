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
 * Role contract for plan preparation.
 *
 * Consumers that only need to prepare a plan (e.g. CLI bootstrap or test
 * fixtures that reset plan state) can depend on this narrow interface and
 * do not need to know about rename lookups or snapshot operations.
 */
export interface IdentifierCasePlanPreparer {
    prepareIdentifierCasePlan(options: object | null | undefined): Promise<void>;
}

/**
 * Role contract for rename lookups.
 *
 * Consumers that only need to resolve a rename for a given AST node (e.g.
 * the identifier-case printer) can depend on this narrow interface and do
 * not need to know about plan preparation or snapshot operations.
 */
export interface IdentifierCaseRenameLookup {
    getIdentifierCaseRenameForNode(
        node: GameMakerAstNode | null,
        options: Record<string, unknown> | null | undefined
    ): string | null;
}

/**
 * Role contract for snapshot capture.
 *
 * Consumers that only need to capture the current plan state for later
 * rehydration (e.g. environment teardown) can depend on this narrow
 * interface and do not need to know about plan preparation or apply.
 */
export interface IdentifierCasePlanSnapshotCapture {
    captureIdentifierCasePlanSnapshot(options: unknown): ReturnType<typeof defaultCaptureIdentifierCasePlanSnapshot>;
}

/**
 * Role contract for snapshot rehydration.
 *
 * Consumers that only need to rehydrate plan state from a previously
 * captured snapshot (e.g. CLI teardown paths) can depend on this narrow
 * interface and do not need to know about preparation or lookup.
 */
export interface IdentifierCasePlanSnapshotApplicator {
    applyIdentifierCasePlanSnapshot(
        snapshot: ReturnType<typeof defaultCaptureIdentifierCasePlanSnapshot>,
        options: Record<string, unknown> | null | undefined
    ): void;
}

/**
 * Composite service contract that combines every role interface. The
 * default provider implementation realises the full intersection so
 * callers that genuinely need every capability can resolve a single
 * object; callers that only need a subset should depend on the
 * corresponding role interface (`IdentifierCasePlanPreparer`,
 * `IdentifierCaseRenameLookup`, etc.) and resolve it via
 * `resolveIdentifierCasePlanServiceAs<TRole>()`.
 */
export type IdentifierCasePlanService = IdentifierCasePlanPreparer &
    IdentifierCaseRenameLookup &
    IdentifierCasePlanSnapshotCapture &
    IdentifierCasePlanSnapshotApplicator;

export type IdentifierCasePlanProvider = () => IdentifierCasePlanService;

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
 * Resolve the active plan service projected onto a specific role.
 *
 * Callers that only need a subset of the plan service capabilities should
 * pass the role interface they actually use (for example
 * `resolveIdentifierCasePlanServiceAs<IdentifierCaseRenameLookup>()`), so
 * the function's return type and the caller's contract stay narrowly
 * focused. The composite `IdentifierCasePlanService` is the union of every
 * role, so any role interface is a valid type argument.
 *
 * The type parameter is intentionally unconstrained because the role
 * interfaces are *parts* of the composite (the composite extends the
 * roles, not the other way around), which is the exact relationship the
 * Interface Segregation Principle aims to express. The TypeScript
 * compiler still verifies the call site because the caller assigns the
 * return value to a typed binding.
 *
 * @typeParam TRole Role interface to project the service onto. Should be
 *        one of the role interfaces (`IdentifierCasePlanPreparer`,
 *        `IdentifierCaseRenameLookup`,
 *        `IdentifierCasePlanSnapshotCapture`,
 *        `IdentifierCasePlanSnapshotApplicator`) or the composite
 *        `IdentifierCasePlanService`.
 * @returns The cached service cast to the requested role projection.
 */
export function resolveIdentifierCasePlanServiceAs<TRole>(): TRole {
    if (!currentProvider) {
        throw new Error(MISSING_PROVIDER_MESSAGE);
    }

    if (!cachedService) {
        cachedService = normalizeService(currentProvider() as unknown as Record<string, unknown>);
    }

    return cachedService as TRole;
}

/**
 * Resolve the full composite plan service.
 *
 * Equivalent to `resolveIdentifierCasePlanServiceAs<IdentifierCasePlanService>()`.
 * Prefer the role-specific projection above unless the caller genuinely
 * needs every capability of the service.
 *
 * @returns {IdentifierCasePlanService}
 */
export function resolveIdentifierCasePlanService(): IdentifierCasePlanService {
    return resolveIdentifierCasePlanServiceAs<IdentifierCasePlanService>();
}

/**
 * Prepare the identifier-case plan using the active service.
 *
 * Internally resolves only the `IdentifierCasePlanPreparer` role so the
 * caller is not exposed to the other three capabilities of the composite
 * service.
 *
 * @param {object | null | undefined} options Caller-provided configuration.
 * @returns {Promise<void>}
 */
export function prepareIdentifierCasePlan(options) {
    return resolveIdentifierCasePlanServiceAs<IdentifierCasePlanPreparer>().prepareIdentifierCasePlan(options);
}

/**
 * Look up the rename to apply for a given AST node using the active service.
 *
 * Internally resolves only the `IdentifierCaseRenameLookup` role so the
 * caller is not exposed to plan preparation or snapshot operations.
 *
 * @param node AST node under consideration.
 * @param options Identifier-case options bag captured from the formatter.
 * @returns The rename that should be applied or `null` when none exists.
 */
export function getIdentifierCaseRenameForNode(
    node: GameMakerAstNode | null,
    options: Record<string, string> | null | undefined
) {
    return resolveIdentifierCasePlanServiceAs<IdentifierCaseRenameLookup>().getIdentifierCaseRenameForNode(
        node,
        options
    );
}

/**
 * Capture the identifier-case plan snapshot for later reuse.
 *
 * Internally resolves only the `IdentifierCasePlanSnapshotCapture` role so
 * the caller is not exposed to plan preparation, lookup, or apply
 * operations.
 *
 * @param {unknown} options Snapshot configuration passed through to the
 *        provider.
 * @returns {ReturnType<typeof defaultCaptureIdentifierCasePlanSnapshot>}
 */
export function captureIdentifierCasePlanSnapshot(options) {
    return resolveIdentifierCasePlanServiceAs<IdentifierCasePlanSnapshotCapture>().captureIdentifierCasePlanSnapshot(
        options
    );
}

/**
 * Rehydrate identifier-case plan state from a previously captured snapshot.
 *
 * Internally resolves only the `IdentifierCasePlanSnapshotApplicator` role
 * so the caller is not exposed to plan preparation, lookup, or capture
 * operations.
 *
 * @param {ReturnType<typeof defaultCaptureIdentifierCasePlanSnapshot>} snapshot
 * @param {Record<string, unknown> | null | undefined} options
 * @returns {void}
 */
export function applyIdentifierCasePlanSnapshot(snapshot, options) {
    return resolveIdentifierCasePlanServiceAs<IdentifierCasePlanSnapshotApplicator>().applyIdentifierCasePlanSnapshot(
        snapshot,
        options
    );
}
