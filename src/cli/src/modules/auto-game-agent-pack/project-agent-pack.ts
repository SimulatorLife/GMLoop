import { createHash } from "node:crypto";
import { constants, type Dirent } from "node:fs";
import { access, lstat, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AGENT_PACK_NAME = "@gmloop/agent-pack";
const AGENT_PACK_ROOT = path.dirname(fileURLToPath(import.meta.resolve(`${AGENT_PACK_NAME}/package.json`)));
const AGENT_PACK_SKILLS_ROOT = path.join(AGENT_PACK_ROOT, "skills");
const PROJECT_GUIDANCE_TEMPLATE_PATH = path.join(AGENT_PACK_ROOT, "templates", "project-agents.md");
const PROJECT_GITIGNORE_TEMPLATE_PATH = path.join(AGENT_PACK_ROOT, "templates", "project-gitignore");
const PROJECT_LSP_MCP_TEMPLATE_PATH = path.join(AGENT_PACK_ROOT, "templates", "project-lsp-mcp.json");
const PROJECT_RECEIPT_RELATIVE_PATH = ".gmloop/agent-pack.json";
const PROJECT_SKILLS_RELATIVE_PATH = ".agents/skills";
const PROJECT_GITIGNORE_RELATIVE_PATH = ".gitignore";
const PROJECT_GITIGNORE_SECTION_HEADING = "# GMLoop generated files";
const GMLOOP_SKILL_NAME_PREFIX = "gmloop-";
const SYNCHRONIZATION_MANAGED_FILE = "managed-file" as const;

/** Installation state for the agent pack in one GameMaker project. */
export type AgentPackProjectStatusKind = "current" | "not-installed" | "update-available";

/** Version and conflict state for the agent pack in one GameMaker project. */
export type AgentPackProjectStatus = Readonly<{
    availableVersion: string;
    conflicts: ReadonlyArray<string>;
    installedVersion: string | null;
    status: AgentPackProjectStatusKind;
}>;

/** Deterministic result of materializing the agent pack into a project. */
export type AgentPackInitializationResult = Readonly<{
    added: ReadonlyArray<string>;
    availableVersion: string;
    changed: boolean;
    conflicts: ReadonlyArray<string>;
    projectRoot: string;
    removed: ReadonlyArray<string>;
    unchanged: ReadonlyArray<string>;
    updated: ReadonlyArray<string>;
}>;

/** Options controlling optional project hygiene during agent-pack initialization. */
export type AgentPackInitializationOptions = Readonly<{
    includeGitIgnore: boolean;
}>;

/** Read-only packaged resource displayed by agent-pack consumers. */
export type AgentPackResourcePreview = Readonly<{
    content: string;
    kind: "skill" | "template";
    packagePath: string;
    targetPath: string;
}>;

const DEFAULT_AGENT_PACK_INITIALIZATION_OPTIONS: AgentPackInitializationOptions = Object.freeze({
    includeGitIgnore: true
});

type AgentPackReceipt = Readonly<{
    conflicts: ReadonlyArray<string>;
    files: Readonly<Record<string, string>>;
    package: string;
    version: string;
}>;

type PackagedProjectFile = Readonly<{
    contents: Uint8Array;
    sourceHash: string;
    targetRelativePath: string;
}>;

type AgentPackResourceSource = Readonly<{
    kind: AgentPackResourcePreview["kind"];
    packagePath: string;
    sourcePath: string;
    synchronization: "managed-file" | "merge";
    targetPath: string;
}>;

type ProjectFileDisposition = Readonly<{
    kind: "added" | "conflict" | "removed" | "unchanged" | "updated";
    targetRelativePath: string;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function pathExists(candidatePath: string): Promise<boolean> {
    try {
        await access(candidatePath, constants.F_OK);
        return true;
    } catch {
        return false;
    }
}

async function readDirectoryEntries(directoryPath: string): Promise<ReadonlyArray<Dirent>> {
    try {
        return await readdir(directoryPath, { withFileTypes: true });
    } catch {
        return [];
    }
}

async function isDirectoryOrDirectorySymlink(parentPath: string, entry: Dirent): Promise<boolean> {
    if (entry.isDirectory()) {
        return true;
    }
    if (!entry.isSymbolicLink()) {
        return false;
    }

    try {
        const entryStats = await stat(path.join(parentPath, entry.name));
        return entryStats.isDirectory();
    } catch {
        return false;
    }
}

function hashContents(contents: Uint8Array): string {
    return createHash("sha256").update(contents).digest("hex");
}

function resolveProjectFilePath(projectRoot: string, projectRelativePath: string): string {
    return path.join(projectRoot, ...projectRelativePath.split("/"));
}

function isSafeProjectRelativePath(candidatePath: string): boolean {
    return (
        candidatePath.length > 0 &&
        !path.posix.isAbsolute(candidatePath) &&
        path.posix.normalize(candidatePath) === candidatePath &&
        !candidatePath.split("/").includes("..")
    );
}

function parseStringRecord(value: unknown, fieldName: string, sourcePath: string): Readonly<Record<string, string>> {
    if (!isRecord(value)) {
        throw new Error(`Agent-pack receipt field '${fieldName}' must be an object: ${sourcePath}`);
    }
    const entries = Object.entries(value);
    if (entries.some((entry) => !isSafeProjectRelativePath(entry[0]) || typeof entry[1] !== "string")) {
        throw new Error(
            `Agent-pack receipt field '${fieldName}' must contain safe project-relative paths and string values: ${sourcePath}`
        );
    }
    return Object.freeze(Object.fromEntries(entries) as Record<string, string>);
}

function parseStringArray(value: unknown, fieldName: string, sourcePath: string): ReadonlyArray<string> {
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
        throw new Error(`Agent-pack receipt field '${fieldName}' must be an array of strings: ${sourcePath}`);
    }
    return Object.freeze([...value].sort());
}

function parseAgentPackReceipt(source: string, sourcePath: string): AgentPackReceipt {
    const parsed: unknown = JSON.parse(source);
    if (
        !isRecord(parsed) ||
        parsed.package !== AGENT_PACK_NAME ||
        typeof parsed.version !== "string" ||
        parsed.version.trim().length === 0
    ) {
        throw new Error(`Invalid ${AGENT_PACK_NAME} receipt: ${sourcePath}`);
    }
    return Object.freeze({
        conflicts: parseStringArray(parsed.conflicts, "conflicts", sourcePath),
        files: parseStringRecord(parsed.files, "files", sourcePath),
        package: AGENT_PACK_NAME,
        version: parsed.version
    });
}

/**
 * Determine whether two read-only string arrays contain identical entries in
 * the same order. Receipt payloads carry sorted, primitive-only arrays, so a
 * straightforward length-plus-element scan is both clearer and materially
 * cheaper than the previous JSON.stringify-based deep equality, which had to
 * serialise both sides on every comparison and was sensitive to key ordering.
 */
function areStringArraysEqual(left: ReadonlyArray<string>, right: ReadonlyArray<string>): boolean {
    if (left === right) {
        return true;
    }

    if (left.length !== right.length) {
        return false;
    }

    for (const [index, value] of left.entries()) {
        if (value !== right[index]) {
            return false;
        }
    }

    return true;
}

/**
 * Determine whether two read-only string records expose identical entries.
 * As with {@link areStringArraysEqual}, the receipt payloads guarantee
 * primitive-only values, so strict-equality lookup on each key is sufficient
 * — no JSON serialisation round-trip is required.
 */
function areStringRecordsEqual(
    left: Readonly<Record<string, string>>,
    right: Readonly<Record<string, string>>
): boolean {
    if (left === right) {
        return true;
    }

    const leftKeys = Object.keys(left);
    if (leftKeys.length !== Object.keys(right).length) {
        return false;
    }

    for (const key of leftKeys) {
        if (left[key] !== right[key]) {
            return false;
        }
    }

    return true;
}

function agentPackReceiptsMatch(left: AgentPackReceipt | null, right: AgentPackReceipt): boolean {
    return (
        left !== null &&
        left.version === right.version &&
        areStringArraysEqual(left.conflicts, right.conflicts) &&
        areStringRecordsEqual(left.files, right.files)
    );
}

async function readAgentPackReceipt(projectRoot: string): Promise<AgentPackReceipt | null> {
    const receiptPath = path.join(projectRoot, PROJECT_RECEIPT_RELATIVE_PATH);
    if (!(await pathExists(receiptPath))) {
        return null;
    }
    const source = await readFile(receiptPath, "utf8");
    return parseAgentPackReceipt(source, receiptPath);
}

async function collectFilesRecursively(directoryPath: string): Promise<ReadonlyArray<string>> {
    const directoryEntries = await readdir(directoryPath, { withFileTypes: true });
    const entries = directoryEntries.sort((left, right) => left.name.localeCompare(right.name));
    const nestedPaths = await Promise.all(
        entries.map(async (entry) => {
            const entryPath = path.join(directoryPath, entry.name);
            if (await isDirectoryOrDirectorySymlink(directoryPath, entry)) {
                const childPaths = await collectFilesRecursively(entryPath);
                return childPaths.map((nestedPath) => path.join(entry.name, nestedPath));
            }
            return entry.isFile() ? [entry.name] : [];
        })
    );
    return Object.freeze(nestedPaths.flat());
}

async function readAgentPackResourceSources(): Promise<ReadonlyArray<AgentPackResourceSource>> {
    const skillFiles = await collectFilesRecursively(AGENT_PACK_SKILLS_ROOT);
    return Object.freeze([
        {
            kind: "template",
            packagePath: "templates/project-agents.md",
            sourcePath: PROJECT_GUIDANCE_TEMPLATE_PATH,
            synchronization: SYNCHRONIZATION_MANAGED_FILE,
            targetPath: "AGENTS.md"
        },
        {
            kind: "template",
            packagePath: "templates/project-lsp-mcp.json",
            sourcePath: PROJECT_LSP_MCP_TEMPLATE_PATH,
            synchronization: SYNCHRONIZATION_MANAGED_FILE,
            targetPath: ".lsp-mcp.json"
        },
        {
            kind: "template",
            packagePath: "templates/project-gitignore",
            sourcePath: PROJECT_GITIGNORE_TEMPLATE_PATH,
            synchronization: "merge",
            targetPath: PROJECT_GITIGNORE_RELATIVE_PATH
        },
        ...skillFiles.map((relativePath) => ({
            kind: "skill" as const,
            packagePath: path.posix.join("skills", ...relativePath.split(path.sep)),
            sourcePath: path.join(AGENT_PACK_SKILLS_ROOT, relativePath),
            synchronization: SYNCHRONIZATION_MANAGED_FILE,
            targetPath: path.posix.join(PROJECT_SKILLS_RELATIVE_PATH, ...relativePath.split(path.sep))
        }))
    ]);
}

async function readPackagedProjectFiles(): Promise<ReadonlyArray<PackagedProjectFile>> {
    const resourceSources = await readAgentPackResourceSources();
    const sourceEntries = resourceSources
        .filter((entry) => entry.synchronization === SYNCHRONIZATION_MANAGED_FILE)
        .sort((left, right) => left.targetPath.localeCompare(right.targetPath));

    return Object.freeze(
        await Promise.all(
            sourceEntries.map(async (entry) => {
                const contents = await readFile(entry.sourcePath);
                return Object.freeze({
                    contents,
                    sourceHash: hashContents(contents),
                    targetRelativePath: entry.targetPath
                });
            })
        )
    );
}

async function writeProjectFile(projectRoot: string, packagedFile: PackagedProjectFile): Promise<void> {
    const targetPath = resolveProjectFilePath(projectRoot, packagedFile.targetRelativePath);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, packagedFile.contents);
}

function normalizeGitIgnoreDirectoryPattern(line: string): string | null {
    const trimmedLine = line.trim();
    if (trimmedLine.length === 0 || trimmedLine.startsWith("#") || trimmedLine.startsWith("!")) {
        return null;
    }
    return trimmedLine
        .replace(/^\//u, "")
        .replace(/^\*\*\//u, "")
        .replace(/\/\*\*$/u, "")
        .replace(/\/$/u, "");
}

async function synchronizeProjectGitIgnore(projectRoot: string): Promise<ProjectFileDisposition> {
    const targetPath = path.join(projectRoot, PROJECT_GITIGNORE_RELATIVE_PATH);
    const targetExists = await pathExists(targetPath);
    const existingSource = targetExists ? await readFile(targetPath, "utf8") : "";
    const packagedSource = await readFile(PROJECT_GITIGNORE_TEMPLATE_PATH, "utf8");
    const packagedEntries = packagedSource
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
    const existingPatterns = new Set(
        existingSource
            .split(/\r?\n/u)
            .map((line) => normalizeGitIgnoreDirectoryPattern(line))
            .filter((pattern): pattern is string => pattern !== null)
    );
    const missingEntries = packagedEntries.filter((entry) => {
        const normalizedEntry = normalizeGitIgnoreDirectoryPattern(entry);
        return normalizedEntry !== null && !existingPatterns.has(normalizedEntry);
    });
    if (missingEntries.length === 0) {
        return Object.freeze({ kind: "unchanged", targetRelativePath: PROJECT_GITIGNORE_RELATIVE_PATH });
    }

    const hasSectionHeading = existingSource
        .split(/\r?\n/u)
        .some((line) => line.trim() === PROJECT_GITIGNORE_SECTION_HEADING);
    const appendedLines = [...(hasSectionHeading ? [] : [PROJECT_GITIGNORE_SECTION_HEADING]), ...missingEntries];
    const separator = existingSource.length === 0 ? "" : existingSource.endsWith("\n") ? "\n" : "\n\n";
    await writeFile(targetPath, `${existingSource}${separator}${appendedLines.join("\n")}\n`, "utf8");
    return Object.freeze({
        kind: targetExists ? "updated" : "added",
        targetRelativePath: PROJECT_GITIGNORE_RELATIVE_PATH
    });
}

async function readRegularProjectFileHash(targetPath: string): Promise<string | null> {
    const targetStats = await lstat(targetPath);
    if (!targetStats.isFile()) {
        return null;
    }
    return hashContents(await readFile(targetPath));
}

async function synchronizePackagedProjectFile(
    projectRoot: string,
    packagedFile: PackagedProjectFile,
    previousReceipt: AgentPackReceipt | null
): Promise<ProjectFileDisposition> {
    const targetPath = resolveProjectFilePath(projectRoot, packagedFile.targetRelativePath);
    if (!(await pathExists(targetPath))) {
        await writeProjectFile(projectRoot, packagedFile);
        return Object.freeze({ kind: "added", targetRelativePath: packagedFile.targetRelativePath });
    }

    const targetHash = await readRegularProjectFileHash(targetPath);
    if (targetHash === packagedFile.sourceHash) {
        return Object.freeze({ kind: "unchanged", targetRelativePath: packagedFile.targetRelativePath });
    }
    const previousSourceHash = previousReceipt?.files[packagedFile.targetRelativePath];
    if (targetHash !== null && previousSourceHash !== undefined && targetHash === previousSourceHash) {
        await writeProjectFile(projectRoot, packagedFile);
        return Object.freeze({ kind: "updated", targetRelativePath: packagedFile.targetRelativePath });
    }
    return Object.freeze({ kind: "conflict", targetRelativePath: packagedFile.targetRelativePath });
}

async function removeObsoletePackagedProjectFile(
    projectRoot: string,
    previousRelativePath: string,
    previousSourceHash: string
): Promise<ProjectFileDisposition | null> {
    const targetPath = resolveProjectFilePath(projectRoot, previousRelativePath);
    if (!(await pathExists(targetPath))) {
        return null;
    }
    const targetHash = await readRegularProjectFileHash(targetPath);
    if (targetHash !== previousSourceHash) {
        return Object.freeze({ kind: "conflict", targetRelativePath: previousRelativePath });
    }
    await rm(targetPath);
    return Object.freeze({ kind: "removed", targetRelativePath: previousRelativePath });
}

/** Read the package version from the independently published agent pack. */
export async function readAgentPackVersion(): Promise<string> {
    const packageJsonPath = path.join(AGENT_PACK_ROOT, "package.json");
    const parsed: unknown = JSON.parse(await readFile(packageJsonPath, "utf8"));
    if (!isRecord(parsed) || parsed.name !== AGENT_PACK_NAME || typeof parsed.version !== "string") {
        throw new Error(`Invalid ${AGENT_PACK_NAME} package metadata: ${packageJsonPath}`);
    }
    return parsed.version;
}

/** Discover packaged skill directory names in deterministic order. */
export async function discoverPackagedSkillNames(): Promise<ReadonlyArray<string>> {
    const entries = await readdir(AGENT_PACK_SKILLS_ROOT, { withFileTypes: true });
    const skillEntries = await Promise.all(
        entries.map(async (entry) =>
            Object.freeze({
                isSkillDirectory: await isDirectoryOrDirectorySymlink(AGENT_PACK_SKILLS_ROOT, entry),
                name: entry.name
            })
        )
    );
    const skillNames = skillEntries
        .filter((entry) => entry.isSkillDirectory)
        .map((entry) => entry.name)
        .sort();
    const invalidSkillNames = skillNames.filter((skillName) => !skillName.startsWith(GMLOOP_SKILL_NAME_PREFIX));
    if (invalidSkillNames.length > 0) {
        throw new Error(
            `GMLoop-provided Agent Skill names must start with '${GMLOOP_SKILL_NAME_PREFIX}': ${invalidSkillNames.join(", ")}`
        );
    }
    return Object.freeze(skillNames);
}

/** Read every packaged skill and template for presentation without mutating a project. */
export async function readAgentPackResourcePreviews(): Promise<ReadonlyArray<AgentPackResourcePreview>> {
    const sources = await readAgentPackResourceSources();
    return Object.freeze(
        await Promise.all(
            sources.map(async (source) => {
                return Object.freeze({
                    content: await readFile(source.sourcePath, "utf8"),
                    kind: source.kind,
                    packagePath: source.packagePath,
                    targetPath: source.targetPath
                });
            })
        )
    );
}

/** Assert that a path is the root of a GameMaker project. */
export async function assertGameMakerProjectRoot(projectRoot: string): Promise<string> {
    const resolvedProjectRoot = path.resolve(projectRoot);
    const entries = await readDirectoryEntries(resolvedProjectRoot);
    if (!entries.some((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".yyp"))) {
        throw new Error(
            `Agent-pack initialization requires a GameMaker project root containing a .yyp file: ${resolvedProjectRoot}`
        );
    }
    return resolvedProjectRoot;
}

/** Read whether a project needs agent-pack initialization or an update. */
export async function readAgentPackProjectStatus(projectRoot: string): Promise<AgentPackProjectStatus> {
    const resolvedProjectRoot = await assertGameMakerProjectRoot(projectRoot);
    const availableVersion = await readAgentPackVersion();
    const receipt = await readAgentPackReceipt(resolvedProjectRoot);
    if (receipt === null) {
        return Object.freeze({
            availableVersion,
            conflicts: Object.freeze([]),
            installedVersion: null,
            status: "not-installed"
        });
    }
    return Object.freeze({
        availableVersion,
        conflicts: receipt.conflicts,
        installedVersion: receipt.version,
        status: receipt.version === availableVersion ? "current" : "update-available"
    });
}

/** Materialize or update the packaged resources without overwriting project modifications. */
export async function initializeAgentPack(
    projectRoot: string,
    options: AgentPackInitializationOptions = DEFAULT_AGENT_PACK_INITIALIZATION_OPTIONS
): Promise<AgentPackInitializationResult> {
    const resolvedProjectRoot = await assertGameMakerProjectRoot(projectRoot);
    const availableVersion = await readAgentPackVersion();
    const previousReceipt = await readAgentPackReceipt(resolvedProjectRoot);
    const packagedFiles = await readPackagedProjectFiles();
    const packagedFileMap = new Map(packagedFiles.map((file) => [file.targetRelativePath, file]));
    const synchronizedFiles = await Promise.all(
        packagedFiles.map((packagedFile) =>
            synchronizePackagedProjectFile(resolvedProjectRoot, packagedFile, previousReceipt)
        )
    );
    const obsoleteFiles = await Promise.all(
        Object.entries(previousReceipt?.files ?? {})
            .filter(([previousRelativePath]) => !packagedFileMap.has(previousRelativePath))
            .sort(([leftPath], [rightPath]) => leftPath.localeCompare(rightPath))
            .map(([previousRelativePath, previousSourceHash]) =>
                removeObsoletePackagedProjectFile(resolvedProjectRoot, previousRelativePath, previousSourceHash)
            )
    );
    const gitIgnoreDisposition = options.includeGitIgnore
        ? await synchronizeProjectGitIgnore(resolvedProjectRoot)
        : null;
    const dispositions = [
        ...synchronizedFiles,
        ...obsoleteFiles.filter((result) => result !== null),
        ...(gitIgnoreDisposition === null ? [] : [gitIgnoreDisposition])
    ];
    const pathsForDisposition = (kind: ProjectFileDisposition["kind"]): ReadonlyArray<string> =>
        dispositions.filter((result) => result.kind === kind).map((result) => result.targetRelativePath);
    const added = pathsForDisposition("added");
    const conflicts = pathsForDisposition("conflict");
    const removed = pathsForDisposition("removed");
    const unchanged = pathsForDisposition("unchanged");
    const updated = pathsForDisposition("updated");

    const sortedConflicts = [...new Set(conflicts)].sort();
    const receipt: AgentPackReceipt = Object.freeze({
        conflicts: Object.freeze(sortedConflicts),
        files: Object.freeze(
            Object.fromEntries(packagedFiles.map((file) => [file.targetRelativePath, file.sourceHash]))
        ),
        package: AGENT_PACK_NAME,
        version: availableVersion
    });
    const receiptPath = path.join(resolvedProjectRoot, PROJECT_RECEIPT_RELATIVE_PATH);
    await mkdir(path.dirname(receiptPath), { recursive: true });
    await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, "utf8");

    return Object.freeze({
        added: Object.freeze(added),
        availableVersion,
        changed:
            added.length > 0 ||
            removed.length > 0 ||
            updated.length > 0 ||
            !agentPackReceiptsMatch(previousReceipt, receipt),
        conflicts: Object.freeze(sortedConflicts),
        projectRoot: resolvedProjectRoot,
        removed: Object.freeze(removed),
        unchanged: Object.freeze(unchanged),
        updated: Object.freeze(updated)
    });
}

/**
 * Test-only surface that exposes the receipt comparison helpers so the
 * dedicated test file can exercise them directly without having to drive the
 * full project initialization pipeline. The named `__agentPackTest__`
 * marker keeps these references out of the public API while still being
 * discoverable for the internal test suite.
 */
export const __agentPackTest__ = Object.freeze({
    agentPackReceiptsMatch,
    areStringArraysEqual,
    areStringRecordsEqual
});
