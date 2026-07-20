import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { Core } from "@gmloop/core";

import { isRecord } from "../../shared/error-guards.js";

const { readJsonFileSyncOrDefault, stringifyJsonForFile } = Core;

type RunnerLifecycleState = "paused" | "running" | "stopped";

export type RunnerLogKind = "compile" | "runtime";

export type RunnerLogEntry = Readonly<{
    kind: RunnerLogKind;
    level: "error" | "info";
    message: string;
    timestamp: number;
}>;

export type RunnerSnapshot = Readonly<{
    lastUpdatedAt: number;
    logCount: number;
    room: string | null;
    state: RunnerLifecycleState;
}>;

/**
 * Project root binding for the runner state store.
 *
 * Provides the ability to rebind the singleton to a different `.gmloop/runtime`
 * directory and hydrate its in-memory view from disk. Consumers that only need
 * to (re)target the store without mutating lifecycle, room, or log state can
 * depend on this interface alone, keeping the runner controller helpers free
 * of unrelated capabilities.
 */
export interface RunnerProjectBinder {
    bindProjectRoot(projectRoot: string): void;
}

/**
 * Read-only snapshot inspection.
 *
 * Provides access to a frozen snapshot of the persisted state (lifecycle,
 * active room, log count, last-update timestamp). Consumers that only need to
 * surface status — never to mutate — depend on this role.
 */
export interface RunnerSnapshotReader {
    readSnapshot(): RunnerSnapshot;
}

/**
 * Runner process lifecycle control.
 *
 * Provides the ability to set the runner lifecycle status without coupling to
 * room tracking, log management, or project binding.
 */
export interface RunnerLifecycleStateController {
    setState(state: RunnerLifecycleState): void;
}

/**
 * Active-room control.
 *
 * Provides the ability to set the runner's active room without coupling to
 * lifecycle state, logs, or project binding.
 */
export interface RunnerRoomController {
    setRoom(room: string): void;
}

/** Filter options supported by {@link RunnerLogReader.readLogs}. */
export type RunnerLogReadOptions = {
    errorsOnly?: boolean;
    filter?: string;
    kind?: "all" | RunnerLogKind;
};

/**
 * Log reader.
 *
 * Provides read-only access to the persisted runner log stream without
 * coupling to log mutation or other runner state concerns.
 */
export interface RunnerLogReader {
    readLogs(options?: RunnerLogReadOptions): Array<RunnerLogEntry>;
}

/**
 * Log writer.
 *
 * Provides the ability to append a new log entry to the persisted stream
 * without coupling to log clearing or other runner state concerns.
 */
export interface RunnerLogWriter {
    appendLog(entry: Omit<RunnerLogEntry, "timestamp">): RunnerLogEntry;
}

/**
 * Log clearer.
 *
 * Provides the ability to drop all entries from the persisted log stream
 * without coupling to log reads, log writes, or other runner state concerns.
 */
export interface RunnerLogClearer {
    clearLogs(): void;
}

/**
 * Composite runner state store interface.
 *
 * Combines every role interface so the shared singleton can expose the full
 * surface to callers that genuinely need every capability (e.g. integration
 * tests that exercise end-to-end flows). Consumers that only need a subset
 * should depend on the relevant role interface directly:
 *
 * - {@link RunnerProjectBinder} to (re)bind the store to a project root.
 * - {@link RunnerLifecycleStateController} to update the runner status.
 * - {@link RunnerRoomController} to track the active room.
 * - {@link RunnerLogWriter} / {@link RunnerLogReader} / {@link RunnerLogClearer}
 *   to manage the persisted log stream.
 * - {@link RunnerSnapshotReader} to read a frozen status snapshot.
 *
 * This split mirrors the Interface Segregation Principle: each role models a
 * single cohesive responsibility and exposes only the methods its consumers
 * require, preventing accidental coupling between unrelated subsystems of the
 * runner state machine.
 */
export interface RunnerStateStore
    extends
        RunnerProjectBinder,
        RunnerSnapshotReader,
        RunnerLifecycleStateController,
        RunnerRoomController,
        RunnerLogReader,
        RunnerLogWriter,
        RunnerLogClearer {}

type PersistedRunnerState = Readonly<{
    lastUpdatedAt: number;
    logs: Array<RunnerLogEntry>;
    room: string | null;
    state: RunnerLifecycleState;
}>;

const DEFAULT_PERSISTED_STATE: PersistedRunnerState = Object.freeze({
    lastUpdatedAt: 0,
    logs: [],
    room: null,
    state: "stopped"
});

function resolveRunnerStatePath(projectRoot: string): string {
    return path.join(projectRoot, ".gmloop", "runtime", "runner-state.json");
}

/**
 * Compare two {@link RunnerLogEntry} values for stable ordering.
 *
 * Logs are sorted first by ascending timestamp and then by message as a
 * deterministic tie-breaker so logs emitted in the same millisecond keep a
 * predictable sequence across reads and writes.
 */
function compareRunnerLogEntries(left: RunnerLogEntry, right: RunnerLogEntry): number {
    return left.timestamp - right.timestamp || left.message.localeCompare(right.message);
}

function normalizeRunnerState(value: unknown): PersistedRunnerState {
    if (!isRecord(value)) {
        return DEFAULT_PERSISTED_STATE;
    }

    const state = value.state;
    const normalizedState: RunnerLifecycleState = state === "running" || state === "paused" ? state : "stopped";
    const room = typeof value.room === "string" ? value.room : null;
    const lastUpdatedAt =
        typeof value.lastUpdatedAt === "number" && Number.isFinite(value.lastUpdatedAt) ? value.lastUpdatedAt : 0;
    const logsValue = Array.isArray(value.logs) ? value.logs : [];
    const logs: Array<RunnerLogEntry> = [];

    for (const entry of logsValue) {
        if (!isRecord(entry)) {
            continue;
        }
        const level = entry.level === "error" ? "error" : "info";
        const kind = entry.kind === "compile" ? "compile" : "runtime";
        const message = typeof entry.message === "string" ? entry.message : "";
        const timestamp = typeof entry.timestamp === "number" && Number.isFinite(entry.timestamp) ? entry.timestamp : 0;
        logs.push(
            Object.freeze({
                kind,
                level,
                message,
                timestamp
            })
        );
    }

    logs.sort(compareRunnerLogEntries);

    return Object.freeze({
        lastUpdatedAt,
        logs,
        room,
        state: normalizedState
    });
}

function readPersistedRunnerState(projectRoot: string): PersistedRunnerState {
    return readJsonFileSyncOrDefault(
        resolveRunnerStatePath(projectRoot),
        normalizeRunnerState,
        DEFAULT_PERSISTED_STATE
    );
}

function writePersistedRunnerState(projectRoot: string, state: PersistedRunnerState): void {
    const statePath = resolveRunnerStatePath(projectRoot);
    mkdirSync(path.dirname(statePath), { recursive: true });
    const payload = {
        ...state,
        logs: [...state.logs].sort(compareRunnerLogEntries)
    };
    writeFileSync(statePath, stringifyJsonForFile(payload, { space: 2 }), "utf8");
}

function createRunnerStateStore(): RunnerStateStore {
    let state: RunnerLifecycleState = "stopped";
    let room: string | null = null;
    let lastUpdatedAt = Date.now();
    const logs: Array<RunnerLogEntry> = [];
    let activeProjectRoot = path.resolve(process.cwd());

    function persist(): void {
        writePersistedRunnerState(activeProjectRoot, {
            lastUpdatedAt,
            logs,
            room,
            state
        });
    }

    function touch(): void {
        lastUpdatedAt = Date.now();
    }

    return {
        appendLog(entry) {
            const logEntry: RunnerLogEntry = Object.freeze({
                ...entry,
                timestamp: Date.now()
            });
            logs.push(logEntry);
            touch();
            persist();
            return logEntry;
        },
        bindProjectRoot(projectRoot) {
            const resolvedProjectRoot = path.resolve(projectRoot);
            activeProjectRoot = resolvedProjectRoot;
            const persisted = readPersistedRunnerState(resolvedProjectRoot);
            state = persisted.state;
            room = persisted.room;
            lastUpdatedAt = persisted.lastUpdatedAt;
            logs.length = 0;
            logs.push(...persisted.logs);
        },
        clearLogs() {
            logs.length = 0;
            touch();
            persist();
        },
        readLogs(options: RunnerLogReadOptions = {}) {
            const { errorsOnly = false, filter, kind = "all" } = options;
            const normalizedFilter = typeof filter === "string" ? filter.trim().toLowerCase() : "";
            return logs.filter((entry) => {
                if (kind !== "all" && entry.kind !== kind) {
                    return false;
                }
                if (errorsOnly && entry.level !== "error") {
                    return false;
                }
                if (normalizedFilter.length > 0 && !entry.message.toLowerCase().includes(normalizedFilter)) {
                    return false;
                }
                return true;
            });
        },
        readSnapshot() {
            return Object.freeze({
                lastUpdatedAt,
                logCount: logs.length,
                room,
                state
            });
        },
        setRoom(nextRoom) {
            room = nextRoom;
            touch();
            persist();
        },
        setState(nextState) {
            state = nextState;
            touch();
            persist();
        }
    };
}

const sharedRunnerStateStore = createRunnerStateStore();

export function getRunnerStateStore(): RunnerStateStore {
    return sharedRunnerStateStore;
}
