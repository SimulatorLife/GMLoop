import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

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

type RunnerStateStore = {
    appendLog(entry: Omit<RunnerLogEntry, "timestamp">): RunnerLogEntry;
    bindProjectRoot(projectRoot: string): void;
    clearLogs(): void;
    readLogs(options?: { errorsOnly?: boolean; filter?: string; kind?: "all" | RunnerLogKind }): Array<RunnerLogEntry>;
    readSnapshot(): RunnerSnapshot;
    setRoom(room: string): void;
    setState(state: RunnerLifecycleState): void;
};

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

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
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

    logs.sort((left, right) => left.timestamp - right.timestamp || left.message.localeCompare(right.message));

    return Object.freeze({
        lastUpdatedAt,
        logs,
        room,
        state: normalizedState
    });
}

function readPersistedRunnerState(projectRoot: string): PersistedRunnerState {
    const statePath = resolveRunnerStatePath(projectRoot);
    try {
        const raw = readFileSync(statePath, "utf8");
        return normalizeRunnerState(JSON.parse(raw) as unknown);
    } catch {
        return DEFAULT_PERSISTED_STATE;
    }
}

function writePersistedRunnerState(projectRoot: string, state: PersistedRunnerState): void {
    const statePath = resolveRunnerStatePath(projectRoot);
    mkdirSync(path.dirname(statePath), { recursive: true });
    writeFileSync(
        statePath,
        `${JSON.stringify(
            {
                ...state,
                logs: [...state.logs].sort(
                    (left, right) => left.timestamp - right.timestamp || left.message.localeCompare(right.message)
                )
            },
            null,
            2
        )}\n`,
        "utf8"
    );
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
        readLogs(options = {}) {
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
