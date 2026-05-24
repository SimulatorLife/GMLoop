import assert from "node:assert/strict";
import test from "node:test";

import {
    applyIdentifierCasePlanSnapshot,
    captureIdentifierCasePlanSnapshot,
    getIdentifierCaseRenameForNode,
    prepareIdentifierCasePlan,
    registerIdentifierCasePlanPreparationProvider,
    registerIdentifierCasePlanProvider,
    registerIdentifierCasePlanSnapshotApplyProvider,
    registerIdentifierCasePlanSnapshotCaptureProvider,
    registerIdentifierCaseRenameLookupProvider,
    resetIdentifierCasePlanProvider,
    resetIdentifierCasePlanServiceProvider,
    resolveIdentifierCasePlanPreparationService,
    resolveIdentifierCasePlanRenameLookupService,
    resolveIdentifierCasePlanService,
    resolveIdentifierCasePlanSnapshotApplyService,
    resolveIdentifierCasePlanSnapshotCaptureService
} from "../src/identifier-case/plan-service.js";

void test("identifier case plan service exposes unified contract with 4 methods", { concurrency: false }, () => {
    resetIdentifierCasePlanProvider();
    const service = resolveIdentifierCasePlanService();

    assert.ok(Object.isFrozen(service), "plan service should be frozen");
    assert.deepStrictEqual(
        Object.keys(service),
        [
            "prepareIdentifierCasePlan",
            "getIdentifierCaseRenameForNode",
            "captureIdentifierCasePlanSnapshot",
            "applyIdentifierCasePlanSnapshot"
        ],
        "service should expose all four plan helpers"
    );

    // Verify each method is callable
    assert.strictEqual(typeof service.prepareIdentifierCasePlan, "function");
    assert.strictEqual(typeof service.getIdentifierCaseRenameForNode, "function");
    assert.strictEqual(typeof service.captureIdentifierCasePlanSnapshot, "function");
    assert.strictEqual(typeof service.applyIdentifierCasePlanSnapshot, "function");

    resetIdentifierCasePlanProvider();
});

void test("identifier case plan service resolver aliases return same service instance", { concurrency: false }, () => {
    resetIdentifierCasePlanProvider();
    const unified = resolveIdentifierCasePlanService();

    // All alias resolvers should return the same service
    assert.strictEqual(
        resolveIdentifierCasePlanPreparationService(),
        unified,
        "preparation resolver should return same instance"
    );
    assert.strictEqual(
        resolveIdentifierCasePlanRenameLookupService(),
        unified,
        "rename lookup resolver should return same instance"
    );
    assert.strictEqual(
        resolveIdentifierCasePlanSnapshotCaptureService(),
        unified,
        "snapshot capture resolver should return same instance"
    );
    assert.strictEqual(
        resolveIdentifierCasePlanSnapshotApplyService(),
        unified,
        "snapshot apply resolver should return same instance"
    );

    resetIdentifierCasePlanProvider();
});

void test("identifier case plan helpers delegate through unified service", { concurrency: false }, async () => {
    resetIdentifierCasePlanProvider();
    const calls = [];

    // Capture the default service to delegate to in the wrapper
    const defaultService = resolveIdentifierCasePlanService();

    registerIdentifierCasePlanProvider(() => ({
        async prepareIdentifierCasePlan(options) {
            calls.push({ type: "prepare", options });
            return defaultService.prepareIdentifierCasePlan(options);
        },
        getIdentifierCaseRenameForNode(node, options) {
            calls.push({ type: "rename", node, options });
            return defaultService.getIdentifierCaseRenameForNode(node, options);
        },
        captureIdentifierCasePlanSnapshot(options) {
            calls.push({ type: "capture", options });
            return defaultService.captureIdentifierCasePlanSnapshot(options);
        },
        applyIdentifierCasePlanSnapshot(snapshot, options) {
            calls.push({ type: "apply", snapshot, options });
            return defaultService.applyIdentifierCasePlanSnapshot(snapshot, options);
        }
    }));

    try {
        await prepareIdentifierCasePlan({ flag: "prepare" });
        getIdentifierCaseRenameForNode({ type: "Identifier", name: "value" }, { flag: "rename" });

        const snapshot = captureIdentifierCasePlanSnapshot({ flag: "capture" });
        applyIdentifierCasePlanSnapshot(snapshot, { flag: "apply" });

        assert.deepStrictEqual(
            calls.map((entry) => entry.type),
            ["prepare", "rename", "capture", "apply"]
        );
        assert.strictEqual(calls[0].options.flag, "prepare");
        assert.deepStrictEqual(calls[1].node, { type: "Identifier", name: "value" });
        assert.strictEqual(calls[1].options.flag, "rename");
        assert.strictEqual(calls[2].options.flag, "capture");
        assert.strictEqual(calls[3].snapshot, snapshot);
        assert.strictEqual(calls[3].options.flag, "apply");
    } finally {
        resetIdentifierCasePlanProvider();
    }
});

void test("identifier case plan provider validates all 4 required service methods", { concurrency: false }, () => {
    resetIdentifierCasePlanProvider();

    // Missing prepareIdentifierCasePlan
    assert.throws(() => registerIdentifierCasePlanProvider(() => ({}) as never), /prepareIdentifierCasePlan function/);

    // Missing getIdentifierCaseRenameForNode
    assert.throws(
        () => registerIdentifierCasePlanProvider(() => ({ prepareIdentifierCasePlan: async () => {} }) as never),
        /getIdentifierCaseRenameForNode function/
    );

    // Missing captureIdentifierCasePlanSnapshot
    assert.throws(
        () =>
            registerIdentifierCasePlanProvider(
                () =>
                    ({
                        prepareIdentifierCasePlan: async () => {},
                        getIdentifierCaseRenameForNode: () => null
                    }) as never
            ),
        /captureIdentifierCasePlanSnapshot function/
    );

    // Missing applyIdentifierCasePlanSnapshot
    assert.throws(
        () =>
            registerIdentifierCasePlanProvider(
                () =>
                    ({
                        prepareIdentifierCasePlan: async () => {},
                        getIdentifierCaseRenameForNode: () => null,
                        captureIdentifierCasePlanSnapshot: () => ({})
                    }) as never
            ),
        /applyIdentifierCasePlanSnapshot function/
    );

    resetIdentifierCasePlanProvider();
});

void test("resetIdentifierCasePlanProvider restores default service", { concurrency: false }, () => {
    resetIdentifierCasePlanProvider();
    const before = resolveIdentifierCasePlanService();

    registerIdentifierCasePlanProvider(() => ({
        prepareIdentifierCasePlan: async () => {},
        getIdentifierCaseRenameForNode: () => null,
        captureIdentifierCasePlanSnapshot: () => ({}),
        applyIdentifierCasePlanSnapshot: () => {}
    }));

    const during = resolveIdentifierCasePlanService();
    assert.notStrictEqual(during, before, "service should change after registering a custom provider");

    resetIdentifierCasePlanProvider();
    const after = resolveIdentifierCasePlanService();
    assert.strictEqual(after, before, "service should be restored to default after reset");

    resetIdentifierCasePlanProvider();
});

void test("legacy segregated provider APIs still work via unified provider", { concurrency: false }, async () => {
    resetIdentifierCasePlanProvider();
    const calls = [];
    const defaultService = resolveIdentifierCasePlanService();

    // Legacy segregated providers wrap their partial implementation and
    // delegate the rest to the default service
    registerIdentifierCasePlanPreparationProvider(() => ({
        prepareIdentifierCasePlan: async (options) => {
            calls.push({ type: "legacy-prepare", options });
            return defaultService.prepareIdentifierCasePlan(options);
        }
    }));

    registerIdentifierCaseRenameLookupProvider(() => ({
        getIdentifierCaseRenameForNode: (node, options) => {
            calls.push({ type: "legacy-lookup", node, options });
            return defaultService.getIdentifierCaseRenameForNode(node, options);
        }
    }));

    registerIdentifierCasePlanSnapshotCaptureProvider(() => ({
        captureIdentifierCasePlanSnapshot: (options) => {
            calls.push({ type: "legacy-capture", options });
            return defaultService.captureIdentifierCasePlanSnapshot(options);
        }
    }));

    registerIdentifierCasePlanSnapshotApplyProvider(() => ({
        applyIdentifierCasePlanSnapshot: (snapshot, options) => {
            calls.push({ type: "legacy-apply", snapshot, options });
            return defaultService.applyIdentifierCasePlanSnapshot(snapshot, options);
        }
    }));

    try {
        // Verify the legacy providers are still functional
        await prepareIdentifierCasePlan({ flag: "legacy-prepare" });
        getIdentifierCaseRenameForNode({ type: "Identifier", name: "value" }, { flag: "legacy-lookup" });
        const snapshot = captureIdentifierCasePlanSnapshot({ flag: "legacy-capture" });
        applyIdentifierCasePlanSnapshot(snapshot, { flag: "legacy-apply" });

        assert.deepStrictEqual(
            calls.map((entry) => entry.type),
            ["legacy-prepare", "legacy-lookup", "legacy-capture", "legacy-apply"]
        );
    } finally {
        resetIdentifierCasePlanProvider();
    }
});

void test(
    "resetIdentifierCasePlanServiceProvider aliases resetIdentifierCasePlanProvider",
    { concurrency: false },
    () => {
        resetIdentifierCasePlanServiceProvider();
        const before = resolveIdentifierCasePlanService();

        registerIdentifierCasePlanProvider(() => ({
            prepareIdentifierCasePlan: async () => {},
            getIdentifierCaseRenameForNode: () => null,
            captureIdentifierCasePlanSnapshot: () => ({}),
            applyIdentifierCasePlanSnapshot: () => {}
        }));

        resetIdentifierCasePlanServiceProvider();
        const after = resolveIdentifierCasePlanService();
        assert.strictEqual(
            after,
            before,
            "resetIdentifierCasePlanServiceProvider should alias resetIdentifierCasePlanProvider"
        );

        resetIdentifierCasePlanProvider();
    }
);

void test("service caching avoids repeated normalization", { concurrency: false }, () => {
    resetIdentifierCasePlanProvider();
    const calls: unknown[] = [];

    // Register a provider that logs each invocation
    registerIdentifierCasePlanProvider(() => {
        calls.push("provider-call");
        return {
            prepareIdentifierCasePlan: async () => {},
            getIdentifierCaseRenameForNode: () => null,
            captureIdentifierCasePlanSnapshot: () => ({}),
            applyIdentifierCasePlanSnapshot: () => {}
        };
    });

    // First resolve should call the provider
    resolveIdentifierCasePlanService();
    assert.deepStrictEqual(calls, ["provider-call"], "first resolve should invoke the provider");

    // Subsequent resolves should return cached service
    resolveIdentifierCasePlanService();
    resolveIdentifierCasePlanService();
    assert.deepStrictEqual(calls, ["provider-call"], "subsequent resolves should use cached service");

    resetIdentifierCasePlanProvider();
});

void test("registering new provider invalidates cached service", { concurrency: false }, () => {
    resetIdentifierCasePlanProvider();
    const first = resolveIdentifierCasePlanService();

    registerIdentifierCasePlanProvider(() => ({
        prepareIdentifierCasePlan: async () => {},
        getIdentifierCaseRenameForNode: () => null,
        captureIdentifierCasePlanSnapshot: () => ({}),
        applyIdentifierCasePlanSnapshot: () => {}
    }));

    const second = resolveIdentifierCasePlanService();
    assert.notStrictEqual(second, first, "new provider should create a different cached service");

    resetIdentifierCasePlanProvider();
    const third = resolveIdentifierCasePlanService();
    assert.strictEqual(third, first, "reset should restore the original cached service");

    resetIdentifierCasePlanProvider();
});

void test("unified provider receives all four methods from legacy registration", { concurrency: false }, async () => {
    resetIdentifierCasePlanProvider();
    const capturedServices: unknown[] = [];

    // Intercept the normalized service by providing a wrapper that captures it
    registerIdentifierCasePlanProvider(
        (() => {
            const originalDefault = {
                prepareIdentifierCasePlan: async () => {},
                getIdentifierCaseRenameForNode: () => null,
                captureIdentifierCasePlanSnapshot: () => ({}),
                applyIdentifierCasePlanSnapshot: () => {}
            };
            return () => {
                capturedServices.push("provider");
                return originalDefault;
            };
        })()
    );

    try {
        // Trigger resolution
        resolveIdentifierCasePlanService();
        assert.deepStrictEqual(capturedServices, ["provider"], "provider should be called");
    } finally {
        resetIdentifierCasePlanProvider();
    }
});
