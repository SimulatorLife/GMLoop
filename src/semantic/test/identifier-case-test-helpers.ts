import { existsSync, promises as fs } from "node:fs";
import path from "node:path";

import { buildProjectIndex } from "../src/project-index/index.js";
import { createTempProjectWorkspace } from "./test-project-helpers.js";

type ScriptFixtureConfig =
    | string
    | {
          name?: string;
          fixture: string;
      };

type IdentifierCaseProject = {
    projectRoot: string;
    scripts: Array<{
        name: string;
        fixture: string;
        path: string;
        source: string;
    }>;
    scriptPaths: string[];
    scriptSources: string[];
    event: null | {
        fixture: string;
        path: string;
        source: string;
    };
    eventPath: string | null;
    projectIndex: Awaited<ReturnType<typeof buildProjectIndex>>;
};

export function resolveIdentifierCasePluginPath(currentDirectory: string): string {
    const candidates = [
        path.resolve(currentDirectory, "../../format/dist/src/format-entry.js"),
        path.resolve(currentDirectory, "../../format/dist/index.js"),
        path.resolve(currentDirectory, "../../format/dist/src/index.js"),
        path.resolve(currentDirectory, "../../format/src/format-entry.js"),
        path.resolve(currentDirectory, "../../format/src/index.js"),
        path.resolve(currentDirectory, "../../format/src/format-entry.ts"),
        path.resolve(currentDirectory, "../../../format/dist/src/format-entry.js"),
        path.resolve(currentDirectory, "../../../format/dist/index.js"),
        path.resolve(currentDirectory, "../../../format/dist/src/index.js"),
        path.resolve(currentDirectory, "../../../format/src/format-entry.js"),
        path.resolve(currentDirectory, "../../../format/src/index.js"),
        path.resolve(currentDirectory, "../../../format/src/format-entry.ts")
    ];

    for (const candidate of candidates) {
        if (existsSync(candidate)) {
            return candidate;
        }
    }

    return candidates[0];
}

export function resolveIdentifierCaseFixturesDirectory(baseDirectory: string, sampleFixture = "locals.gml"): string {
    const candidates = [
        path.join(baseDirectory, "identifier-case-fixtures"),
        path.resolve(baseDirectory, "../../test/identifier-case-fixtures")
    ];

    for (const candidate of candidates) {
        if (existsSync(path.join(candidate, sampleFixture))) {
            return candidate;
        }
    }

    return candidates[0];
}

export async function createIdentifierCaseProject({
    fixturesDirectory,
    scriptFixtures = [{ name: "demo", fixture: "locals.gml" }],
    eventFixture = null,
    projectPrefix = "gml-identifier-case-"
}: {
    fixturesDirectory: string;
    scriptFixtures?: ScriptFixtureConfig[];
    eventFixture?: string | null;
    projectPrefix?: string;
}): Promise<IdentifierCaseProject> {
    const { projectRoot: tempRoot, writeProjectFile } = await createTempProjectWorkspace(projectPrefix);

    await writeProjectFile("MyGame.yyp", JSON.stringify({ name: "MyGame", resourceType: "GMProject" }));

    const scripts: IdentifierCaseProject["scripts"] = [];
    const scriptPaths: string[] = [];
    const scriptSources: string[] = [];

    const processScript = async (
        config: ScriptFixtureConfig,
        index: number
    ): Promise<IdentifierCaseProject["scripts"][number]> => {
        const scriptName = typeof config === "string" ? `script_${index}` : (config.name ?? `script_${index}`);
        const fixtureName = typeof config === "string" ? config : config.fixture;

        await writeProjectFile(
            `scripts/${scriptName}/${scriptName}.yy`,
            JSON.stringify({ resourceType: "GMScript", name: scriptName })
        );

        const scriptFixturePath = path.join(fixturesDirectory, String(fixtureName));
        const scriptSource = await fs.readFile(scriptFixturePath, "utf8");
        const scriptPath = await writeProjectFile(`scripts/${scriptName}/${scriptName}.gml`, scriptSource);

        return {
            name: scriptName,
            fixture: String(fixtureName),
            path: scriptPath,
            source: scriptSource
        };
    };

    const scriptResults = await Promise.all(scriptFixtures.map(async (config, index) => processScript(config, index)));
    for (const result of scriptResults) {
        scripts.push(result);
        scriptPaths.push(result.path);
        scriptSources.push(result.source);
    }

    let eventPath: string | null = null;
    let eventSource: string | null = null;
    if (eventFixture) {
        const eventFixturePath = path.join(fixturesDirectory, eventFixture);
        eventSource = await fs.readFile(eventFixturePath, "utf8");

        await writeProjectFile(
            "objects/obj_scope/obj_scope.yy",
            JSON.stringify({
                resourceType: "GMObject",
                name: "obj_scope",
                eventList: [
                    {
                        resourceType: "GMEvent",
                        eventType: 0,
                        eventNum: 0,
                        eventContents: "objects/obj_scope/obj_scope_Create.gml"
                    }
                ]
            })
        );

        eventPath = await writeProjectFile("objects/obj_scope/obj_scope_Create.gml", eventSource);
    }

    const projectIndex = await buildProjectIndex(tempRoot);

    return {
        projectRoot: tempRoot,
        scripts,
        scriptPaths,
        scriptSources,
        event:
            eventPath && eventSource
                ? {
                      fixture: eventFixture ?? "",
                      path: eventPath,
                      source: eventSource
                  }
                : null,
        eventPath,
        projectIndex
    };
}

type FormatOptions = Record<string, unknown>;

type FormatModule = {
    Format: {
        format(source: string, options?: FormatOptions): Promise<string>;
    };
};

let cachedFormatModule: Promise<FormatModule> | null = null;

function getFormatDistUrl(): string {
    return new URL("../../../format/dist/index.js", import.meta.url).href;
}

export async function getFormat(): Promise<FormatModule["Format"]> {
    if (cachedFormatModule === null) {
        cachedFormatModule = import(getFormatDistUrl()).then((formatModule) => formatModule as FormatModule);
    }

    const formatModule = await cachedFormatModule;
    return formatModule.Format;
}
