import assert from "node:assert/strict";
import test from "node:test";

import {
    applyIdentifierCasePlanSnapshot,
    captureIdentifierCasePlanSnapshot,
    getIdentifierCaseRenameForNode,
    prepareIdentifierCasePlan,
    registerIdentifierCasePlanPreparationProvider,
    registerIdentifierCasePlanSnapshotApplyProvider,
    registerIdentifierCasePlanSnapshotCaptureProvider,
    registerIdentifierCaseRenameLookupProvider,
    resetIdentifierCasePlanServiceProvider,
    resolveIdentifierCasePlanPreparationService,
    resolveIdentifierCasePlanSnapshotApplyService,
    resolveIdentifierCasePlanSnapshotCaptureService,
    resolveIdentifierCaseRenameLookupService
} from "../src/identifier-case/plan-service.js";

void test("identifier case plan services expose segregated contracts", { concurrency: false }, () => {
    resetIdentifierCasePlanServiceProvider();
    const preparation = resolveIdentifierCasePlanPreparationService();
    const renameLookup = resolveIdentifierCaseRenameLookupService();
    const snapshotCapture = resolveIdentifierCasePlanSnapshotCaptureService();
    const snapshotApply = resolveIdentifierCasePlanSnapshotApplyService();

    assert.ok(Object.isFrozen(preparation), "preparation service should be frozen");
    assert.deepStrictEqual(
        Object.keys(preparation),
        ["prepareIdentifierCasePlan"],
        "preparation service should only expose plan preparation"
    );

    assert.ok(Object.isFrozen(renameLookup), "rename lookup service should be frozen");
    assert.deepStrictEqual(
        Object.keys(renameLookup),
        ["getIdentifierCaseRenameForNode"],
        "rename lookup service should only expose rename lookups"
    );

    assert.ok(Object.isFrozen(snapshotCapture), "snapshot capture service should be frozen");
    assert.deepStrictEqual(
        Object.keys(snapshotCapture),
        ["captureIdentifierCasePlanSnapshot"],
        "snapshot capture service should only expose capture helper"
    );

    assert.ok(Object.isFrozen(snapshotApply), "snapshot apply service should be frozen");
    assert.deepStrictEqual(
        Object.keys(snapshotApply),
        ["applyIdentifierCasePlanSnapshot"],
        "snapshot apply service should only expose apply helper"
    );

    resetIdentifierCasePlanServiceProvider();
});

void test("identifier case plan helpers delegate through segregated services", { concurrency: false }, async () => {
    const calls = [];

    const defaultPreparation = resolveIdentifierCasePlanPreparationService();
    const defaultRenameLookup = resolveIdentifierCaseRenameLookupService();
    const defaultSnapshotCapture = resolveIdentifierCasePlanSnapshotCaptureService();
    const defaultSnapshotApply = resolveIdentifierCasePlanSnapshotApplyService();

    registerIdentifierCasePlanPreparationProvider(() => ({
        async prepareIdentifierCasePlan(options) {
            calls.push({ type: "prepare", options });
            return defaultPreparation.prepareIdentifierCasePlan(options);
        }
    }));

    registerIdentifierCaseRenameLookupProvider(() => ({
        getIdentifierCaseRenameForNode(node, options) {
            calls.push({ type: "rename", node, options });
            return defaultRenameLookup.getIdentifierCaseRenameForNode(node, options);
        }
    }));

    registerIdentifierCasePlanSnapshotCaptureProvider(() => ({
        captureIdentifierCasePlanSnapshot(options) {
            calls.push({ type: "capture", options });
            return defaultSnapshotCapture.captureIdentifierCasePlanSnapshot(options);
        }
    }));

    registerIdentifierCasePlanSnapshotApplyProvider(() => ({
        applyIdentifierCasePlanSnapshot(snapshot, options) {
            calls.push({ type: "apply", snapshot, options });
            defaultSnapshotApply.applyIdentifierCasePlanSnapshot(snapshot, options);
        }
    }));

    try {
        await prepareIdentifierCasePlan({ flag: "prepare" });
        getIdentifierCaseRenameForNode({ type: "Identifier", name: "value" }, { flag: "rename" });

        const snapshot = captureIdentifierCasePlanSnapshot({
            flag: "capture"
        });

        applyIdentifierCasePlanSnapshot(snapshot, { flag: "apply" });

        assert.deepStrictEqual(
            calls.map((entry) => entry.type),
            ["prepare", "rename", "capture", "apply"]
        );
        assert.strictEqual(calls[0].options.flag, "prepare");
        assert.deepStrictEqual(calls[1].node, {
            type: "Identifier",
            name: "value"
        });
        assert.strictEqual(calls[1].options.flag, "rename");
        assert.strictEqual(calls[2].options.flag, "capture");
        assert.strictEqual(calls[3].snapshot, snapshot);
        assert.strictEqual(calls[3].options.flag, "apply");
    } finally {
        resetIdentifierCasePlanServiceProvider();
    }
});

void test("identifier case plan service providers validate required service methods", { concurrency: false }, () => {
    resetIdentifierCasePlanServiceProvider();

    registerIdentifierCasePlanPreparationProvider(() => ({}) as never);
    assert.throws(() => resolveIdentifierCasePlanPreparationService(), /prepareIdentifierCasePlan function/);

    registerIdentifierCaseRenameLookupProvider(() => ({}) as never);
    assert.throws(() => resolveIdentifierCaseRenameLookupService(), /getIdentifierCaseRenameForNode function/);

    registerIdentifierCasePlanSnapshotCaptureProvider(() => ({}) as never);
    assert.throws(
        () => resolveIdentifierCasePlanSnapshotCaptureService(),
        /captureIdentifierCasePlanSnapshot function/
    );

    registerIdentifierCasePlanSnapshotApplyProvider(() => ({}) as never);
    assert.throws(() => resolveIdentifierCasePlanSnapshotApplyService(), /applyIdentifierCasePlanSnapshot function/);

    resetIdentifierCasePlanServiceProvider();
});
