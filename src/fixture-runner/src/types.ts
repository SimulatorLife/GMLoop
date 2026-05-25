import type { GmloopProjectConfig } from "@gmloop/core";

export type FixtureKind = "format" | "lint" | "refactor" | "integration" | "external-project";
export type FixtureAssertion = "transform" | "idempotent" | "project-tree" | "parse-error";
export type FixtureComparison = "exact" | "ignore-whitespace-and-line-endings";
export type FixtureStageName = "load" | "format" | "lint" | "refactor" | "compare" | "total";

/**
 * Path exclusion rules used when copying or fingerprinting a whole external
 * project fixture.
 */
export interface ExternalProjectExcludeRules {
    directoryNames?: ReadonlyArray<string>;
    fileNames?: ReadonlyArray<string>;
    relativePaths?: ReadonlyArray<string>;
    extensions?: ReadonlyArray<string>;
}

/**
 * Fixture-owned descriptor for a real project located outside the fixture case
 * directory.
 */
export interface ExternalProjectFixtureDescriptor {
    sourcePath: string;
    excludes?: ExternalProjectExcludeRules;
}

type FixtureBudgetMap = Readonly<Partial<Record<FixtureStageName, number>>>;

/**
 * Profiling budgets enforced for a single fixture case.
 */
export interface FixtureProfileBudgets {
    durationMs?: FixtureBudgetMap;
    heapUsedDeltaBytes?: FixtureBudgetMap;
    cpuUserMicros?: FixtureBudgetMap;
    cpuSystemMicros?: FixtureBudgetMap;
}

/**
 * Fixture-runner metadata stored under `fixture` inside `gmloop.json`.
 */
export interface FixtureProjectConfigMetadata {
    kind: FixtureKind;
    assertion?: FixtureAssertion;
    comparison?: FixtureComparison;
    externalProject?: ExternalProjectFixtureDescriptor;
    profile?: {
        budgets?: FixtureProfileBudgets;
        deepCpuProfile?: boolean;
    };
}

/**
 * Top-level fixture config shape loaded from `gmloop.json`.
 */
export type FixtureProjectConfig = GmloopProjectConfig & {
    fixture: FixtureProjectConfigMetadata;
};

export interface FixtureCase {
    caseId: string;
    fixturePath: string;
    configPath: string;
    config: FixtureProjectConfig;
    kind: FixtureKind;
    assertion: FixtureAssertion;
    comparison: FixtureComparison;
    inputFilePath: string | null;
    expectedFilePath: string | null;
    projectDirectoryPath: string | null;
    expectedDirectoryPath: string | null;
}

export interface FixtureStageMetrics {
    stageName: FixtureStageName;
    durationMs: number;
    heapUsedDeltaBytes: number;
    cpuUserMicros: number;
    cpuSystemMicros: number;
    maxRssDelta: number;
    voluntaryContextSwitchesDelta: number;
    involuntaryContextSwitchesDelta: number;
}

export interface FixtureProfileBudgetFailure {
    stageName: FixtureStageName;
    metricName: "durationMs" | "heapUsedDeltaBytes" | "cpuUserMicros" | "cpuSystemMicros";
    actual: number;
    budget: number;
}

export interface FixtureProfileEntry {
    workspace: string;
    suite: string;
    caseId: string;
    fixturePath: string;
    status: "passed" | "failed";
    changed: boolean;
    totalMs: number;
    stages: ReadonlyArray<FixtureStageMetrics>;
    budgets: FixtureProfileBudgets | null;
    budgetFailures: ReadonlyArray<FixtureProfileBudgetFailure>;
    deepCpuProfileArtifactPath: string | null;
    memorySummary: FixtureProfileEntryMemorySummary;
}

export interface FixtureProfileEntryMemorySummary {
    totalHeapUsedDeltaBytes: number;
    totalMaxRssDeltaBytes: number;
    peakStageHeapUsedDeltaBytes: number;
}

export interface FixtureProfileAggregateSummary {
    entryCount: number;
    passedCount: number;
    failedCount: number;
    changedCount: number;
    durationMs: number;
    heapUsedDeltaBytes: number;
    cpuUserMicros: number;
    cpuSystemMicros: number;
    maxRssDelta: number;
    voluntaryContextSwitchesDelta: number;
    involuntaryContextSwitchesDelta: number;
}

export interface FixtureProfileWorkspaceAggregate {
    workspace: string;
    summary: FixtureProfileAggregateSummary;
}

export interface FixtureProfileStageAggregate {
    stageName: FixtureStageName;
    summary: FixtureProfileAggregateSummary;
}

export interface FixtureProfileBudgetFailureEntry {
    workspace: string;
    caseId: string;
    stageName: FixtureProfileBudgetFailure["stageName"];
    metricName: FixtureProfileBudgetFailure["metricName"];
    actual: number;
    budget: number;
}

export interface FixtureProfileReport {
    schemaVersion: 1;
    generatedAt: string;
    entries: ReadonlyArray<FixtureProfileEntry>;
    workspaceAggregates: ReadonlyArray<FixtureProfileWorkspaceAggregate>;
    stageAggregates: ReadonlyArray<FixtureProfileStageAggregate>;
    failingBudgets: ReadonlyArray<FixtureProfileBudgetFailureEntry>;
}

export interface FixtureProfileCollector {
    addEntry(entry: FixtureProfileEntry): void;
    createReport(): FixtureProfileReport;
}

export type FixtureCaseResult =
    | {
          resultKind: "text";
          outputText: string;
          changed: boolean;
      }
    | {
          resultKind: "project-tree";
          outputDirectoryPath: string;
          changed: boolean;
      };

export interface FixtureCaseExecutionResult {
    fixtureCase: FixtureCase;
    profileEntry: FixtureProfileEntry;
    caseResult: FixtureCaseResult | null;
}

export interface FixtureRunResult {
    fixtureCases: ReadonlyArray<FixtureCase>;
    executionResults: ReadonlyArray<FixtureCaseExecutionResult>;
    failures: ReadonlyArray<FixtureRunFailure>;
}

export interface FixtureRunFailure {
    fixtureCase: FixtureCase;
    error: unknown;
}

export interface FixtureSuiteDefinition {
    workspaceName: string;
    suiteName: string;
    compiledWorkspaceTestFilePath: string;
    fixtureRoot: string;
    adapter: FixtureAdapter;
}

export interface FixtureAdapter {
    workspaceName: string;
    suiteName: string;
    supports(kind: FixtureKind): boolean;
    run(parameters: {
        fixtureCase: FixtureCase;
        config: FixtureProjectConfig;
        inputText: string | null;
        workingProjectDirectoryPath: string | null;
        runProfiledStage<T>(
            stageName: Exclude<FixtureStageName, "load" | "compare" | "total">,
            operation: () => Promise<T>
        ): Promise<T>;
    }): Promise<FixtureCaseResult>;
}
