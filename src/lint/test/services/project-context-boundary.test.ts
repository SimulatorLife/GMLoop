import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import * as LintWorkspace from "../../src/index.js";

function resolveLintWorkspaceRoot(): string {
    const currentDirectory = fileURLToPath(new URL(".", import.meta.url));
    if (currentDirectory.includes(`${path.sep}dist${path.sep}`)) {
        return path.resolve(currentDirectory, "..", "..", "..");
    }

    return path.resolve(currentDirectory, "..", "..");
}

void test("lint services no longer expose project-aware analysis helpers", () => {
    const forbiddenServiceNames = [
        "createProjectAnalysisSnapshotFromProjectIndex",
        "createPrebuiltProjectAnalysisProvider",
        "createProjectLintContextRegistry",
        "createProjectSettingsFromRegistry",
        "createMissingContextSettings",
        "defaultProjectIndexExcludes",
        "resolveNearestProjectRoot",
        "resolveForcedProjectRoot",
        "projectConfig"
    ];

    for (const serviceName of forbiddenServiceNames) {
        assert.equal(
            serviceName in LintWorkspace.Lint.services,
            false,
            `Lint.services must not expose ${serviceName}; project-aware analysis belongs in @gmloop/refactor.`
        );
    }
});

void test("lint workspace retains only single-file-safe service exports", () => {
    assert.equal("featherManifest" in LintWorkspace.Lint.services, true);
    assert.equal("performanceOverrideRuleIds" in LintWorkspace.Lint.services, true);
});

void test("lint source tree no longer contains retired project-aware helper modules", () => {
    const lintWorkspaceRoot = resolveLintWorkspaceRoot();
    const retiredSourceFiles = [
        path.join(lintWorkspaceRoot, "src", "services", "project-analysis-provider.ts"),
        path.join(lintWorkspaceRoot, "src", "services", "project-root.ts"),
        path.join(lintWorkspaceRoot, "src", "types", "index.ts")
    ];

    for (const retiredSourceFile of retiredSourceFiles) {
        assert.equal(
            existsSync(retiredSourceFile),
            false,
            `Retired lint project-aware helper should not exist: ${retiredSourceFile}`
        );
    }
});
