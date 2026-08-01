import { performance } from "node:perf_hooks";

const FUNCTION_COUNT = 2400;
const UNRESOLVED_REFERENCE_FILE_COUNT = 180;
const UNRESOLVED_REFERENCES_PER_FILE = 120;

export type TopLevelNamingConventionFixture = {
    files: Record<
        string,
        {
            declarations: Array<{ filePath: string; identifierId: string; name: string }>;
            references?: Array<Record<string, unknown>>;
        }
    >;
    projectIndex: Record<string, unknown>;
    projectRoot: string;
    sourceTexts: Map<string, string>;
};

export function createTopLevelNamingConventionFixture(): TopLevelNamingConventionFixture {
    const projectRoot = "/project";
    const files: TopLevelNamingConventionFixture["files"] = {};
    const scripts: Record<
        string,
        {
            declarations: Array<Record<string, unknown>>;
            identifierId: string;
            name: string;
            references: Array<Record<string, unknown>>;
            resourcePath: string;
        }
    > = {};
    const sourceTexts = new Map<string, string>();
    const usagePath = "scripts/usage.gml";
    const usageLines: Array<string> = [];
    let usageOffset = 0;

    for (let index = 0; index < FUNCTION_COUNT; index += 1) {
        const currentName = `bad_name_${index}`;
        const filePath = `scripts/${currentName}.gml`;
        const sourceText = `function ${currentName}() {\n    return ${index};\n}\n`;
        const declarationStart = sourceText.indexOf(currentName);
        const declarationEndInclusive = declarationStart + currentName.length - 1;

        sourceTexts.set(filePath, sourceText);
        files[filePath] = {
            declarations: [{ name: currentName, identifierId: `script:${currentName}`, filePath }]
        };
        scripts[`script:${currentName}`] = {
            identifierId: `script:${currentName}`,
            name: currentName,
            declarations: [
                {
                    name: currentName,
                    filePath,
                    start: { index: declarationStart },
                    end: { index: declarationEndInclusive }
                }
            ],
            references: [],
            resourcePath: `scripts/${currentName}/${currentName}.yy`
        };
        usageLines.push(`${currentName}();\n`);
    }

    const usageSource = usageLines.join("");
    sourceTexts.set(usagePath, usageSource);
    files[usagePath] = { declarations: [] };

    for (let index = 0; index < FUNCTION_COUNT; index += 1) {
        const currentName = `bad_name_${index}`;
        const referenceEndInclusive = usageOffset + currentName.length - 1;
        scripts[`script:${currentName}`].references.push({
            targetName: currentName,
            name: currentName,
            filePath: usagePath,
            start: { index: usageOffset },
            end: { index: referenceEndInclusive }
        });
        usageOffset += `${currentName}();\n`.length;
    }

    for (let fileIndex = 0; fileIndex < UNRESOLVED_REFERENCE_FILE_COUNT; fileIndex += 1) {
        const filePath = `scripts/unresolved_${fileIndex}.gml`;
        const references: Array<Record<string, unknown>> = [];
        const lines: Array<string> = [];
        let offset = 0;

        for (let referenceIndex = 0; referenceIndex < UNRESOLVED_REFERENCES_PER_FILE; referenceIndex += 1) {
            const currentName = `unresolved_name_${fileIndex}_${referenceIndex}`;
            const sourceLine = `${currentName}();\n`;
            references.push({
                name: currentName,
                filePath,
                start: { index: offset },
                end: { index: offset + currentName.length - 1 }
            });
            lines.push(sourceLine);
            offset += sourceLine.length;
        }

        sourceTexts.set(filePath, lines.join(""));
        files[filePath] = {
            declarations: [],
            references
        };
    }

    return {
        files,
        projectIndex: {
            identifiers: { scripts },
            files,
            resources: {}
        },
        projectRoot,
        sourceTexts
    };
}

export async function measureMedianDurationMs<T>(
    sampleCount: number,
    execute: () => Promise<T>
): Promise<{
    durationMs: number;
    result: T;
}> {
    const durations: Array<number> = [];
    let latestResult: T | undefined;

    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
        const startTime = performance.now();
        latestResult = await execute();
        durations.push(performance.now() - startTime);
    }

    durations.sort((left, right) => left - right);
    const medianIndex = Math.floor(durations.length / 2);

    if (latestResult === undefined) {
        throw new Error("measureMedianDurationMs requires at least one sample");
    }

    return {
        durationMs: durations[medianIndex] ?? 0,
        result: latestResult
    };
}
