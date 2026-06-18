import { createHash } from "node:crypto";
import { constants, type Dirent } from "node:fs";
import { access, lstat, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AGENT_PACK_NAME = "@gmloop/agent-pack";
const AGENT_PACK_ROOT = path.dirname(fileURLToPath(import.meta.resolve(`${AGENT_PACK_NAME}/package.json`)));
const AGENT_PACK_SKILLS_ROOT = path.join(AGENT_PACK_ROOT, "skills");
const PROJECT_GUIDANCE_TEMPLATE_PATH = path.join(AGENT_PACK_ROOT, "templates", "project-agents.md");
const PROJECT_RECEIPT_RELATIVE_PATH = ".gmloop/agent-pack.json";
const PROJECT_SKILLS_RELATIVE_PATH = ".agents/skills";

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

function agentPackReceiptsMatch(left: AgentPackReceipt | null, right: AgentPackReceipt): boolean {
    return (
        left !== null &&
        left.version === right.version &&
        JSON.stringify(left.conflicts) === JSON.stringify(right.conflicts) &&
        JSON.stringify(left.files) === JSON.stringify(right.files)
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
            if (entry.isDirectory()) {
                const childPaths = await collectFilesRecursively(entryPath);
                return childPaths.map((nestedPath) => path.join(entry.name, nestedPath));
            }
            return entry.isFile() ? [entry.name] : [];
        })
    );
    return Object.freeze(nestedPaths.flat());
}

async function readPackagedProjectFiles(): Promise<ReadonlyArray<PackagedProjectFile>> {
    const skillFiles = await collectFilesRecursively(AGENT_PACK_SKILLS_ROOT);
    const sourceEntries = [
        ...skillFiles.map((relativePath) => ({
            sourcePath: path.join(AGENT_PACK_SKILLS_ROOT, relativePath),
            targetRelativePath: path.posix.join(PROJECT_SKILLS_RELATIVE_PATH, ...relativePath.split(path.sep))
        })),
        { sourcePath: PROJECT_GUIDANCE_TEMPLATE_PATH, targetRelativePath: "AGENTS.md" }
    ].sort((left, right) => left.targetRelativePath.localeCompare(right.targetRelativePath));

    return Object.freeze(
        await Promise.all(
            sourceEntries.map(async (entry) => {
                const contents = await readFile(entry.sourcePath);
                return Object.freeze({
                    contents,
                    sourceHash: hashContents(contents),
                    targetRelativePath: entry.targetRelativePath
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
    return Object.freeze(
        entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
            .sort()
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
export async function initializeAgentPack(projectRoot: string): Promise<AgentPackInitializationResult> {
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
    const dispositions = [...synchronizedFiles, ...obsoleteFiles.filter((result) => result !== null)];
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
