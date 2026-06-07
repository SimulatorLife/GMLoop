/**
 * Legacy fixture case IDs excluded from aggregate fixture gating while their
 * golden expectations are migrated to the current formatter/lint architecture.
 */
export const LEGACY_FIXTURE_CASE_IDS_BY_WORKSPACE = Object.freeze({
    format: Object.freeze(["test-argument-docs", "test-banner", "test-preserve"]),
    integration: Object.freeze([
        "test-int-doc-banner",
        "test-int-flow-hoist",
        "test-int-format-strings",
        "test-int-func-rules",
        "test-int-logic-flow",
        "test-int-manual-math",
        "test-int-math-docs",
        "test-int-math-nested",
        "test-int-ops-logic"
    ])
});

export const INTEGRATION_LEGACY_CASE_IDS = Object.freeze([
    ...LEGACY_FIXTURE_CASE_IDS_BY_WORKSPACE.integration,
    "test-int-comments-ops",
    "test-int-func-desc-docs",
    "test-int-struct-literal"
]);
