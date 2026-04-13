import { Core } from "@gmloop/core";

// The asset rename mechanism (filesystem mutations, logging, metrics) depends
// on this policy object to decide if it should run. Keeping the rules beside
// the asset rename workflow makes the dependency obvious and keeps the broader
// identifier-case root focused on cross-cutting orchestration concerns.

type AssetRenamePolicyContext = {
    options?: Record<string, unknown>;
    projectIndex?: unknown;
    assetRenames?: Array<unknown>;
    assetConflicts?: Array<unknown>;
};

type AssetRenamePolicyResult = {
    shouldApply: boolean;
    reason: string;
    renames: Array<unknown>;
    conflicts: Array<unknown>;
};

const IdentifierCaseAssetRenamePolicyReason = Object.freeze({
    DRY_RUN_ENABLED: "dry-run-enabled",
    NO_RENAMES: "no-renames",
    HAS_CONFLICTS: "has-conflicts",
    MISSING_PROJECT_INDEX: "missing-project-index",
    ALREADY_APPLIED: "already-applied",
    APPLY: "apply"
});

const EMPTY_RENAMES: Array<unknown> = [];
const EMPTY_CONFLICTS: Array<unknown> = [];

function buildPolicyResult({
    reason,
    shouldApply = false,
    renames = EMPTY_RENAMES,
    conflicts = EMPTY_CONFLICTS
}: {
    reason: string;
    shouldApply?: boolean;
    renames?: Array<unknown>;
    conflicts?: Array<unknown>;
}): AssetRenamePolicyResult {
    return { shouldApply, reason, renames, conflicts };
}

export function evaluateIdentifierCaseAssetRenamePolicy(context: AssetRenamePolicyContext = {}) {
    const { options = {}, projectIndex = null, assetRenames = [], assetConflicts = [] } = context;

    const renames = Core.asArray(assetRenames);
    const conflicts = Core.asArray(assetConflicts);

    if (options?.__identifierCaseDryRun !== false) {
        return buildPolicyResult({ reason: IdentifierCaseAssetRenamePolicyReason.DRY_RUN_ENABLED });
    }

    if (!Core.isNonEmptyArray(renames)) {
        return buildPolicyResult({ reason: IdentifierCaseAssetRenamePolicyReason.NO_RENAMES });
    }

    if (Core.isNonEmptyArray(conflicts)) {
        return buildPolicyResult({
            reason: IdentifierCaseAssetRenamePolicyReason.HAS_CONFLICTS,
            conflicts
        });
    }

    if (!projectIndex) {
        return buildPolicyResult({
            reason: IdentifierCaseAssetRenamePolicyReason.MISSING_PROJECT_INDEX,
            renames
        });
    }

    if (options?.__identifierCaseAssetRenamesApplied === true) {
        return buildPolicyResult({
            reason: IdentifierCaseAssetRenamePolicyReason.ALREADY_APPLIED,
            renames
        });
    }

    return buildPolicyResult({
        reason: IdentifierCaseAssetRenamePolicyReason.APPLY,
        shouldApply: true,
        renames
    });
}

export { IdentifierCaseAssetRenamePolicyReason };
