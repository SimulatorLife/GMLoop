import { mkdir, writeFile } from "node:fs/promises";
import { Session } from "node:inspector/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { Core } from "@gmloop/core";

import type {
    FixtureProfileAggregateSummary,
    FixtureProfileBudgetFailure,
    FixtureProfileBudgetFailureEntry,
    FixtureProfileBudgets,
    FixtureProfileCollector,
    FixtureProfileEntry,
    FixtureProfileEntryMemorySummary,
    FixtureProfileReport,
    FixtureStageMetrics,
    FixtureStageName
} from "../types.js";

type ResourceUsageSnapshot = ReturnType<typeof process.resourceUsage>;
type MemoryUsageSnapshot = ReturnType<typeof process.memoryUsage>;
type CpuUsageSnapshot = ReturnType<typeof process.cpuUsage>;

const FIXTURE_STAGE_ORDER = Object.freeze(["load", "refactor", "lint", "format", "compare", "total"] as const);
const FIXTURE_STAGE_ORDER_INDEX = new Map(FIXTURE_STAGE_ORDER.map((stageName, index) => [stageName, index]));

function captureStageSnapshot() {
    return Object.freeze({
        startedAt: performance.now(),
        memory: process.memoryUsage(),
        cpu: process.cpuUsage(),
        resource: process.resourceUsage()
    });
}

function toStageMetrics(
    stageName: FixtureStageName,
    snapshot: ReturnType<typeof captureStageSnapshot>
): FixtureStageMetrics {
    const memoryAfter: MemoryUsageSnapshot = process.memoryUsage();
    const cpuAfter: CpuUsageSnapshot = process.cpuUsage();
    const resourceAfter: ResourceUsageSnapshot = process.resourceUsage();

    return Object.freeze({
        stageName,
        durationMs: performance.now() - snapshot.startedAt,
        heapUsedDeltaBytes: memoryAfter.heapUsed - snapshot.memory.heapUsed,
        cpuUserMicros: cpuAfter.user - snapshot.cpu.user,
        cpuSystemMicros: cpuAfter.system - snapshot.cpu.system,
        maxRssDelta: resourceAfter.maxRSS - snapshot.resource.maxRSS,
        voluntaryContextSwitchesDelta:
            resourceAfter.voluntaryContextSwitches - snapshot.resource.voluntaryContextSwitches,
        involuntaryContextSwitchesDelta:
            resourceAfter.involuntaryContextSwitches - snapshot.resource.involuntaryContextSwitches
    });
}

function readBudgetValue(
    budgets: FixtureProfileBudgets | null,
    metricName: keyof FixtureProfileBudgets,
    stageName: FixtureStageName
): number | null {
    const budgetMap = budgets?.[metricName];
    const rawValue = budgetMap?.[stageName];
    return typeof rawValue === "number" ? rawValue : null;
}

function createEmptyAggregateSummary(): FixtureProfileAggregateSummary {
    return {
        entryCount: 0,
        passedCount: 0,
        failedCount: 0,
        changedCount: 0,
        durationMs: 0,
        heapUsedDeltaBytes: 0,
        cpuUserMicros: 0,
        cpuSystemMicros: 0,
        maxRssDelta: 0,
        voluntaryContextSwitchesDelta: 0,
        involuntaryContextSwitchesDelta: 0
    };
}

function addStageMetricsToSummary(
    summary: FixtureProfileAggregateSummary,
    metrics: Readonly<{
        durationMs: number;
        heapUsedDeltaBytes: number;
        cpuUserMicros: number;
        cpuSystemMicros: number;
        maxRssDelta: number;
        voluntaryContextSwitchesDelta: number;
        involuntaryContextSwitchesDelta: number;
    }>
): void {
    summary.durationMs += metrics.durationMs;
    summary.heapUsedDeltaBytes += metrics.heapUsedDeltaBytes;
    summary.cpuUserMicros += metrics.cpuUserMicros;
    summary.cpuSystemMicros += metrics.cpuSystemMicros;
    summary.maxRssDelta += metrics.maxRssDelta;
    summary.voluntaryContextSwitchesDelta += metrics.voluntaryContextSwitchesDelta;
    summary.involuntaryContextSwitchesDelta += metrics.involuntaryContextSwitchesDelta;
}

function addEntryToSummary(summary: FixtureProfileAggregateSummary, entry: FixtureProfileEntry): void {
    summary.entryCount += 1;
    summary.passedCount += entry.status === "passed" ? 1 : 0;
    summary.failedCount += entry.status === "failed" ? 1 : 0;
    summary.changedCount += entry.changed ? 1 : 0;

    const totalStage = entry.stages.find((stage) => stage.stageName === "total");
    if (totalStage) {
        addStageMetricsToSummary(summary, totalStage);
        return;
    }

    summary.durationMs += entry.totalMs;
}

function freezeAggregateSummary(summary: FixtureProfileAggregateSummary): FixtureProfileAggregateSummary {
    return Object.freeze({ ...summary });
}

function createWorkspaceAggregates(
    entries: ReadonlyArray<FixtureProfileEntry>
): FixtureProfileReport["workspaceAggregates"] {
    const aggregateMap = new Map<string, FixtureProfileAggregateSummary>();

    for (const entry of entries) {
        const summary = aggregateMap.get(entry.workspace) ?? createEmptyAggregateSummary();
        addEntryToSummary(summary, entry);
        aggregateMap.set(entry.workspace, summary);
    }

    return Object.freeze(
        [...aggregateMap.entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([workspace, summary]) =>
                Object.freeze({
                    workspace,
                    summary: freezeAggregateSummary(summary)
                })
            )
    );
}

function createStageAggregates(entries: ReadonlyArray<FixtureProfileEntry>): FixtureProfileReport["stageAggregates"] {
    const aggregateMap = new Map<FixtureStageName, FixtureProfileAggregateSummary>();

    for (const entry of entries) {
        for (const stage of entry.stages) {
            const summary = aggregateMap.get(stage.stageName) ?? createEmptyAggregateSummary();
            summary.entryCount += 1;
            summary.passedCount += entry.status === "passed" ? 1 : 0;
            summary.failedCount += entry.status === "failed" ? 1 : 0;
            summary.changedCount += entry.changed ? 1 : 0;
            addStageMetricsToSummary(summary, stage);
            aggregateMap.set(stage.stageName, summary);
        }
    }

    return Object.freeze(
        [...aggregateMap.entries()]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([stageName, summary]) =>
                Object.freeze({
                    stageName,
                    summary: freezeAggregateSummary(summary)
                })
            )
    );
}

function createFailingBudgets(
    entries: ReadonlyArray<FixtureProfileEntry>
): ReadonlyArray<FixtureProfileBudgetFailureEntry> {
    const failures: Array<FixtureProfileBudgetFailureEntry> = [];

    for (const entry of entries) {
        for (const failure of entry.budgetFailures) {
            failures.push(
                Object.freeze({
                    workspace: entry.workspace,
                    caseId: entry.caseId,
                    stageName: failure.stageName,
                    metricName: failure.metricName,
                    actual: failure.actual,
                    budget: failure.budget
                })
            );
        }
    }

    return Object.freeze(
        failures.sort((left, right) => {
            const caseComparison = `${left.workspace}/${left.caseId}`.localeCompare(
                `${right.workspace}/${right.caseId}`
            );
            if (caseComparison !== 0) {
                return caseComparison;
            }

            const stageComparison = left.stageName.localeCompare(right.stageName);
            if (stageComparison !== 0) {
                return stageComparison;
            }

            return left.metricName.localeCompare(right.metricName);
        })
    );
}

export function collectBudgetFailures(
    stages: ReadonlyArray<FixtureStageMetrics>,
    budgets: FixtureProfileBudgets | null
): ReadonlyArray<FixtureProfileBudgetFailure> {
    if (!budgets) {
        return Object.freeze([]);
    }

    const failures: Array<FixtureProfileBudgetFailure> = [];
    for (const stage of stages) {
        const trackedMetrics = [
            ["durationMs", stage.durationMs],
            ["heapUsedDeltaBytes", stage.heapUsedDeltaBytes],
            ["cpuUserMicros", stage.cpuUserMicros],
            ["cpuSystemMicros", stage.cpuSystemMicros]
        ] as const;

        for (const [metricName, actualValue] of trackedMetrics) {
            const budget = readBudgetValue(budgets, metricName, stage.stageName);
            if (budget !== null && actualValue > budget) {
                failures.push({
                    stageName: stage.stageName,
                    metricName,
                    actual: actualValue,
                    budget
                });
            }
        }
    }

    return Object.freeze(failures);
}

/**
 * Derive stable per-fixture memory summary metrics from stage measurements.
 *
 * @param stages Ordered stage metrics captured for one fixture case.
 * @returns Memory summary for the fixture profile entry.
 */
export function createFixtureMemorySummary(
    stages: ReadonlyArray<FixtureStageMetrics>
): FixtureProfileEntryMemorySummary {
    const totalStage = stages.find((stage) => stage.stageName === "total") ?? null;
    const peakStageHeapUsedDeltaBytes =
        stages.length === 0 ? 0 : Math.max(...stages.map((stage) => stage.heapUsedDeltaBytes));

    return Object.freeze({
        totalHeapUsedDeltaBytes: totalStage?.heapUsedDeltaBytes ?? 0,
        totalMaxRssDeltaBytes: totalStage?.maxRssDelta ?? 0,
        peakStageHeapUsedDeltaBytes
    });
}

/**
 * Create an in-memory collector for fixture profiling entries.
 *
 * @returns Mutable collector used by fixture suites and profile tests.
 */
export function createProfileCollector(): FixtureProfileCollector {
    const entries: Array<FixtureProfileEntry> = [];

    return Object.freeze({
        addEntry(entry: FixtureProfileEntry) {
            entries.push(entry);
        },
        createReport(): FixtureProfileReport {
            const reportEntries = Object.freeze([...entries]);
            return Object.freeze({
                schemaVersion: 1 as const,
                generatedAt: new Date().toISOString(),
                entries: reportEntries,
                workspaceAggregates: createWorkspaceAggregates(reportEntries),
                stageAggregates: createStageAggregates(reportEntries),
                failingBudgets: createFailingBudgets(reportEntries)
            });
        }
    });
}

/**
 * Create a per-fixture timer that enforces canonical stage ordering.
 *
 * The timer records metrics even when a stage operation throws, so callers can
 * still inspect partial timing data for failed fixture cases.
 *
 * @returns Stage timer with guarded stage execution and immutable snapshots.
 */
export function createStageTimer() {
    const stages: Array<FixtureStageMetrics> = [];
    const completedStages = new Set<FixtureStageName>();
    let lastCompletedStageIndex = -1;

    return Object.freeze({
        /**
         * Execute one fixture stage and record its metrics.
         *
         * @param stageName Canonical stage name to run (must run at most once and
         * in non-decreasing canonical order).
         * @param operation Async work for the stage.
         * @returns Resolved value from {@link operation}.
         * @throws If the stage runs more than once, if the stage name is unknown,
         * or if stages execute out of canonical order.
         */
        async runStage<T>(stageName: FixtureStageName, operation: () => Promise<T>): Promise<T> {
            if (completedStages.has(stageName)) {
                throw new Error(`Fixture stage ${stageName} must not run more than once for a single fixture case.`);
            }

            const stageIndex = FIXTURE_STAGE_ORDER_INDEX.get(stageName);
            if (stageIndex === undefined) {
                throw new Error(`Unknown fixture stage ${stageName}.`);
            }

            const snapshot = captureStageSnapshot();
            let completed = false;
            let result!: T;
            let operationError: unknown = null;

            try {
                result = await operation();
                completed = true;
            } catch (error) {
                operationError = error;
            }

            if (stageIndex < lastCompletedStageIndex) {
                throw new Error(
                    `Fixture stage ${stageName} ran out of order. Expected canonical order ${FIXTURE_STAGE_ORDER.join(" -> ")}.`
                );
            }

            stages.push(toStageMetrics(stageName, snapshot));
            completedStages.add(stageName);
            lastCompletedStageIndex = stageIndex;

            if (operationError !== null) {
                throw operationError;
            }

            if (!completed) {
                throw new Error(`Fixture stage ${stageName} did not complete successfully.`);
            }

            return result;
        },
        getStages(): ReadonlyArray<FixtureStageMetrics> {
            return Object.freeze([...stages]);
        }
    });
}

/**
 * Optionally capture a V8 CPU profile for a fixture case.
 *
 * @param outputPath Artifact path to write when profiling is enabled.
 * @param operation Work wrapped by the CPU profiler.
 * @returns The operation result.
 */
export async function withDeepCpuProfile<T>(outputPath: string | null, operation: () => Promise<T>): Promise<T> {
    if (!outputPath) {
        return await operation();
    }

    const session = new Session();
    session.connect();

    try {
        await session.post("Profiler.enable");
        await session.post("Profiler.start");
        const result = await operation();
        const profile = await session.post("Profiler.stop");
        await mkdir(path.dirname(outputPath), { recursive: true });
        await writeFile(outputPath, Core.stringifyJsonForFile(profile.profile, { space: 2 }), "utf8");
        return result;
    } finally {
        session.disconnect();
    }
}
