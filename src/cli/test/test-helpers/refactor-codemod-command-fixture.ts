import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { Parser } from "@gmloop/parser";

/**
 * Write a UTF-8 file inside a temporary synthetic GameMaker project.
 */
export async function writeProjectFile(projectRoot: string, relativePath: string, contents: string): Promise<void> {
    const absolutePath = path.join(projectRoot, relativePath);
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, contents, "utf8");
}

/**
 * Register a resource entry in the synthetic project's GameMaker manifest.
 */
export async function registerProjectResource(
    projectRoot: string,
    resourceName: string,
    resourcePath: string
): Promise<void> {
    const projectFilePath = path.join(projectRoot, "MyGame.yyp");
    const projectDocument = JSON.parse(await readFile(projectFilePath, "utf8")) as Record<string, unknown>;
    const resourceEntries = Array.isArray(projectDocument.resources) ? [...projectDocument.resources] : [];

    resourceEntries.push({
        id: {
            name: resourceName,
            path: resourcePath
        }
    });

    projectDocument.resources = resourceEntries;
    await writeProjectFile(projectRoot, "MyGame.yyp", `${JSON.stringify(projectDocument, null, 4)}\n`);
}

/**
 * Create a script resource with its metadata and source file.
 */
export async function writeScriptResource(projectRoot: string, scriptName: string, sourceText: string): Promise<void> {
    const resourcePath = `scripts/${scriptName}/${scriptName}.yy`;
    await writeProjectFile(
        projectRoot,
        resourcePath,
        `${JSON.stringify(
            {
                resourceType: "GMScript",
                resourcePath,
                name: scriptName
            },
            null,
            4
        )}\n`
    );
    await writeProjectFile(projectRoot, `scripts/${scriptName}/${scriptName}.gml`, sourceText);
    await registerProjectResource(projectRoot, scriptName, resourcePath);
}

/**
 * Create an object resource with event source files.
 */
export async function writeObjectResource(
    projectRoot: string,
    objectName: string,
    eventFiles: Record<string, string>
): Promise<void> {
    const resourcePath = `objects/${objectName}/${objectName}.yy`;
    await writeProjectFile(
        projectRoot,
        resourcePath,
        `${JSON.stringify(
            {
                resourceType: "GMObject",
                resourcePath,
                name: objectName
            },
            null,
            4
        )}\n`
    );

    for (const [relativeEventFilePath, sourceText] of Object.entries(eventFiles)) {
        await writeProjectFile(projectRoot, `objects/${objectName}/${relativeEventFilePath}`, sourceText);
    }

    await registerProjectResource(projectRoot, objectName, resourcePath);
}

/**
 * Create a temporary GameMaker project root for CLI codemod tests.
 */
export async function createSyntheticRefactorProject(config: Record<string, unknown>): Promise<string> {
    const projectRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-refactor-cli-"));
    await writeProjectFile(
        projectRoot,
        "MyGame.yyp",
        `${JSON.stringify({ name: "MyGame", resourceType: "GMProject", resources: [] }, null, 4)}\n`
    );
    await writeProjectFile(projectRoot, "gmloop.json", `${JSON.stringify(config, null, 4)}\n`);
    return projectRoot;
}

/**
 * Create a temporary synthetic project, execute a callback, and always clean up the project directory.
 */
export async function withSyntheticRefactorProject<TResult>(
    config: Record<string, unknown>,
    runWithProject: (projectRoot: string) => Promise<TResult>
): Promise<TResult> {
    const projectRoot = await createSyntheticRefactorProject(config);
    try {
        return await runWithProject(projectRoot);
    } finally {
        await rm(projectRoot, { recursive: true, force: true });
    }
}

/**
 * Recursively collect all `.gml` files in a synthetic project.
 */
export async function listProjectGmlFiles(projectRoot: string, directory = projectRoot): Promise<Array<string>> {
    const entries = await readdir(directory, { withFileTypes: true });
    const gmlFiles: Array<string> = [];

    for (const entry of entries) {
        const absolutePath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            gmlFiles.push(...(await listProjectGmlFiles(projectRoot, absolutePath)));
            continue;
        }

        if (entry.isFile() && absolutePath.endsWith(".gml")) {
            gmlFiles.push(path.relative(projectRoot, absolutePath));
        }
    }

    return gmlFiles.toSorted();
}

/**
 * Parse every `.gml` file in the synthetic project to verify the refactor output remains valid GameMaker code.
 */
export async function assertProjectGmlFilesParse(projectRoot: string): Promise<void> {
    const gmlFiles = await listProjectGmlFiles(projectRoot);
    assert.ok(gmlFiles.length > 0, "expected the synthetic project to contain GML files");

    for (const relativePath of gmlFiles) {
        const sourceText = await readFile(path.join(projectRoot, relativePath), "utf8");
        assert.doesNotThrow(() => {
            const ast = Parser.GMLParser.parse(sourceText);
            assert.equal(ast.type, "Program");
        }, `expected ${relativePath} to remain parseable after refactor codemods`);
    }
}
