/**
 * This test suite verifies that the workspace ownership and dependency policies are correctly enforced across the monorepo workspaces.
 * The tests ensure that the format workspace remains decoupled from the semantic and refactor packages, while the refactor workspace
 * owns the semantic-backed refactor behavior.
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

type DependencyMap = Readonly<Record<string, string>>;

type PackageJson = Readonly<{
    dependencies?: DependencyMap;
    devDependencies?: DependencyMap;
    exports?: Readonly<Record<string, unknown>>;
}>;

const require = createRequire(import.meta.url);

function readWorkspacePackage(workspaceName: string): PackageJson {
    return require(`${workspaceName}/package.json`) as PackageJson;
}

function getDependencyVersion(packageJson: PackageJson, dependencyName: string): string | null {
    const dependencies = packageJson.dependencies ?? {};
    return dependencies[dependencyName] ?? null;
}

function getDevDependencyVersion(packageJson: PackageJson, dependencyName: string): string | null {
    const dependencies = packageJson.devDependencies ?? {};
    return dependencies[dependencyName] ?? null;
}

void describe("workspace ownership dependency policy", () => {
    void it("format workspace remains decoupled from semantic and refactor packages", () => {
        const formatPackage = readWorkspacePackage("@gmloop/format");

        assert.strictEqual(getDependencyVersion(formatPackage, "@gmloop/semantic"), null);
        assert.strictEqual(getDependencyVersion(formatPackage, "@gmloop/refactor"), null);
        assert.strictEqual(getDependencyVersion(formatPackage, "@gmloop/fixture-runner"), null);
        assert.strictEqual(getDevDependencyVersion(formatPackage, "@gmloop/fixture-runner"), "workspace:*");
    });

    void it("refactor workspace is decoupled from semantic via dependency injection", () => {
        const refactorPackage = readWorkspacePackage("@gmloop/refactor");
        const semanticPackage = readWorkspacePackage("@gmloop/semantic");

        assert.strictEqual(
            getDependencyVersion(refactorPackage, "@gmloop/semantic"),
            null,
            "Refactor workspace must not depend on semantic directly; it defines its own abstraction interfaces (PartialSemanticAnalyzer) and accepts implementations via dependency injection."
        );
        assert.strictEqual(
            getDependencyVersion(semanticPackage, "@gmloop/refactor"),
            null,
            "Semantic workspace must remain analysis-only and not depend on refactor."
        );
    });

    void it("fixture-runner depends only on core among local workspaces", () => {
        const fixtureRunnerPackage = readWorkspacePackage("@gmloop/fixture-runner");

        assert.strictEqual(getDependencyVersion(fixtureRunnerPackage, "@gmloop/core"), "workspace:*");
        assert.strictEqual(getDependencyVersion(fixtureRunnerPackage, "@gmloop/format"), null);
        assert.strictEqual(getDependencyVersion(fixtureRunnerPackage, "@gmloop/lint"), null);
        assert.strictEqual(getDependencyVersion(fixtureRunnerPackage, "@gmloop/refactor"), null);
        assert.strictEqual(getDependencyVersion(fixtureRunnerPackage, "@gmloop/semantic"), null);
    });

    void it("workspace packages do not publish test-support subpath exports", () => {
        const formatPackage = readWorkspacePackage("@gmloop/format");
        const lintPackage = readWorkspacePackage("@gmloop/lint");
        const refactorPackage = readWorkspacePackage("@gmloop/refactor");

        assert.strictEqual(formatPackage.exports?.["./test-support"], undefined);
        assert.strictEqual(lintPackage.exports?.["./test-support"], undefined);
        assert.strictEqual(refactorPackage.exports?.["./test-support"], undefined);
    });

    void it("workspace packages keep fixture-runner as a test-only dependency", () => {
        const formatPackage = readWorkspacePackage("@gmloop/format");
        const lintPackage = readWorkspacePackage("@gmloop/lint");
        const refactorPackage = readWorkspacePackage("@gmloop/refactor");

        assert.strictEqual(getDependencyVersion(formatPackage, "@gmloop/fixture-runner"), null);
        assert.strictEqual(getDependencyVersion(lintPackage, "@gmloop/fixture-runner"), null);
        assert.strictEqual(getDependencyVersion(refactorPackage, "@gmloop/fixture-runner"), null);
        assert.strictEqual(getDevDependencyVersion(formatPackage, "@gmloop/fixture-runner"), "workspace:*");
        assert.strictEqual(getDevDependencyVersion(lintPackage, "@gmloop/fixture-runner"), "workspace:*");
        assert.strictEqual(getDevDependencyVersion(refactorPackage, "@gmloop/fixture-runner"), "workspace:*");
    });
});
