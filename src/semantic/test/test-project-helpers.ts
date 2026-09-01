import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export type TempProjectWorkspace = {
    projectRoot: string;
    writeProjectFile: (relativePath: string, contents: string) => Promise<string>;
    cleanup: () => Promise<void>;
};

/** Dimensions and naming for a deterministic generated script project. */
export type SyntheticScriptProjectSpecification = Readonly<{
    prefix: string;
    projectName: string;
    scriptCount: number;
    statementsPerScript: number;
}>;

/** Generated project paths plus the operation used to revise one script. */
export type SyntheticScriptProjectWorkspace = TempProjectWorkspace &
    Readonly<{
        manifestPath: string;
        scriptFilePaths: ReadonlyArray<string>;
        scriptNames: ReadonlyArray<string>;
        scriptRelativePaths: ReadonlyArray<string>;
        writeSyntheticScriptRevision: (scriptIndex: number, revision: number) => Promise<string>;
    }>;

function validateSyntheticProjectCount(value: number, fieldName: string, allowZero: boolean): void {
    const minimum = allowZero ? 0 : 1;
    if (!Number.isInteger(value) || value < minimum) {
        throw new RangeError(`${fieldName} must be an integer greater than or equal to ${minimum}.`);
    }
}

function createSyntheticScriptName(scriptIndex: number): string {
    return `synthetic_script_${String(scriptIndex).padStart(4, "0")}`;
}

/**
 * Create deterministic GML source for one synthetic workload script.
 */
export function createSyntheticScriptSource(scriptIndex: number, statementCount: number, revision: number): string {
    validateSyntheticProjectCount(scriptIndex, "scriptIndex", true);
    validateSyntheticProjectCount(statementCount, "statementCount", true);
    validateSyntheticProjectCount(revision, "revision", true);

    const scriptName = createSyntheticScriptName(scriptIndex);
    const previousScriptName = scriptIndex > 0 ? createSyntheticScriptName(scriptIndex - 1) : null;
    const initialValue = previousScriptName
        ? `${previousScriptName}(input_value) + ${revision}`
        : `input_value + ${revision}`;
    const statements = Array.from(
        { length: statementCount },
        (_, statementIndex) => `    accumulator += ${scriptIndex + statementIndex + revision};`
    );
    const revisionStatements =
        revision === 0
            ? []
            : [
                  `    var revision_marker_${revision} = accumulator;`,
                  `    synthetic_revision_probe_${revision}(revision_marker_${revision});`
              ];

    return [
        `function ${scriptName}(input_value) {`,
        `    var accumulator = ${initialValue};`,
        ...statements,
        ...revisionStatements,
        "    return accumulator;",
        "}",
        ""
    ].join("\n");
}

/**
 * Creates an isolated temporary GameMaker project workspace for semantic tests.
 */
export async function createTempProjectWorkspace(prefix: string): Promise<TempProjectWorkspace> {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), prefix));

    const writeProjectFile = async (relativePath: string, contents: string): Promise<string> => {
        const absolutePath = path.join(projectRoot, relativePath);
        await fs.mkdir(path.dirname(absolutePath), { recursive: true });
        await fs.writeFile(absolutePath, contents, "utf8");
        return absolutePath;
    };

    const cleanup = async (): Promise<void> => {
        await fs.rm(projectRoot, { recursive: true, force: true });
    };

    return {
        projectRoot,
        writeProjectFile,
        cleanup
    };
}

/**
 * Creates a deterministic multi-script GameMaker project for semantic workload tests.
 */
export async function createSyntheticScriptProjectWorkspace(
    specification: SyntheticScriptProjectSpecification
): Promise<SyntheticScriptProjectWorkspace> {
    validateSyntheticProjectCount(specification.scriptCount, "scriptCount", false);
    validateSyntheticProjectCount(specification.statementsPerScript, "statementsPerScript", true);

    const workspace = await createTempProjectWorkspace(specification.prefix);
    const scriptNames = Array.from({ length: specification.scriptCount }, (_, scriptIndex) =>
        createSyntheticScriptName(scriptIndex)
    );
    const scriptRelativePaths = scriptNames.map((scriptName) => `scripts/${scriptName}/${scriptName}.gml`);
    const manifestPath = await workspace.writeProjectFile(
        `${specification.projectName}.yyp`,
        JSON.stringify({
            name: specification.projectName,
            resourceType: "GMProject",
            resources: scriptNames.map((scriptName) => ({
                id: {
                    name: scriptName,
                    path: `scripts/${scriptName}/${scriptName}.yy`
                }
            }))
        })
    );
    const scriptFilePaths: string[] = [];

    for (const [scriptIndex, scriptName] of scriptNames.entries()) {
        await workspace.writeProjectFile(
            `scripts/${scriptName}/${scriptName}.yy`,
            JSON.stringify({
                name: scriptName,
                resourceType: "GMScript",
                resourceVersion: "2.0"
            })
        );
        scriptFilePaths.push(
            await workspace.writeProjectFile(
                scriptRelativePaths[scriptIndex],
                createSyntheticScriptSource(scriptIndex, specification.statementsPerScript, 0)
            )
        );
    }

    const writeSyntheticScriptRevision = async (scriptIndex: number, revision: number): Promise<string> => {
        if (scriptIndex >= scriptRelativePaths.length) {
            throw new RangeError(`scriptIndex must be less than ${scriptRelativePaths.length}.`);
        }
        return workspace.writeProjectFile(
            scriptRelativePaths[scriptIndex],
            createSyntheticScriptSource(scriptIndex, specification.statementsPerScript, revision)
        );
    };

    return {
        ...workspace,
        manifestPath,
        scriptFilePaths: Object.freeze(scriptFilePaths),
        scriptNames: Object.freeze(scriptNames),
        scriptRelativePaths: Object.freeze(scriptRelativePaths),
        writeSyntheticScriptRevision
    };
}

/**
 * Returns the values of a record while preserving the caller's value type.
 */
export function recordValues<T>(record: Record<string, T>): T[] {
    return Object.values(record);
}
