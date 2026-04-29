import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Semantic } from "@gmloop/semantic";

async function withTempDir(run) {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gml-bootstrap-"));
    try {
        return await run(tempRoot);
    } finally {
        await rm(tempRoot, { recursive: true, force: true });
    }
}

async function withBootstrapProject(run: (context: { projectRoot: string; scriptPath: string }) => Promise<void>) {
    return withTempDir(async (projectRoot) => {
        const manifestPath = path.join(projectRoot, "project.yyp");
        await writeFile(manifestPath, "{}");
        const scriptsDir = path.join(projectRoot, "scripts");
        await mkdir(scriptsDir, { recursive: true });
        const scriptPath = path.join(scriptsDir, "main.gml");
        await writeFile(scriptPath, "// script\n");

        await run({ projectRoot, scriptPath });
    });
}

function createBootstrapRunCase(
    scriptPath: string,
    createRawValueOverrides: (rawValue: unknown) => Record<string, unknown>
) {
    return async (rawValue: unknown) => {
        const descriptors = [];
        const coordinator = {
            async ensureReady(descriptor) {
                descriptors.push(descriptor);
                return { projectIndex: null, source: null, cache: null };
            },
            dispose() {}
        };

        const options: any = {
            filepath: scriptPath,
            __identifierCaseProjectIndexCoordinator: coordinator,
            ...createRawValueOverrides(rawValue)
        };

        await Semantic.bootstrapProjectIndex(options, null);

        return { options, descriptor: descriptors[0] ?? {} };
    };
}

void test("Semantic.bootstrapProjectIndex normalizes cache max size overrides", async () => {
    await withBootstrapProject(async ({ scriptPath }) => {
        const runCase = createBootstrapRunCase(scriptPath, (rawValue) =>
            rawValue === undefined ? {} : { gmlIdentifierCaseProjectIndexCacheMaxBytes: rawValue }
        );

        {
            const { options, descriptor } = await runCase("16");
            assert.equal(options.__identifierCaseProjectIndexCacheMaxBytes, 16);
            assert.equal(descriptor.cacheMaxSizeBytes, 16);
        }

        {
            const { options, descriptor } = await runCase("0");
            assert.strictEqual(options.__identifierCaseProjectIndexCacheMaxBytes, null);
            assert.strictEqual(descriptor.cacheMaxSizeBytes, null);
        }

        {
            const { options, descriptor } = await runCase(" ");
            assert.equal(Object.hasOwn(options, "__identifierCaseProjectIndexCacheMaxBytes"), false);
            assert.equal("cacheMaxSizeBytes" in descriptor, false);
        }
    });
});

void test("Semantic.bootstrapProjectIndex normalizes concurrency overrides", async () => {
    await withBootstrapProject(async ({ scriptPath }) => {
        const runCase = createBootstrapRunCase(scriptPath, (rawValue) =>
            rawValue === undefined ? {} : { gmlIdentifierCaseProjectIndexConcurrency: rawValue }
        );

        {
            const { options, descriptor } = await runCase("8");
            assert.equal(options.__identifierCaseProjectIndexConcurrency, 8);
            assert.equal(descriptor.buildOptions?.concurrency?.gml, 8);
            assert.equal(descriptor.buildOptions?.concurrency?.gmlParsing, 8);
        }

        {
            const { options, descriptor } = await runCase("64");
            assert.equal(options.__identifierCaseProjectIndexConcurrency, 16);
            assert.equal(descriptor.buildOptions?.concurrency?.gml, 16);
            assert.equal(descriptor.buildOptions?.concurrency?.gmlParsing, 16);
        }

        {
            const { options, descriptor } = await runCase("   ");
            assert.equal(Object.hasOwn(options, "__identifierCaseProjectIndexConcurrency"), false);
            assert.equal(descriptor.buildOptions?.concurrency, undefined);
        }

        await assert.rejects(runCase("0"));
        await assert.rejects(runCase(-2));
    });
});

void test("Semantic.bootstrapProjectIndex records build failures without throwing", async () => {
    await withBootstrapProject(async ({ projectRoot, scriptPath }) => {
        const failure = new Error("index build failed");
        const coordinator = {
            async ensureReady() {
                throw failure;
            },
            dispose() {}
        };

        const options: any = {
            filepath: scriptPath,
            __identifierCaseProjectIndexCoordinator: coordinator
        };

        const result = await Semantic.bootstrapProjectIndex(options, null);

        assert.equal(result.status, "failed");
        assert.equal(result.reason, "build-error");
        assert.equal(result.projectIndex, null);
        assert.equal(result.projectRoot, projectRoot);
        assert.equal(result.error, failure);
        assert.equal(options.__identifierCaseProjectIndexBootstrap, result);
        assert.equal(typeof result.dispose, "function");
    });
});
