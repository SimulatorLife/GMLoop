import { createHash } from "node:crypto";
import { constants, type Dirent } from "node:fs";
import { access, lstat, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Core } from "@gmloop/core";

import {
    type AgentCliCommandRunner,
    type AgentConfigTargetSelection,
    type AgentIntegrationSetupSummary,
    type AgentIntegrationTarget,
    configureSelectedAgentIntegrations,
    discoverAgentIntegrationTargets,
    runAgentCliCommand
} from "./agent-integrations.js";

const AGENT_PACK_NAME = "@gmloop/agent-pack";
const AGENT_PACK_ROOT = path.dirname(fileURLToPath(import.meta.resolve(`${AGENT_PACK_NAME}/package.json`)));
const AGENT_PACK_SKILLS_ROOT = path.join(AGENT_PACK_ROOT, "skills");
const PROJECT_GUIDANCE_TEMPLATE_PATH = path.join(AGENT_PACK_ROOT, "templates", "project-agents.md");
const PROJECT_GITIGNORE_TEMPLATE_PATH = path.join(AGENT_PACK_ROOT, "templates", "project-gitignore");
const PROJECT_LSP_MCP_TEMPLATE_PATH = path.join(AGENT_PACK_ROOT, "templates", "project-lsp-mcp.json");
const PROJECT_VSCODE_SETTINGS_TEMPLATE_PATH = path.join(AGENT_PACK_ROOT, "templates", "project-vscode-settings.json");
const PROJECT_VSCODE_EXTENSIONS_TEMPLATE_PATH = path.join(
    AGENT_PACK_ROOT,
    "templates",
    "project-vscode-extensions.json"
);
const PROJECT_RECEIPT_RELATIVE_PATH = ".gmloop/agent-pack.json";
const PROJECT_SKILLS_RELATIVE_PATH = ".agents/skills";
const PROJECT_GITIGNORE_RELATIVE_PATH = ".gitignore";
const PROJECT_VSCODE_SETTINGS_RELATIVE_PATH = ".vscode/settings.json";
const PROJECT_VSCODE_EXTENSIONS_RELATIVE_PATH = ".vscode/extensions.json";
const PROJECT_GITIGNORE_SECTION_HEADING = "# GMLoop generated files";
const GMLOOP_SKILL_NAME_PREFIX = "gmloop-";
const GMLOOP_VSCODE_EXTENSION_ID = "gmloop.gmloop";
const SYNCHRONIZATION_MANAGED_FILE = "managed-file" as const;

let cachedResourcePreviews: Promise<ReadonlyArray<AgentPackResourcePreview>> | null = null;

/** Installation state for the agent pack in one GameMaker project. */
export type AgentPackProjectStatusKind = "current" | "not-installed" | "update-available";

/** Version and conflict state for the agent pack in one GameMaker project. */
export type AgentPackProjectStatus = Readonly<{
    agentConfigs: ReadonlyArray<AgentIntegrationTarget>;
    availableVersion: string;
    conflicts: ReadonlyArray<string>;
    installedVersion: string | null;
    status: AgentPackProjectStatusKind;
}>;

/** Deterministic result of materializing the agent pack into a project. */
export type AgentPackInitializationResult = Readonly<{
    added: ReadonlyArray<string>;
    agentConfigs: ReadonlyArray<AgentIntegrationTarget>;
    agentSetup: AgentIntegrationSetupSummary;
    availableVersion: string;
    changed: boolean;
    conflicts: ReadonlyArray<string>;
    projectRoot: string;
    removed: ReadonlyArray<string>;
    unchanged: ReadonlyArray<string>;
    updated: ReadonlyArray<string>;
    vscodeSetup: AgentPackVSCodeSetupSummary;
}>;

/** Result of optional VSCode project setup and extension installation. */
export type AgentPackVSCodeSetupSummary = Readonly<{
    enabled: boolean;
    extensionInstall: Readonly<{
        detail: string;
        status: "failed" | "installed" | "skipped";
    }>;
}>;

/** Options controlling optional project hygiene during agent-pack initialization. */
export type AgentPackInitializationOptions = Readonly<{
    agentTargets?: ReadonlyArray<AgentConfigTargetSelection>;
    commandRunner?: AgentCliCommandRunner;
    includeGitIgnore: boolean;
    includeVSCode?: boolean;
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
        throw new TypeError(
            `${AGENT_PACK_NAME} receipt field '${fieldName}' must be an object of string values: ${sourcePath}`
        );
    }
    const entries = Object.entries(value);
    const unsafeEntry = entries.find((entry) => !isSafeProjectRelativePath(entry[0]) || typeof entry[1] !== "string");
    if (unsafeEntry !== undefined) {
        const [unsafePath, unsafeValue] = unsafeEntry;
        const reason =
            typeof unsafeValue === "string"
                ? `unsafe path "${unsafePath}"`
                : `value of kind ${unsafeValue === null ? "null" : typeof unsafeValue}`;
        throw new TypeError(`${AGENT_PACK_NAME} receipt field '${fieldName}' is malformed (${reason}): ${sourcePath}`);
    }
    return Object.freeze(Object.fromEntries(entries) as Record<string, string>);
}

function parseStringArray(value: unknown, fieldName: string, sourcePath: string): ReadonlyArray<string> {
    if (!Array.isArray(value)) {
        throw new TypeError(
            `${AGENT_PACK_NAME} receipt field '${fieldName}' must be an array of strings: ${sourcePath}`
        );
    }
    const nonStringIndex = value.findIndex((entry) => typeof entry !== "string");
    if (nonStringIndex !== -1) {
        const offendingValue = value[nonStringIndex];
        const actualKind = offendingValue === null ? "null" : typeof offendingValue;
        throw new TypeError(
            `${AGENT_PACK_NAME} receipt field '${fieldName}' entry at index ${nonStringIndex} must be a string, received ${actualKind}: ${sourcePath}`
        );
    }
    return Object.freeze([...value].sort());
}

/**
 * Parse the contents of a project-local agent-pack receipt into a typed
 * {@link AgentPackReceipt}.
 *
 * The receipt records the installed agent-pack version, the conflicts the
 * installer previously detected, and the source hashes for every packaged
 * file shipped to the project. Because the file is a user-editable JSON
 * artifact under `.gmloop/agent-pack.json`, the parser must surface every
 * failure mode as a structured {@link TypeError} that identifies the
 * offending source path — the previous implementation let the raw
 * `SyntaxError` from `JSON.parse` escape through and folded shape
 * mismatches into a single catch-all branch, which made CLI failures hard
 * to diagnose whenever a hand-edited receipt drifted out of sync with the
 * schema (truncated JSON, wrong `package` discriminant, non-string
 * `version`, etc.).
 *
 * Every failure mode — malformed JSON, non-object top-level value,
 * unexpected `package`, missing or non-string `version`, empty `version`,
 * and per-element validation of `conflicts` / `files` — now surfaces a
 * `TypeError` whose message names the source path and the specific
 * condition that triggered the rejection. The original `SyntaxError` is
 * preserved on the new error via `cause` so callers can still recover the
 * parser's line/column detail when surfacing the failure.
 *
 * @param source Raw receipt file contents, exactly as read from disk.
 * @param sourcePath Absolute or project-relative path included in error
 *                   messages to trace the failure back to its on-disk
 *                   origin.
 * @returns A frozen {@link AgentPackReceipt} with deterministic ordering.
 * @throws {TypeError} When the payload is not valid JSON, is not a JSON
 *                     object, has an unexpected `package` discriminant,
 *                     has a missing/empty/non-string `version`, or
 *                     contains `conflicts` / `files` entries that fail
 *                     per-element validation. The error message always
 *                     names the source path and identifies the specific
 *                     failure.
 */
function parseAgentPackReceipt(source: string, sourcePath: string): AgentPackReceipt {
    let parsed: unknown;
    try {
        parsed = JSON.parse(source);
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new TypeError(`${AGENT_PACK_NAME} receipt JSON is malformed (${reason}): ${sourcePath}`, {
            cause: error
        });
    }

    if (!isRecord(parsed)) {
        const actualKind = parsed === null ? "null" : Array.isArray(parsed) ? "an array" : typeof parsed;
        throw new TypeError(`${AGENT_PACK_NAME} receipt must be a JSON object, received ${actualKind}: ${sourcePath}`);
    }

    if (parsed.package !== AGENT_PACK_NAME) {
        const actualPackage = parsed.package;
        const actualDescription =
            typeof actualPackage === "string"
                ? `"${actualPackage}"`
                : actualPackage === null
                  ? "null"
                  : typeof actualPackage;
        throw new TypeError(
            `${AGENT_PACK_NAME} receipt has unexpected package ${actualDescription}, expected "${AGENT_PACK_NAME}": ${sourcePath}`
        );
    }

    const { version } = parsed;
    if (typeof version !== "string") {
        const actualKind = version === null ? "null" : Array.isArray(version) ? "array" : typeof version;
        throw new TypeError(
            `${AGENT_PACK_NAME} receipt version must be a string, received ${actualKind}: ${sourcePath}`
        );
    }
    if (version.trim().length === 0) {
        throw new TypeError(`${AGENT_PACK_NAME} receipt version must be a non-empty string: ${sourcePath}`);
    }

    return Object.freeze({
        conflicts: parseStringArray(parsed.conflicts === undefined ? [] : parsed.conflicts, "conflicts", sourcePath),
        files: parseStringRecord(parsed.files === undefined ? {} : parsed.files, "files", sourcePath),
        package: AGENT_PACK_NAME,
        version
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
            packagePath: "templates/project-vscode-settings.json",
            sourcePath: PROJECT_VSCODE_SETTINGS_TEMPLATE_PATH,
            synchronization: "merge",
            targetPath: PROJECT_VSCODE_SETTINGS_RELATIVE_PATH
        },
        {
            kind: "template",
            packagePath: "templates/project-vscode-extensions.json",
            sourcePath: PROJECT_VSCODE_EXTENSIONS_TEMPLATE_PATH,
            synchronization: "merge",
            targetPath: PROJECT_VSCODE_EXTENSIONS_RELATIVE_PATH
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

/**
 * Build a diagnostic message for the "expected a JSON object, got <kind>"
 * shape failures raised by {@link parseJsonObject}.
 *
 * Delegates value classification to {@link Core.describeValueWithArticle} so
 * the phrasing (`"an array"`, `"a number"`, `"a boolean"`, `"null"`, …)
 * matches every other input-parsing call site in the monorepo. The empty
 * string label (`"an empty string"`) is reused so the same diagnostic reads
 * identically whether the failure originates from this module or from the
 * shared `parsePackageJsonContents` helper.
 */
function buildProjectJsonObjectErrorMessage(sourcePath: string, payload: unknown): string {
    return (
        `${AGENT_PACK_NAME} project file must contain a JSON object at ${sourcePath}. ` +
        `Received ${Core.describeValueWithArticle(payload, { emptyStringLabel: "an empty string" })}.`
    );
}

/**
 * Parse a JSON file used by the merge routines and assert the result is a
 * plain object suitable for in-place key insertion.
 *
 * The previous implementation let the raw `SyntaxError` from `JSON.parse`
 * escape through and surfaced a single-shape `"Expected a JSON object"`
 * error when the parsed value was an array or primitive. That made it
 * impossible to distinguish hand-truncated files (which crashed the CLI
 * with an opaque "Unexpected token" message) from hand-edited files of the
 * wrong shape (which surfaced as a bare `"Expected a JSON object in …"`
 * error without naming the actual kind).
 *
 * The hardened variant delegates the syntactic parse to
 * {@link Core.parseJsonObjectWithContext}, which decorates any
 * {@link SyntaxError} with the source path and the description of the
 * document being parsed and preserves the underlying parser failure via
 * `cause`. Shape mismatches now surface as a {@link TypeError} whose
 * message names both the offending file and the actual value kind
 * (`"an array"`, `"a number"`, `"null"`, …), so the `try`/`catch` blocks
 * around the call sites can still downgrade them to a `"conflict"`
 * disposition while diagnostic logs identify the root cause without
 * additional plumbing.
 *
 * @param source Raw file contents exactly as read from disk.
 * @param sourcePath Path surfaced in error messages so callers can map
 *                   the failure back to a specific template or user
 *                   project file.
 * @returns A plain object parsed from {@link source}.
 * @throws {TypeError} | {SyntaxError} When the payload fails the syntactic
 *                     or shape contract. The thrown error always names
 *                     {@link sourcePath} and, for shape failures, the
 *                     actual value kind.
 */
function parseJsonObject(source: string, sourcePath: string): Record<string, unknown> {
    return Core.parseJsonObjectWithContext(source, {
        source: sourcePath,
        description: `${AGENT_PACK_NAME} project file`,
        createAssertOptions: (payload) => ({
            errorMessage: buildProjectJsonObjectErrorMessage(sourcePath, payload)
        })
    });
}

async function mergeJsonObjectProjectFile(
    projectRoot: string,
    targetRelativePath: string,
    templatePath: string
): Promise<ProjectFileDisposition> {
    const targetPath = resolveProjectFilePath(projectRoot, targetRelativePath);
    const packagedObject = parseJsonObject(await readFile(templatePath, "utf8"), templatePath);
    if (!(await pathExists(targetPath))) {
        await mkdir(path.dirname(targetPath), { recursive: true });
        await writeFile(targetPath, `${JSON.stringify(packagedObject, null, 2)}\n`, "utf8");
        return Object.freeze({ kind: "added", targetRelativePath });
    }

    let existingObject: Record<string, unknown>;
    try {
        existingObject = parseJsonObject(await readFile(targetPath, "utf8"), targetPath);
    } catch {
        return Object.freeze({ kind: "conflict", targetRelativePath });
    }
    let changed = false;
    for (const [key, value] of Object.entries(packagedObject)) {
        if (existingObject[key] === undefined) {
            existingObject[key] = value;
            changed = true;
        }
    }

    if (!changed) {
        return Object.freeze({ kind: "unchanged", targetRelativePath });
    }

    await writeFile(targetPath, `${JSON.stringify(existingObject, null, 2)}\n`, "utf8");
    return Object.freeze({ kind: "updated", targetRelativePath });
}

function normalizeStringArray(value: unknown): ReadonlyArray<string> {
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

async function mergeVSCodeExtensionsProjectFile(projectRoot: string): Promise<ProjectFileDisposition> {
    const targetPath = resolveProjectFilePath(projectRoot, PROJECT_VSCODE_EXTENSIONS_RELATIVE_PATH);
    const packagedObject = parseJsonObject(
        await readFile(PROJECT_VSCODE_EXTENSIONS_TEMPLATE_PATH, "utf8"),
        PROJECT_VSCODE_EXTENSIONS_TEMPLATE_PATH
    );
    const packagedRecommendations = normalizeStringArray(packagedObject.recommendations);

    if (!(await pathExists(targetPath))) {
        await mkdir(path.dirname(targetPath), { recursive: true });
        await writeFile(
            targetPath,
            `${JSON.stringify({ recommendations: packagedRecommendations }, null, 2)}\n`,
            "utf8"
        );
        return Object.freeze({ kind: "added", targetRelativePath: PROJECT_VSCODE_EXTENSIONS_RELATIVE_PATH });
    }

    let existingObject: Record<string, unknown>;
    try {
        existingObject = parseJsonObject(await readFile(targetPath, "utf8"), targetPath);
    } catch {
        return Object.freeze({ kind: "conflict", targetRelativePath: PROJECT_VSCODE_EXTENSIONS_RELATIVE_PATH });
    }
    const recommendations = normalizeStringArray(existingObject.recommendations);
    const mergedRecommendations = [...recommendations];
    for (const recommendation of packagedRecommendations) {
        if (!mergedRecommendations.includes(recommendation)) {
            mergedRecommendations.push(recommendation);
        }
    }

    if (mergedRecommendations.length === recommendations.length) {
        return Object.freeze({ kind: "unchanged", targetRelativePath: PROJECT_VSCODE_EXTENSIONS_RELATIVE_PATH });
    }

    await writeFile(
        targetPath,
        `${JSON.stringify({ ...existingObject, recommendations: mergedRecommendations }, null, 2)}\n`,
        "utf8"
    );
    return Object.freeze({ kind: "updated", targetRelativePath: PROJECT_VSCODE_EXTENSIONS_RELATIVE_PATH });
}

async function setupProjectVSCodeFiles(projectRoot: string): Promise<ReadonlyArray<ProjectFileDisposition>> {
    return Object.freeze([
        await mergeJsonObjectProjectFile(
            projectRoot,
            PROJECT_VSCODE_SETTINGS_RELATIVE_PATH,
            PROJECT_VSCODE_SETTINGS_TEMPLATE_PATH
        ),
        await mergeVSCodeExtensionsProjectFile(projectRoot)
    ]);
}

async function installVSCodeExtension(
    projectRoot: string,
    commandRunner: AgentCliCommandRunner
): Promise<AgentPackVSCodeSetupSummary["extensionInstall"]> {
    const result = await commandRunner("code", ["--install-extension", GMLOOP_VSCODE_EXTENSION_ID], {
        cwd: projectRoot
    });
    if (result.exitCode === 0) {
        return Object.freeze({
            detail: `Installed VSCode extension '${GMLOOP_VSCODE_EXTENSION_ID}'.`,
            status: "installed"
        });
    }

    const details = [result.stderr.trim(), result.stdout.trim()].filter((line) => line.length > 0).join("\n");
    return Object.freeze({
        detail:
            details.length > 0
                ? details
                : `Unable to install VSCode extension '${GMLOOP_VSCODE_EXTENSION_ID}' with the 'code' CLI.`,
        status: "failed"
    });
}

function createSkippedVSCodeSetupSummary(): AgentPackVSCodeSetupSummary {
    return Object.freeze({
        enabled: false,
        extensionInstall: Object.freeze({
            detail: "VSCode setup was not requested.",
            status: "skipped"
        })
    });
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
export function readAgentPackResourcePreviews(): Promise<ReadonlyArray<AgentPackResourcePreview>> {
    if (cachedResourcePreviews !== null) {
        return cachedResourcePreviews;
    }

    cachedResourcePreviews = (async () => {
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
    })();

    return cachedResourcePreviews;
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
    const [availableVersion, agentConfigs] = await Promise.all([
        readAgentPackVersion(),
        discoverAgentIntegrationTargets(resolvedProjectRoot)
    ]);
    const receipt = await readAgentPackReceipt(resolvedProjectRoot);
    if (receipt === null) {
        return Object.freeze({
            agentConfigs,
            availableVersion,
            conflicts: Object.freeze([]),
            installedVersion: null,
            status: "not-installed"
        });
    }
    return Object.freeze({
        agentConfigs,
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
    const agentTargets = options.agentTargets ?? ["detected"];
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
    const vscodeFileDispositions =
        options.includeVSCode === true ? await setupProjectVSCodeFiles(resolvedProjectRoot) : [];
    const vscodeSetup: AgentPackVSCodeSetupSummary =
        options.includeVSCode === true
            ? Object.freeze({
                  enabled: true,
                  extensionInstall: await installVSCodeExtension(
                      resolvedProjectRoot,
                      options.commandRunner ?? runAgentCliCommand
                  )
              })
            : createSkippedVSCodeSetupSummary();
    const dispositions = [
        ...synchronizedFiles,
        ...obsoleteFiles.filter((result) => result !== null),
        ...vscodeFileDispositions,
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
    const agentIntegrationResult = await configureSelectedAgentIntegrations(
        resolvedProjectRoot,
        agentTargets,
        options.commandRunner
    );

    return Object.freeze({
        added: Object.freeze(added),
        agentConfigs: agentIntegrationResult.targets,
        agentSetup: agentIntegrationResult.setup,
        availableVersion,
        changed:
            added.length > 0 ||
            removed.length > 0 ||
            updated.length > 0 ||
            agentIntegrationResult.setup.configured.length > 0 ||
            vscodeSetup.extensionInstall.status === "installed" ||
            !agentPackReceiptsMatch(previousReceipt, receipt),
        conflicts: Object.freeze(sortedConflicts),
        projectRoot: resolvedProjectRoot,
        removed: Object.freeze(removed),
        unchanged: Object.freeze(unchanged),
        updated: Object.freeze(updated),
        vscodeSetup
    });
}

/**
 * Test-only surface that exposes the receipt comparison helpers and the
 * hardened receipt parser so the dedicated test files can exercise them
 * directly without having to drive the full project initialization pipeline.
 * The named `__agentPackTest__` marker keeps these references out of the
 * public API while still being discoverable for the internal test suite.
 *
 * `parseJsonObject` is exposed alongside the receipt parser so the merge
 * helper has parity with `parseAgentPackReceipt` — both surface structured
 * `TypeError`s that name the offending source path and the actual value
 * kind, and both are covered by dedicated hardening tests.
 */
export const __agentPackTest__ = Object.freeze({
    agentPackReceiptsMatch,
    areStringArraysEqual,
    areStringRecordsEqual,
    parseAgentPackReceipt,
    parseJsonObject
});
