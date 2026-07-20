import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { Core } from "@gmloop/core";

import type { CommanderCommandLike } from "../../cli-core/commander-types.js";
import { discoverProjectRoot } from "../../workflow/project-root.js";

const OPERATION_STATE_FILE_NAME = "operation-state.json";
const OPERATION_LOCK_FILE_NAME = "operation-state.lock";
const OPERATION_STATE_VERSION = 1;
const MAX_OPERATION_MESSAGES = 200;
const SEMANTIC_INDEX_PROGRESS_PERSIST_INTERVAL_MS = 100;
const PARENT_PROJECT_OPERATION_ENVIRONMENT_VARIABLE = "GMLOOP_PARENT_PROJECT_OPERATION_ID";

/** Operations that coordinate project-wide work through the shared state file. */
export type ProjectOperationKind = "fix" | "format" | "lint" | "refactor" | "live-reload" | "semantic-index";

/** Summary reported once a semantic index build finishes: slowest files and manifest cache hit/miss counts. */
export type ProjectSemanticIndexBuildSummary = Readonly<{
    cacheHitCount: number;
    cacheMissCount: number;
    slowestFiles: ReadonlyArray<Readonly<{ relativePath: string; durationMs: number }>>;
    totalDurationMs: number;
}>;

/** Progress emitted while the semantic project index parses project sources, or the final summary once it completes. */
export type ProjectSemanticIndexProgress =
    | Readonly<{ current: number; stage: "gml-parse"; total: number }>
    | Readonly<{ stage: "complete"; summary: ProjectSemanticIndexBuildSummary }>;

/** Lifecycle status persisted for a project operation. */
export type ProjectOperationStatus = "running" | "succeeded" | "failed";

/** Persisted description of one project operation. */
export type ProjectOperationRecord = Readonly<{
    command: string;
    completedAt: number | null;
    id: string;
    kind: ProjectOperationKind;
    messages: ReadonlyArray<string>;
    phase: string;
    pid: number;
    projectRoot: string;
    semanticIndex: ProjectSemanticIndexProgress | null;
    startedAt: number;
    status: ProjectOperationStatus;
    updatedAt: number;
}>;

/** Shared project operation state stored under `.gmloop`. */
export type ProjectOperationState = Readonly<{
    active: ProjectOperationRecord | null;
    recent: ReadonlyArray<ProjectOperationRecord>;
    version: 1;
}>;

/** Error raised when another process already owns a project operation. */
export class ProjectOperationConflictError extends Error {
    public readonly activeOperation: ProjectOperationRecord;

    public constructor(activeOperation: ProjectOperationRecord) {
        super(
            `Project operation '${activeOperation.kind}' is already running for ${activeOperation.projectRoot} (operation ${activeOperation.id}).`
        );
        this.name = "ProjectOperationConflictError";
        this.activeOperation = activeOperation;
    }
}

/** A lease that owns or observes the active project operation. */
export type ProjectOperationLease = Readonly<{
    appendMessage: (message: string) => void;
    complete: (status: Exclude<ProjectOperationStatus, "running">) => void;
    id: string;
    ownsProjectLock: boolean;
    projectRoot: string;
    update: (phase: string, message?: string) => void;
    updateSemanticIndexProgress: (progress: ProjectSemanticIndexProgress) => void;
    clearSemanticIndexProgress: () => void;
}>;

/** Descriptor used to acquire a project operation lease. */
export type ProjectOperationDescriptor = Readonly<{
    command: string;
    kind: ProjectOperationKind;
    projectRoot: string;
}>;

type ProcessWriteCallback = (error?: Error | null) => void;

type ProcessWrite = (
    chunk: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | ProcessWriteCallback,
    callback?: ProcessWriteCallback
) => boolean;

type ProjectOperationOutputCapture = Readonly<{
    restore: () => void;
}>;

type PersistedOperationLock = Readonly<{
    id: string;
    pid: number;
}>;

type PersistedObject = Record<string, unknown>;

const EMPTY_PROJECT_OPERATION_STATE: ProjectOperationState = Object.freeze({
    active: null,
    recent: Object.freeze([]),
    version: OPERATION_STATE_VERSION
});

const PROJECT_OPERATION_CONTEXT = new AsyncLocalStorage<ProjectOperationLease>();

function readPersistedObject(value: unknown): PersistedObject | null {
    return Core.isObjectLike(value) ? (value as PersistedObject) : null;
}

function resolveOperationDirectory(projectRoot: string): string {
    return path.join(path.resolve(projectRoot), ".gmloop");
}

function resolveOperationStatePath(projectRoot: string): string {
    return path.join(resolveOperationDirectory(projectRoot), OPERATION_STATE_FILE_NAME);
}

function resolveOperationLockPath(projectRoot: string): string {
    return path.join(resolveOperationDirectory(projectRoot), OPERATION_LOCK_FILE_NAME);
}

function normalizeOperationRecord(value: unknown): ProjectOperationRecord | null {
    const record = readPersistedObject(value);
    if (record === null) {
        return null;
    }

    const kind = record.kind;
    const status = record.status;
    const completedAt = record.completedAt;
    let normalizedCompletedAt: number | null;
    if (completedAt === null) {
        normalizedCompletedAt = null;
    } else if (typeof completedAt === "number") {
        normalizedCompletedAt = completedAt;
    } else {
        return null;
    }
    if (
        (kind !== "fix" &&
            kind !== "format" &&
            kind !== "lint" &&
            kind !== "refactor" &&
            kind !== "live-reload" &&
            kind !== "semantic-index") ||
        (status !== "running" && status !== "succeeded" && status !== "failed") ||
        typeof record.command !== "string" ||
        typeof record.id !== "string" ||
        typeof record.pid !== "number" ||
        typeof record.projectRoot !== "string" ||
        typeof record.startedAt !== "number" ||
        typeof record.updatedAt !== "number" ||
        typeof record.phase !== "string" ||
        !Array.isArray(record.messages)
    ) {
        return null;
    }

    return Object.freeze({
        command: record.command,
        completedAt: normalizedCompletedAt,
        id: record.id,
        kind,
        messages: Object.freeze(record.messages.filter((message): message is string => typeof message === "string")),
        phase: record.phase,
        pid: record.pid,
        projectRoot: record.projectRoot,
        semanticIndex:
            record.semanticIndex === null || record.semanticIndex === undefined
                ? null
                : normalizeSemanticIndexProgress(record.semanticIndex),
        startedAt: record.startedAt,
        status,
        updatedAt: record.updatedAt
    });
}

function normalizeSemanticIndexBuildSummary(value: unknown): ProjectSemanticIndexBuildSummary | null {
    const record = readPersistedObject(value);
    if (
        record === null ||
        typeof record.cacheHitCount !== "number" ||
        typeof record.cacheMissCount !== "number" ||
        typeof record.totalDurationMs !== "number" ||
        !Array.isArray(record.slowestFiles)
    ) {
        return null;
    }
    const slowestFiles = record.slowestFiles.flatMap((entry) => {
        const fileRecord = readPersistedObject(entry);
        return fileRecord !== null &&
            typeof fileRecord.relativePath === "string" &&
            typeof fileRecord.durationMs === "number"
            ? [Object.freeze({ relativePath: fileRecord.relativePath, durationMs: fileRecord.durationMs })]
            : [];
    });
    return Object.freeze({
        cacheHitCount: record.cacheHitCount,
        cacheMissCount: record.cacheMissCount,
        slowestFiles,
        totalDurationMs: record.totalDurationMs
    });
}

function normalizeSemanticIndexProgress(value: unknown): ProjectSemanticIndexProgress | null {
    const record = readPersistedObject(value);
    if (record === null) {
        return null;
    }
    if (record.stage === "complete") {
        const summary = normalizeSemanticIndexBuildSummary(record.summary);
        return summary === null ? null : Object.freeze({ stage: "complete" as const, summary });
    }
    if (
        typeof record.current !== "number" ||
        !Number.isInteger(record.current) ||
        record.current < 0 ||
        typeof record.total !== "number" ||
        !Number.isInteger(record.total) ||
        record.total < 0 ||
        record.stage !== "gml-parse"
    ) {
        return null;
    }
    return Object.freeze({ current: record.current, stage: "gml-parse" as const, total: record.total });
}

function normalizeProjectOperationState(value: unknown): ProjectOperationState {
    const record = readPersistedObject(value);
    if (record === null || record.version !== OPERATION_STATE_VERSION) {
        return EMPTY_PROJECT_OPERATION_STATE;
    }

    const active = normalizeOperationRecord(record.active);
    const recent = Array.isArray(record.recent)
        ? record.recent.flatMap((entry) => {
              const normalizedRecord = normalizeOperationRecord(entry);
              return normalizedRecord === null ? [] : [normalizedRecord];
          })
        : [];
    return Object.freeze({
        active,
        recent: Object.freeze(recent.slice(0, 20)),
        version: OPERATION_STATE_VERSION
    });
}

function writeProjectOperationState(projectRoot: string, state: ProjectOperationState): void {
    const statePath = resolveOperationStatePath(projectRoot);
    const temporaryStatePath = `${statePath}.${String(process.pid)}.tmp`;
    writeFileSync(temporaryStatePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
    renameSync(temporaryStatePath, statePath);
}

function readPersistedProjectOperationState(projectRoot: string): ProjectOperationState {
    return Core.readJsonFileSyncOrDefault(
        resolveOperationStatePath(projectRoot),
        normalizeProjectOperationState,
        EMPTY_PROJECT_OPERATION_STATE
    );
}

/** Return the current operation state for a project, or an empty state when absent. */
export function readProjectOperationState(projectRoot: string): ProjectOperationState {
    return readPersistedProjectOperationState(path.resolve(projectRoot));
}

/** Return the `.gmloop/operation-state.json` path for a project. */
export function resolveProjectOperationStatePath(projectRoot: string): string {
    return resolveOperationStatePath(projectRoot);
}

function normalizeOperationLock(value: unknown): PersistedOperationLock | null {
    const record = readPersistedObject(value);
    if (record === null || typeof record.id !== "string" || typeof record.pid !== "number") {
        return null;
    }
    return Object.freeze({ id: record.id, pid: record.pid });
}

function readOperationLock(projectRoot: string): PersistedOperationLock | null {
    return Core.readJsonFileSyncOrDefault(resolveOperationLockPath(projectRoot), normalizeOperationLock, null);
}

function isProcessAlive(pid: number): boolean {
    if (!Number.isInteger(pid) || pid <= 0) {
        return false;
    }

    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

function releaseOperationLock(projectRoot: string, operationId: string): void {
    const lockPath = resolveOperationLockPath(projectRoot);
    const lock = readOperationLock(projectRoot);
    if (lock?.id === operationId) {
        unlinkSync(lockPath);
    }
}

function createOperationRecord(descriptor: ProjectOperationDescriptor): ProjectOperationRecord {
    const now = Date.now();
    return Object.freeze({
        command: descriptor.command,
        completedAt: null,
        id: randomUUID(),
        kind: descriptor.kind,
        messages: Object.freeze([]),
        phase: "starting",
        pid: process.pid,
        projectRoot: path.resolve(descriptor.projectRoot),
        semanticIndex: null,
        startedAt: now,
        status: "running",
        updatedAt: now
    });
}

function writeActiveOperation(projectRoot: string, record: ProjectOperationRecord): void {
    const state = readPersistedProjectOperationState(projectRoot);
    writeProjectOperationState(projectRoot, {
        active: record,
        recent: state.recent,
        version: OPERATION_STATE_VERSION
    });
}

function appendProcessOutput(
    operation: ProjectOperationLease,
    chunk: string | Uint8Array,
    encoding?: BufferEncoding
): void {
    const text = typeof chunk === "string" ? chunk : Buffer.from(chunk).toString(encoding);
    for (const line of text.split(/\r?\n/u)) {
        operation.appendMessage(line);
    }
}

function startProjectOperationOutputCapture(operation: ProjectOperationLease): ProjectOperationOutputCapture {
    const originalStdoutWrite = process.stdout.write.bind(process.stdout) as ProcessWrite;
    const originalStderrWrite = process.stderr.write.bind(process.stderr) as ProcessWrite;

    const createCaptureWrite = (originalWrite: ProcessWrite): ProcessWrite => {
        const captureWrite: ProcessWrite = (chunk, encodingOrCallback, callback) => {
            const encoding = typeof encodingOrCallback === "string" ? encodingOrCallback : undefined;
            appendProcessOutput(operation, chunk, encoding);
            return originalWrite(chunk, encodingOrCallback, callback);
        };
        return captureWrite;
    };

    process.stdout.write = createCaptureWrite(originalStdoutWrite);
    process.stderr.write = createCaptureWrite(originalStderrWrite);

    return Object.freeze({
        restore: (): void => {
            process.stdout.write = originalStdoutWrite;
            process.stderr.write = originalStderrWrite;
        }
    });
}

function createLease(record: ProjectOperationRecord, ownsProjectLock: boolean): ProjectOperationLease {
    let currentRecord = record;
    let completed = record.status !== "running";
    let lastSemanticIndexProgressPersistAt = 0;

    const persist = (): void => {
        writeActiveOperation(currentRecord.projectRoot, currentRecord);
    };

    const refreshCurrentRecord = (): void => {
        const latestRecord = readPersistedProjectOperationState(currentRecord.projectRoot).active;
        if (latestRecord?.id === currentRecord.id) {
            currentRecord = latestRecord;
        }
    };

    const appendMessage = (message: string): void => {
        const normalizedMessage = message.trim();
        if (completed || normalizedMessage.length === 0) {
            return;
        }
        refreshCurrentRecord();
        currentRecord = Object.freeze({
            ...currentRecord,
            messages: Object.freeze([...currentRecord.messages, normalizedMessage].slice(-MAX_OPERATION_MESSAGES)),
            updatedAt: Date.now()
        });
        persist();
    };

    const update = (phase: string, message?: string): void => {
        if (completed) {
            return;
        }
        refreshCurrentRecord();
        currentRecord = Object.freeze({
            ...currentRecord,
            messages:
                typeof message === "string" && message.trim().length > 0
                    ? Object.freeze([...currentRecord.messages, message.trim()].slice(-MAX_OPERATION_MESSAGES))
                    : currentRecord.messages,
            phase,
            updatedAt: Date.now()
        });
        persist();
    };

    const updateSemanticIndexProgress = (progress: ProjectSemanticIndexProgress): void => {
        if (completed) {
            return;
        }
        refreshCurrentRecord();
        currentRecord = Object.freeze({
            ...currentRecord,
            phase: "semantic-index",
            semanticIndex: Object.freeze({ ...progress }),
            updatedAt: Date.now()
        });
        const now = Date.now();
        const shouldPersist =
            progress.stage === "complete" ||
            progress.current === progress.total ||
            now - lastSemanticIndexProgressPersistAt >= SEMANTIC_INDEX_PROGRESS_PERSIST_INTERVAL_MS;
        if (shouldPersist) {
            lastSemanticIndexProgressPersistAt = now;
            persist();
        }
    };

    const clearSemanticIndexProgress = (): void => {
        if (completed) {
            return;
        }
        refreshCurrentRecord();
        currentRecord = Object.freeze({
            ...currentRecord,
            semanticIndex: null,
            updatedAt: Date.now()
        });
        persist();
    };

    const complete = (status: Exclude<ProjectOperationStatus, "running">): void => {
        if (completed) {
            return;
        }
        refreshCurrentRecord();
        completed = true;
        const completedRecord = Object.freeze({
            ...currentRecord,
            completedAt: Date.now(),
            status,
            updatedAt: Date.now()
        });
        const state = readPersistedProjectOperationState(completedRecord.projectRoot);
        writeProjectOperationState(completedRecord.projectRoot, {
            active: null,
            recent: Object.freeze([
                completedRecord,
                ...state.recent.filter((entry) => entry.id !== completedRecord.id)
            ]).slice(0, 20),
            version: OPERATION_STATE_VERSION
        });
        if (ownsProjectLock) {
            releaseOperationLock(completedRecord.projectRoot, completedRecord.id);
        }
    };

    return Object.freeze({
        appendMessage,
        complete,
        id: record.id,
        ownsProjectLock,
        projectRoot: record.projectRoot,
        update,
        updateSemanticIndexProgress,
        clearSemanticIndexProgress
    });
}

function acquireProjectOperation(descriptor: ProjectOperationDescriptor): ProjectOperationLease {
    const projectRoot = path.resolve(descriptor.projectRoot);
    const activeState = readPersistedProjectOperationState(projectRoot);
    const parentOperationId = process.env[PARENT_PROJECT_OPERATION_ENVIRONMENT_VARIABLE];
    const existingLock = readOperationLock(projectRoot);
    if (
        parentOperationId !== undefined &&
        activeState.active?.status === "running" &&
        activeState.active.id === parentOperationId &&
        existingLock?.pid !== process.pid
    ) {
        return createLease(activeState.active, false);
    }

    const operationDirectory = resolveOperationDirectory(projectRoot);
    mkdirSync(operationDirectory, { recursive: true });
    const lockPath = resolveOperationLockPath(projectRoot);
    const record = createOperationRecord({ ...descriptor, projectRoot });

    try {
        writeFileSync(lockPath, `${JSON.stringify({ id: record.id, pid: process.pid })}\n`, {
            encoding: "utf8",
            flag: "wx"
        });
    } catch (error: unknown) {
        const lock = readOperationLock(projectRoot);
        if (lock !== null && isProcessAlive(lock.pid)) {
            const activeOperation = activeState.active;
            if (activeOperation?.status === "running") {
                throw new ProjectOperationConflictError(activeOperation);
            }
            throw error;
        }
        try {
            unlinkSync(lockPath);
            writeFileSync(lockPath, `${JSON.stringify({ id: record.id, pid: process.pid })}\n`, {
                encoding: "utf8",
                flag: "wx"
            });
        } catch {
            throw error;
        }
    }

    writeActiveOperation(projectRoot, record);
    return createLease(record, true);
}

/**
 * Run one CLI-owned project operation under the shared `.gmloop` state and lock.
 */
export async function runProjectOperation<TValue>(
    descriptor: ProjectOperationDescriptor,
    execute: (operation: ProjectOperationLease) => Promise<TValue>
): Promise<TValue> {
    const operation = acquireProjectOperation(descriptor);
    const outputCapture = startProjectOperationOutputCapture(operation);
    const processEnvironment = process.env;
    const previousParentOperationId = processEnvironment[PARENT_PROJECT_OPERATION_ENVIRONMENT_VARIABLE];
    if (operation.ownsProjectLock) {
        processEnvironment[PARENT_PROJECT_OPERATION_ENVIRONMENT_VARIABLE] = operation.id;
    }
    try {
        operation.update("running", `${descriptor.command} started.`);
        const result = await PROJECT_OPERATION_CONTEXT.run(operation, () => execute(operation));
        outputCapture.restore();
        if (operation.ownsProjectLock) {
            operation.complete("succeeded");
        }
        return result;
    } catch (error: unknown) {
        outputCapture.restore();
        operation.update("failed", Core.getErrorMessage(error, { fallback: `${descriptor.command} failed.` }));
        if (operation.ownsProjectLock) {
            operation.complete("failed");
        }
        throw error;
    } finally {
        if (operation.ownsProjectLock) {
            if (previousParentOperationId === undefined) {
                delete processEnvironment[PARENT_PROJECT_OPERATION_ENVIRONMENT_VARIABLE];
            } else {
                processEnvironment[PARENT_PROJECT_OPERATION_ENVIRONMENT_VARIABLE] = previousParentOperationId;
            }
        }
    }
}

/** Return the operation currently running in this async execution context. */
export function getCurrentProjectOperation(): ProjectOperationLease | null {
    return PROJECT_OPERATION_CONTEXT.getStore() ?? null;
}

function resolveCommandCandidatePath(command: CommanderCommandLike): string | undefined {
    const options = command.opts?.() ?? {};
    if (typeof options.path === "string" && options.path.trim().length > 0) {
        return options.path;
    }

    const candidatePaths = (command.args ?? []).filter(
        (argument) => argument.length > 0 && argument !== "codemod" && !argument.startsWith("-")
    );
    return candidatePaths.at(-1);
}

/** Resolve a command's project root without making project discovery a command-manager concern. */
export async function resolveProjectOperationRoot(command: CommanderCommandLike): Promise<string | null> {
    const options = command.opts?.() ?? {};
    try {
        return await discoverProjectRoot({
            configPath: typeof options.config === "string" ? options.config : undefined,
            explicitProjectPath: resolveCommandCandidatePath(command)
        });
    } catch {
        return null;
    }
}
