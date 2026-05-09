import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { Core } from "@gmloop/core";

import { isRecord } from "../../shared/error-guards.js";

const { sortObjectKeys } = Core;

/**
 * Persisted runtime log entry scoped to one project.
 */
export type RuntimeLogEntry = Readonly<{
    message: string;
    timestamp: number;
}>;

/**
 * Runtime state payload persisted under `.gmloop/runtime/state.json`.
 */
export type RuntimeProjectState = Readonly<{
    globals: Record<string, unknown>;
    instances: Record<string, Record<string, unknown>>;
    logs: ReadonlyArray<RuntimeLogEntry>;
}>;

const EMPTY_RUNTIME_STATE: RuntimeProjectState = {
    globals: {},
    instances: {},
    logs: []
};

function resolveRuntimeStatePath(projectRoot: string): string {
    return path.join(projectRoot, ".gmloop", "runtime", "state.json");
}

function normalizeLogEntries(value: unknown): Array<RuntimeLogEntry> {
    if (!Array.isArray(value)) {
        return [];
    }

    const logs: Array<RuntimeLogEntry> = [];
    for (const entry of value) {
        if (!isRecord(entry)) {
            continue;
        }
        const message = typeof entry.message === "string" ? entry.message : "";
        const timestamp = typeof entry.timestamp === "number" && Number.isFinite(entry.timestamp) ? entry.timestamp : 0;
        logs.push(
            Object.freeze({
                message,
                timestamp
            })
        );
    }

    logs.sort((left, right) => left.timestamp - right.timestamp || left.message.localeCompare(right.message));
    return logs;
}

function normalizeRuntimeState(value: unknown): RuntimeProjectState {
    if (!isRecord(value)) {
        return EMPTY_RUNTIME_STATE;
    }

    const globals = isRecord(value.globals) ? value.globals : {};
    const instancesValue = isRecord(value.instances) ? value.instances : {};
    const normalizedInstances: Record<string, Record<string, unknown>> = {};

    for (const instanceId of Object.keys(instancesValue).sort()) {
        const instanceState = instancesValue[instanceId];
        if (!isRecord(instanceState)) {
            continue;
        }
        normalizedInstances[instanceId] = instanceState;
    }

    return {
        globals: { ...globals },
        instances: normalizedInstances,
        logs: normalizeLogEntries(value.logs)
    };
}

/**
 * Read runtime state for a project, returning an empty state when none exists.
 */
export function readRuntimeProjectState(projectRoot: string): RuntimeProjectState {
    const statePath = resolveRuntimeStatePath(path.resolve(projectRoot));

    try {
        const raw = readFileSync(statePath, "utf8");
        return normalizeRuntimeState(JSON.parse(raw) as unknown);
    } catch {
        return EMPTY_RUNTIME_STATE;
    }
}

/**
 * Persist runtime state for a project with deterministic key ordering.
 */
export function writeRuntimeProjectState(projectRoot: string, state: RuntimeProjectState): void {
    const resolvedProjectRoot = path.resolve(projectRoot);
    const statePath = resolveRuntimeStatePath(resolvedProjectRoot);
    mkdirSync(path.dirname(statePath), { recursive: true });

    const normalized = {
        globals: sortObjectKeys(state.globals),
        instances: sortObjectKeys(state.instances),
        logs: [...state.logs].sort(
            (left, right) => left.timestamp - right.timestamp || left.message.localeCompare(right.message)
        )
    };

    writeFileSync(statePath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
}
