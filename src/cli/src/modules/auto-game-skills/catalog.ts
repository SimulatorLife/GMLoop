import { type Dirent } from "node:fs";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { Core } from "@gmloop/core";
import matter from "gray-matter";

import { pathExists } from "../../shared/path-exists.js";

const PROJECT_SKILLS_RELATIVE_PATH = path.join(".agents", "skills");

/** A project-scoped Agent Skill rendered by the Auto-Game surface. */
export type AutoGameProjectSkill = Readonly<{
    description: string;
    diagnostic: string | null;
    enabled: boolean;
    name: string;
    sourcePath: string;
    status: "available" | "unreadable";
}>;

type AutoGameConfiguration = Readonly<{
    disabledSkills: ReadonlyArray<string>;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readDirectoryEntries(directoryPath: string): Promise<ReadonlyArray<Dirent>> {
    try {
        return await readdir(directoryPath, { withFileTypes: true });
    } catch {
        return [];
    }
}

/** Assert that a directory is the root of a GameMaker project. */
export async function assertAutoGameProjectRoot(projectRoot: string): Promise<string> {
    const resolvedProjectRoot = path.resolve(projectRoot);
    const entries = await readDirectoryEntries(resolvedProjectRoot);
    if (!entries.some((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".yyp"))) {
        throw new Error(
            `Auto-Game skills require a GameMaker project root containing a .yyp file: ${resolvedProjectRoot}`
        );
    }
    return resolvedProjectRoot;
}

function parseAutoGameConfiguration(projectConfig: Readonly<Record<string, unknown>>): AutoGameConfiguration {
    const autoGame = projectConfig.autoGame;
    if (!isRecord(autoGame)) {
        return { disabledSkills: [] };
    }
    const disabledSkills = autoGame.disabledSkills;
    if (!Array.isArray(disabledSkills)) {
        return { disabledSkills: [] };
    }
    return {
        disabledSkills: Object.freeze(
            Core.uniqueArray(
                disabledSkills.filter((name): name is string => Core.isNonEmptyString(name)).map((name) => name.trim())
            ).toSorted()
        )
    };
}

function createUnreadableSkill(
    directoryName: string,
    sourcePath: string,
    diagnostic: string,
    disabledSkills: ReadonlySet<string>
): AutoGameProjectSkill {
    return Object.freeze({
        description: "GMLoop could not read this skill's display metadata.",
        diagnostic,
        enabled: !disabledSkills.has(directoryName),
        name: directoryName,
        sourcePath,
        status: "unreadable"
    });
}

async function readProjectSkill(
    projectRoot: string,
    directoryName: string,
    disabledSkills: ReadonlySet<string>
): Promise<AutoGameProjectSkill> {
    const relativeSourcePath = path.posix.join(".agents", "skills", directoryName, "SKILL.md");
    const sourcePath = path.join(projectRoot, relativeSourcePath);
    let source: string;
    try {
        source = await readFile(sourcePath, "utf8");
    } catch (error) {
        return createUnreadableSkill(
            directoryName,
            relativeSourcePath,
            `Could not read SKILL.md: ${Core.getErrorMessage(error)}`,
            disabledSkills
        );
    }

    let parsedSkill: ReturnType<typeof matter>;
    try {
        parsedSkill = matter(source);
    } catch (error) {
        return createUnreadableSkill(
            directoryName,
            relativeSourcePath,
            `Could not parse SKILL.md frontmatter: ${Core.getErrorMessage(error)}`,
            disabledSkills
        );
    }
    const metadata = parsedSkill.data as unknown;
    const description =
        isRecord(metadata) && Core.isNonEmptyString(metadata.description)
            ? metadata.description.trim()
            : "No description was found in this skill's metadata.";
    return Object.freeze({
        description,
        diagnostic: null,
        enabled: !disabledSkills.has(directoryName),
        name: directoryName,
        sourcePath: relativeSourcePath,
        status: "available"
    });
}

/** Discover standard Agent Skills from one validated GameMaker project root. */
export async function discoverAutoGameProjectSkills(
    projectRoot: string,
    projectConfig: Readonly<Record<string, unknown>>
): Promise<ReadonlyArray<AutoGameProjectSkill>> {
    const resolvedProjectRoot = await assertAutoGameProjectRoot(projectRoot);
    const skillsRoot = path.join(resolvedProjectRoot, PROJECT_SKILLS_RELATIVE_PATH);
    const entries = await readDirectoryEntries(skillsRoot);
    const disabledSkills = new Set(parseAutoGameConfiguration(projectConfig).disabledSkills);
    const skillDirectoryNames = entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
    return Object.freeze(
        await Promise.all(
            skillDirectoryNames.map((directoryName) =>
                readProjectSkill(resolvedProjectRoot, directoryName, disabledSkills)
            )
        )
    );
}

/** Persist one skill's enabled state as a disabled-name exception in gmloop.json. */
export async function setAutoGameProjectSkillEnabled(
    projectRoot: string,
    skillName: string,
    enabled: boolean
): Promise<Readonly<Record<string, unknown>>> {
    const resolvedProjectRoot = await assertAutoGameProjectRoot(projectRoot);
    const normalizedSkillName = skillName.trim();
    if (normalizedSkillName.length === 0) {
        throw new Error("Auto-Game skill name must not be empty.");
    }
    const configPath = path.join(resolvedProjectRoot, "gmloop.json");
    const projectConfig = (await pathExists(configPath)) ? await Core.loadGmloopProjectConfig(configPath) : {};
    const autoGame = isRecord(projectConfig.autoGame) ? projectConfig.autoGame : {};
    const disabledSkills = new Set(parseAutoGameConfiguration(projectConfig).disabledSkills);
    if (enabled) {
        disabledSkills.delete(normalizedSkillName);
    } else {
        disabledSkills.add(normalizedSkillName);
    }
    const nextConfig = {
        ...projectConfig,
        autoGame: {
            ...autoGame,
            disabledSkills: [...disabledSkills].sort()
        }
    };
    await writeFile(configPath, `${JSON.stringify(nextConfig, null, 2)}\n`, "utf8");
    return Object.freeze(nextConfig);
}
