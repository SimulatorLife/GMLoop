/**
 * Legacy fixture case IDs excluded from aggregate fixture gating while their
 * golden expectations are migrated to the current formatter/lint architecture.
 */
export const LEGACY_FIXTURE_CASE_IDS_BY_WORKSPACE = Object.freeze({
    format: Object.freeze([]),
    integration: Object.freeze([])
});

export const INTEGRATION_LEGACY_CASE_IDS = LEGACY_FIXTURE_CASE_IDS_BY_WORKSPACE.integration;
