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
    clearLogs(): void;
    readLogs(options?: { errorsOnly?: boolean; filter?: string; kind?: "all" | RunnerLogKind }): Array<RunnerLogEntry>;
    readSnapshot(): RunnerSnapshot;
    setRoom(room: string): void;
    setState(state: RunnerLifecycleState): void;
};

function createRunnerStateStore(): RunnerStateStore {
    let state: RunnerLifecycleState = "stopped";
    let room: string | null = null;
    let lastUpdatedAt = Date.now();
    const logs: Array<RunnerLogEntry> = [];

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
            return logEntry;
        },
        clearLogs() {
            logs.length = 0;
            touch();
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
        },
        setState(nextState) {
            state = nextState;
            touch();
        }
    };
}

const sharedRunnerStateStore = createRunnerStateStore();

export function getRunnerStateStore(): RunnerStateStore {
    return sharedRunnerStateStore;
}
