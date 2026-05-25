import assert from "node:assert/strict";
import test from "node:test";

import {
    applyIdentifierCasePlanSnapshot,
    captureIdentifierCasePlanSnapshot,
    getIdentifierCaseRenameForNode,
    prepareIdentifierCasePlan,
    registerIdentifierCasePlanProvider,
    resetIdentifierCasePlanProvider,
    resolveIdentifierCasePlanService
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
    try {
        registerIdentifierCasePlanProvider(() => ({}) as never);
        assert.throws(() => resolveIdentifierCasePlanService(), /prepareIdentifierCasePlan/);
    } finally {
        resetIdentifierCasePlanProvider();
    }

    // Missing getIdentifierCaseRenameForNode
    try {
        registerIdentifierCasePlanProvider(() => ({ prepareIdentifierCasePlan: async () => {} }) as never);
        assert.throws(() => resolveIdentifierCasePlanService(), /getIdentifierCaseRenameForNode/);
    } finally {
        resetIdentifierCasePlanProvider();
    }

    // Missing captureIdentifierCasePlanSnapshot
    try {
        registerIdentifierCasePlanProvider(
            () =>
                ({
                    prepareIdentifierCasePlan: async () => {},
                    getIdentifierCaseRenameForNode: () => null
                }) as never
        );
        assert.throws(() => resolveIdentifierCasePlanService(), /captureIdentifierCasePlanSnapshot/);
    } finally {
        resetIdentifierCasePlanProvider();
    }

    // Missing applyIdentifierCasePlanSnapshot
    try {
        registerIdentifierCasePlanProvider(
            () =>
                ({
                    prepareIdentifierCasePlan: async () => {},
                    getIdentifierCaseRenameForNode: () => null,
                    captureIdentifierCasePlanSnapshot: () => ({})
                }) as never
        );
        assert.throws(() => resolveIdentifierCasePlanService(), /applyIdentifierCasePlanSnapshot/);
    } finally {
        resetIdentifierCasePlanProvider();
    }

    resetIdentifierCasePlanProvider();
});

void test("resetIdentifierCasePlanProvider restores default service", { concurrency: false }, () => {
    resetIdentifierCasePlanProvider();

    let customLookupCallCount = 0;

    registerIdentifierCasePlanProvider(() => ({
        prepareIdentifierCasePlan: async () => {},
        getIdentifierCaseRenameForNode: () => {
            customLookupCallCount += 1;
            return "CUSTOM_RENAME";
        },
        captureIdentifierCasePlanSnapshot: () => ({}),
        applyIdentifierCasePlanSnapshot: () => {}
    }));

    const customLookupResult = getIdentifierCaseRenameForNode({ type: "Identifier", name: "value" }, {});
    assert.strictEqual(customLookupResult, "CUSTOM_RENAME", "registered provider should control lookup behavior");
    assert.strictEqual(customLookupCallCount, 1, "custom provider should receive lookup calls while registered");

    resetIdentifierCasePlanProvider();
    const afterResetLookupResult = getIdentifierCaseRenameForNode({ type: "Identifier", name: "value" }, {});
    assert.notStrictEqual(afterResetLookupResult, "CUSTOM_RENAME", "reset should restore default lookup behavior");
    assert.strictEqual(
        customLookupCallCount,
        1,
        "reset should stop routing lookups to the previously registered provider"
    );

    resetIdentifierCasePlanProvider();
});

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

    let firstProviderFactoryCallCount = 0;
    let firstProviderLookupCallCount = 0;

    registerIdentifierCasePlanProvider(() => {
        firstProviderFactoryCallCount += 1;
        return {
            prepareIdentifierCasePlan: async () => {},
            getIdentifierCaseRenameForNode: () => {
                firstProviderLookupCallCount += 1;
                return "FIRST";
            },
            captureIdentifierCasePlanSnapshot: () => ({}),
            applyIdentifierCasePlanSnapshot: () => {}
        };
    });

    const firstProviderLookupResult = getIdentifierCaseRenameForNode({ type: "Identifier", name: "value" }, {});
    assert.strictEqual(firstProviderLookupResult, "FIRST");
    assert.strictEqual(firstProviderLookupCallCount, 1, "first provider should serve lookups before replacement");
    getIdentifierCaseRenameForNode({ type: "Identifier", name: "value" }, {});
    assert.strictEqual(firstProviderLookupCallCount, 2, "first provider should continue serving lookups while active");
    assert.strictEqual(firstProviderFactoryCallCount, 1, "provider should be constructed once while cached");

    let secondProviderFactoryCallCount = 0;
    let secondProviderLookupCallCount = 0;

    registerIdentifierCasePlanProvider(() => {
        secondProviderFactoryCallCount += 1;
        return {
            prepareIdentifierCasePlan: async () => {},
            getIdentifierCaseRenameForNode: () => {
                secondProviderLookupCallCount += 1;
                return "SECOND";
            },
            captureIdentifierCasePlanSnapshot: () => ({}),
            applyIdentifierCasePlanSnapshot: () => {}
        };
    });

    const secondProviderLookupResult = getIdentifierCaseRenameForNode({ type: "Identifier", name: "value" }, {});
    assert.strictEqual(secondProviderLookupResult, "SECOND", "lookup should use the most recently registered provider");
    assert.strictEqual(secondProviderLookupCallCount, 1);
    getIdentifierCaseRenameForNode({ type: "Identifier", name: "value" }, {});
    assert.strictEqual(
        secondProviderFactoryCallCount,
        1,
        "replacement provider should initialize once per registration"
    );
    assert.strictEqual(
        firstProviderLookupCallCount,
        2,
        "old provider should no longer receive lookups after replacement"
    );

    resetIdentifierCasePlanProvider();
    const afterResetLookupResult = getIdentifierCaseRenameForNode({ type: "Identifier", name: "value" }, {});
    assert.strictEqual(afterResetLookupResult, null, "reset should route lookups back to default behavior");
    assert.strictEqual(secondProviderLookupCallCount, 2, "reset should stop routing lookups to replacement provider");

    resetIdentifierCasePlanProvider();
});
