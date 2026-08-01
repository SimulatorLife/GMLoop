import * as ConfigAPI from "./config/index.js";
import * as DiscoveryAPI from "./discovery/index.js";
import * as ProfilingAPI from "./profiling/index.js";
import * as ProjectAPI from "./project/index.js";
import * as RunnerAPI from "./runner/index.js";

export const FixtureRunner = Object.freeze({
    ...ConfigAPI,
    ...DiscoveryAPI,
    ...ProfilingAPI,
    ...ProjectAPI,
    ...RunnerAPI
});

export type {
    CopiedExternalProjectFixture,
    ExternalProjectCopyOptions,
    JsonCliPayload,
    JsonEndpointPayload,
    ProjectChangeSummary,
    ProjectFileFingerprint,
    ProjectFingerprint
} from "./project/index.js";
export type {
    FixtureAdapter,
    FixtureAssertion,
    FixtureCase,
    FixtureCaseExecutionResult,
    FixtureCaseResult,
    FixtureComparison,
    FixtureKind,
    FixtureProfileBudgetFailure,
    FixtureProfileBudgets,
    FixtureProfileCollector,
    FixtureProfileEntry,
    FixtureProfileEntryMemorySummary,
    FixtureProfileReport,
    FixtureProjectConfig,
    FixtureProjectConfigMetadata,
    FixtureRunFailure,
    FixtureRunResult,
    FixtureStageMetrics,
    FixtureStageName,
    FixtureSuiteDefinition
} from "./types.js";
