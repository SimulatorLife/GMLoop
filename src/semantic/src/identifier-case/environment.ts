import { Core } from "@gmloop/core";

import { warnWithReason } from "./logger.js";
import { deleteIdentifierCaseOption, setIdentifierCaseOption } from "./option-store.js";
import { captureIdentifierCasePlanSnapshot, prepareIdentifierCasePlan } from "./plan-service.js";
import { bootstrapIdentifierCaseProjectIndex } from "./project-index-gateway.js";
import { type IdentifierCasePlanSnapshot } from "./types.js";

// Use the canonical Core namespace for helpers per AGENTS.md. Keeping the
// namespace intact makes it obvious when we're reaching across workspaces, and
// it ensures external consumers always reference the public API surface rather
// than smuggling private imports through destructured names. This matters here
// because the identifier-case environment coordinates multiple workspace
// boundaries; altering the import style can silently drift away from the
// documented integration contract and make it harder to audit why a helper is
// coming from Core vs. local scope.

// Helpers used from Core:
// - Core.isObjectLike
// - Core.isMapLike
// - Core.noop
// - Core.withObjectLike

const IDENTIFIER_CASE_LOGGER_NAMESPACE = "identifier-case";

const managedBootstraps = new WeakSet();

function clearOwnProperty(_target, propertyName, { value = null } = {}) {
    if (!Core.isObjectLike(_target)) {
        return;
    }

    if (!Object.hasOwn(_target, propertyName)) {
        return;
    }

    const nextValue = typeof value === "function" ? value(_target[propertyName]) : value;
    _target[propertyName] = nextValue;
}

function sanitizeBootstrapResult(bootstrap) {
    if (!Core.isObjectLike(bootstrap)) {
        return;
    }

    clearOwnProperty(bootstrap, "projectIndex");
    clearOwnProperty(bootstrap, "coordinator");

    if (typeof bootstrap.dispose === "function") {
        // Replace the dispose method with a no-op to support idempotent teardown.
        // The sanitized bootstrap object remains attached to Prettier's options
        // bag so downstream diagnostics can report cache hit/rebuild status.
        // Callers probe this metadata and still invoke `dispose()` in their
        // finally blocks—mirroring rollout guidance—but by this point we have
        // already released file watchers and caches. Making dispose() a no-op
        // prevents double-free bugs while maintaining the expected interface.
        // Deleting the method would crash consumers expecting it to exist, while
        // leaving the original callback would attempt to release already-freed
        // resources, corrupting the cleanup state.
        bootstrap.dispose = Core.noop;
    }

    const { cache } = bootstrap;
    clearOwnProperty(cache, "projectIndex");
    clearOwnProperty(cache?.payload, "projectIndex");
    clearOwnProperty(cache, "payload");
}

function registerBootstrapCleanup(bootstrapResult) {
    if (typeof bootstrapResult?.dispose !== "function") {
        return null;
    }

    managedBootstraps.add(bootstrapResult);
    return bootstrapResult;
}

function disposeBootstrap(bootstrapResult, logger = null) {
    if (!bootstrapResult || typeof bootstrapResult.dispose !== "function") {
        return;
    }

    if (managedBootstraps.has(bootstrapResult)) {
        managedBootstraps.delete(bootstrapResult);
    }

    try {
        bootstrapResult.dispose();
    } catch (error) {
        warnWithReason(logger, IDENTIFIER_CASE_LOGGER_NAMESPACE, "Failed to dispose identifier case resources", error);
    }
}

export function prepareIdentifierCaseEnvironment(options) {
    return Core.withObjectLike(
        options,
        async (object) => {
            const bootstrapResult = await bootstrapIdentifierCaseProjectIndex(object);
            registerBootstrapCleanup(bootstrapResult);

            if (bootstrapResult?.status === "failed") {
                if (object.__identifierCaseProjectIndexFailureLogged !== true) {
                    const logger = object?.logger ?? null;
                    warnWithReason(
                        logger,
                        IDENTIFIER_CASE_LOGGER_NAMESPACE,
                        "Project index bootstrap failed. Identifier case renames will be skipped",
                        bootstrapResult.error,
                        bootstrapResult.reason
                    );
                    setIdentifierCaseOption(object, "__identifierCaseProjectIndexFailureLogged", true);
                }
                return;
            }

            try {
                await prepareIdentifierCasePlan(object);
            } catch (error) {
                disposeBootstrap(bootstrapResult, object?.logger ?? null);
                throw error;
            }
        },
        () => {}
    );
}

export function attachIdentifierCasePlanSnapshot(ast, options) {
    Core.withObjectLike(
        ast,
        (objectAst) => {
            const snapshot: IdentifierCasePlanSnapshot | null = captureIdentifierCasePlanSnapshot(options);
            // Only attach snapshots that carry meaningful planning state.
            // Empty snapshots (no renameMap and no planGenerated) are common
            // when callers omit a filepath and would otherwise overwrite a
            // previously-captured plan. Guarding here prevents attachment of
            // inert snapshots which strip rename data from downstream printers.
            if (!snapshot || (snapshot.planGenerated !== true && !Core.isMapLike(snapshot.renameMap))) {
                return;
            }

            Object.defineProperty(objectAst, "__identifierCasePlanSnapshot", {
                value: snapshot,
                enumerable: false,
                configurable: true
            });
        },
        () => {}
    );
}

export function teardownIdentifierCaseEnvironment(options) {
    const bootstrap = options?.__identifierCaseProjectIndexBootstrap ?? null;
    disposeBootstrap(bootstrap, options?.logger ?? null);
    try {
        sanitizeBootstrapResult(bootstrap);
    } catch (error) {
        // Defensive: if sanitation throws for unexpected bootstrap shapes or
        // getters with side-effects, log and continue to avoid crashing the
        // caller (printer) during best-effort teardown.
        warnWithReason(
            options?.logger ?? null,
            IDENTIFIER_CASE_LOGGER_NAMESPACE,
            "Failed to sanitize identifier-case bootstrap during teardown",
            error
        );
    }
    deleteIdentifierCaseOption(options, "__identifierCaseProjectIndex");
    deleteIdentifierCaseOption(options, "__identifierCasePlanSnapshot");
    deleteIdentifierCaseOption(options, "__identifierCaseRenameMap");
}
