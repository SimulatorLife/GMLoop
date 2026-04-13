import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Refactor, type RefactorProjectConfig } from "@gmloop/refactor";

import { GmlSemanticBridge } from "../src/modules/refactor/semantic-bridge.js";
import { measureMedianDurationMs } from "./test-helpers/refactor-top-level-naming-performance.js";

const FILE_COUNT = 60;
const LOCAL_DECLARATION_COUNT = 120;
const PERFORMANCE_THRESHOLD_MS = 350;

type LocalNamingFixture = {
    files: Record<string, { declarations: Array<Record<string, unknown>>; references: Array<Record<string, unknown>> }>;
    projectRoot: string;
    scopes: Record<string, { kind: string }>;
    sourceTexts: Map<string, string>;
};

function createLocalVariableNamingConventionConfig(): RefactorProjectConfig {
    return {
        codemods: {
            namingConvention: {
                rules: {
                    localVariable: {
                        caseStyle: "camel"
                    }
                }
            }
        }
    };
}

async function createDiskBackedLocalNamingFixture(): Promise<LocalNamingFixture> {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-refactor-local-perf-"));
    const files: LocalNamingFixture["files"] = {};
    const scopes: LocalNamingFixture["scopes"] = {};
    const sourceTexts = new Map<string, string>();

    for (let fileIndex = 0; fileIndex < FILE_COUNT; fileIndex += 1) {
        const filePath = `scripts/file_${fileIndex}.gml`;
        const absoluteFilePath = path.join(projectRoot, filePath);
        await mkdir(path.dirname(absoluteFilePath), { recursive: true });

        const declarations: Array<Record<string, unknown>> = [];
        const references: Array<Record<string, unknown>> = [];
        const lines: Array<string> = [];
        let offset = 0;

        for (let declarationIndex = 0; declarationIndex < LOCAL_DECLARATION_COUNT; declarationIndex += 1) {
            const scopeId = `scope:${fileIndex}:${declarationIndex}`;
            const name = `bad_name_${fileIndex}_${declarationIndex}`;
            const declarationLine = `var ${name} = ${declarationIndex};\n`;
            const directReferenceLine = `${name} += 1;\n`;
            const memberReferenceLine = `self.${name} += 1;\n`;
            const declarationStart = offset + declarationLine.indexOf(name);
            const directReferenceStart = offset + declarationLine.length + directReferenceLine.indexOf(name);
            const memberReferenceStart =
                offset + declarationLine.length + directReferenceLine.length + memberReferenceLine.indexOf(name);

            scopes[scopeId] = { kind: "function" };
            declarations.push({
                name,
                scopeId,
                start: { index: declarationStart },
                end: { index: declarationStart + name.length - 1 },
                classifications: ["variable"]
            });
            references.push(
                {
                    name,
                    scopeId,
                    declaration: {
                        name,
                        scopeId,
                        start: { index: declarationStart }
                    },
                    start: { index: directReferenceStart },
                    end: { index: directReferenceStart + name.length - 1 },
                    classifications: ["variable"]
                },
                {
                    name,
                    scopeId,
                    declaration: {
                        name,
                        scopeId,
                        start: { index: declarationStart }
                    },
                    start: { index: memberReferenceStart },
                    end: { index: memberReferenceStart + name.length - 1 },
                    classifications: ["variable"]
                }
            );

            lines.push(declarationLine, directReferenceLine, memberReferenceLine);
            offset += declarationLine.length + directReferenceLine.length + memberReferenceLine.length;
        }

        const sourceText = lines.join("");
        await writeFile(absoluteFilePath, sourceText, "utf8");
        sourceTexts.set(filePath, sourceText);
        files[filePath] = { declarations, references };
    }

    return { files, projectRoot, scopes, sourceTexts };
}

async function executeLocalNamingCodemod(fixture: LocalNamingFixture) {
    const semantic = new GmlSemanticBridge(
        {
            files: fixture.files,
            scopes: fixture.scopes,
            identifiers: {},
            resources: {}
        },
        fixture.projectRoot
    );
    const instrumentedSemantic = semantic as unknown as {
        getLocalReferenceOccurrences: (
            filePath: string,
            fileRecord: Record<string, unknown>
        ) => ReadonlyMap<string, Array<Record<string, unknown>>>;
    };
    const originalGetLocalReferenceOccurrences =
        instrumentedSemantic.getLocalReferenceOccurrences.bind(instrumentedSemantic);
    let getLocalReferenceOccurrencesCallCount = 0;

    instrumentedSemantic.getLocalReferenceOccurrences = (filePath, fileRecord) => {
        getLocalReferenceOccurrencesCallCount += 1;
        return originalGetLocalReferenceOccurrences(filePath, fileRecord);
    };
    const engine = new Refactor.RefactorEngine({ semantic });
    const result = await engine.executeConfiguredCodemods({
        projectRoot: fixture.projectRoot,
        targetPaths: [fixture.projectRoot],
        gmlFilePaths: [...fixture.sourceTexts.keys()],
        config: createLocalVariableNamingConventionConfig(),
        readFile: async (filePath) => fixture.sourceTexts.get(filePath) ?? "",
        dryRun: true,
        onlyCodemods: ["namingConvention"]
    });

    return {
        getLocalReferenceOccurrencesCallCount,
        result
    };
}

void test("refactor local naming codemod keeps real-file local scans within the disk-backed threshold", async () => {
    const fixture = await createDiskBackedLocalNamingFixture();

    try {
        const { durationMs, result } = await measureMedianDurationMs(3, () => executeLocalNamingCodemod(fixture));
        const rewrittenFirstFile = result.result.appliedFiles.get("scripts/file_0.gml");

        assert.equal(result.result.summaries.length, 1);
        assert.equal(result.result.summaries[0]?.id, "namingConvention");
        assert.equal(result.result.summaries[0]?.changed, true);
        assert.equal(result.result.appliedFiles.size, FILE_COUNT);
        assert.equal(
            result.getLocalReferenceOccurrencesCallCount,
            FILE_COUNT,
            "Expected local reference indexing to run once per selected file"
        );
        assert.ok(typeof rewrittenFirstFile === "string");
        assert.match(rewrittenFirstFile, /\bvar badName00 = 0;/);
        assert.match(rewrittenFirstFile, /\bbadName00 \+= 1;/);
        assert.match(rewrittenFirstFile, /\bself\.bad_name_0_0 \+= 1;/);
        assert.ok(
            durationMs <= PERFORMANCE_THRESHOLD_MS,
            `Expected disk-backed local naming codemod runtime under ${PERFORMANCE_THRESHOLD_MS}ms, received ${durationMs.toFixed(2)}ms`
        );
    } finally {
        await rm(fixture.projectRoot, { recursive: true, force: true });
    }
});
