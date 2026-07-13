import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
    buildProjectIndex,
    createProjectIndexCoordinator,
    publishBuiltProjectIndex,
    resolveSemanticImpactFilePaths
} from "../src/project-index/builder.js";
import { openSemanticIndexStore } from "../src/project-index/semantic-store.js";

void test("project coordinator restores only an exact canonical manifest revision", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-project-coordinator-cache-"));
    const scriptPath = path.join(projectRoot, "scripts/example/example.gml");
    try {
        await mkdir(path.dirname(scriptPath), { recursive: true });
        await writeFile(
            path.join(projectRoot, "Game.yyp"),
            JSON.stringify({ name: "Game", resourceType: "GMProject" })
        );
        await writeFile(
            path.join(projectRoot, "scripts/example/example.yy"),
            JSON.stringify({ name: "example", resourceType: "GMScript" })
        );
        await writeFile(scriptPath, "function first() { return 1; }");

        const coldCoordinator = createProjectIndexCoordinator();
        const cold = await coldCoordinator.ensureReady({ projectRoot });
        assert.equal(cold.source, "build");
        coldCoordinator.dispose();

        const warmCoordinator = createProjectIndexCoordinator();
        const warm = await warmCoordinator.ensureReady({ projectRoot });
        assert.equal(warm.source, "store");
        warmCoordinator.dispose();

        await writeFile(scriptPath, "function other() { return 1; }");
        const changedCoordinator = createProjectIndexCoordinator();
        const changed = await changedCoordinator.ensureReady({ projectRoot });
        assert.equal(changed.source, "build", "same-size source edits must invalidate the persisted full revision");
        changedCoordinator.dispose();
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("semantic impact resolution includes only changed files and immediate dependents", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-project-impact-set-"));
    const ownerPath = path.join(projectRoot, "scripts/target/target.gml");
    const dependentPath = path.join(projectRoot, "scripts/dependent/dependent.gml");
    const unrelatedPath = path.join(projectRoot, "scripts/unrelated/unrelated.gml");
    const unresolvedPath = path.join(projectRoot, "scripts/z_candidate/z_candidate.gml");
    try {
        await mkdir(path.dirname(ownerPath), { recursive: true });
        await mkdir(path.dirname(dependentPath), { recursive: true });
        await mkdir(path.dirname(unrelatedPath), { recursive: true });
        await mkdir(path.dirname(unresolvedPath), { recursive: true });
        await writeFile(
            path.join(projectRoot, "Game.yyp"),
            JSON.stringify({ name: "Game", resourceType: "GMProject" })
        );
        await writeFile(
            path.join(projectRoot, "scripts/target/target.yy"),
            JSON.stringify({ name: "target", resourceType: "GMScript" })
        );
        await writeFile(
            path.join(projectRoot, "scripts/dependent/dependent.yy"),
            JSON.stringify({ name: "dependent", resourceType: "GMScript" })
        );
        await writeFile(
            path.join(projectRoot, "scripts/unrelated/unrelated.yy"),
            JSON.stringify({ name: "unrelated", resourceType: "GMScript" })
        );
        await writeFile(
            path.join(projectRoot, "scripts/z_candidate/z_candidate.yy"),
            JSON.stringify({ name: "z_candidate", resourceType: "GMScript" })
        );
        await writeFile(ownerPath, "return 1;");
        await writeFile(dependentPath, "target();");
        await writeFile(unrelatedPath, "function unrelated() { return 2; }");
        await writeFile(unresolvedPath, "future_target();");
        const projectIndex = await buildProjectIndex(projectRoot);
        await publishBuiltProjectIndex(projectRoot, projectIndex);

        const impactedFiles = await resolveSemanticImpactFilePaths(projectRoot, [ownerPath], []);

        assert.deepEqual(impactedFiles, [ownerPath, dependentPath]);
        assert.deepEqual(await resolveSemanticImpactFilePaths(projectRoot, [ownerPath], ["future_target"]), [
            ownerPath,
            dependentPath,
            unresolvedPath
        ]);
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("semantic-owned publication writes matching definitions and full slots", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-project-publication-owner-"));
    const scriptPath = path.join(projectRoot, "main.gml");
    try {
        await writeFile(scriptPath, "function main() { return 1; }");
        const projectIndex = await buildProjectIndex(projectRoot);

        await publishBuiltProjectIndex(projectRoot, projectIndex);

        const store = openSemanticIndexStore(projectRoot);
        try {
            const slots = store.readActiveSemanticSlots();
            assert.equal(slots.hasMatchingFull, true);
            assert.equal(slots.definitions?.sourceSignature, slots.full?.sourceSignature);
            assert.equal(
                store.readSemanticSnapshot("definitions")?.occurrences.every(({ role }) => role === "definition"),
                true
            );
            assert.ok(store.readSemanticSnapshot("full"));
        } finally {
            await store.close();
        }
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});

void test("semantic impact resolution uses lexical fallback for dependency cycles", async () => {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-project-impact-cycle-"));
    const alphaPath = path.join(projectRoot, "scripts/alpha/alpha.gml");
    const betaPath = path.join(projectRoot, "scripts/beta/beta.gml");
    try {
        await mkdir(path.dirname(alphaPath), { recursive: true });
        await mkdir(path.dirname(betaPath), { recursive: true });
        await writeFile(
            path.join(projectRoot, "Game.yyp"),
            JSON.stringify({ name: "Game", resourceType: "GMProject" })
        );
        await writeFile(
            path.join(projectRoot, "scripts/alpha/alpha.yy"),
            JSON.stringify({ name: "alpha", resourceType: "GMScript" })
        );
        await writeFile(
            path.join(projectRoot, "scripts/beta/beta.yy"),
            JSON.stringify({ name: "beta", resourceType: "GMScript" })
        );
        await writeFile(alphaPath, "beta();");
        await writeFile(betaPath, "alpha();");
        await publishBuiltProjectIndex(projectRoot, await buildProjectIndex(projectRoot));

        assert.deepEqual(await resolveSemanticImpactFilePaths(projectRoot, [alphaPath], []), [alphaPath, betaPath]);
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
});
