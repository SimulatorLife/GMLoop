import { Core } from "@gmloop/core";

import type {
    FixtureAssertion,
    FixtureComparison,
    FixtureKind,
    FixtureProfileBudgets,
    FixtureProjectConfig,
    FixtureProjectConfigMetadata,
    FixtureStageName
} from "../types.js";

const FIXTURE_KIND_VALUES = new Set<FixtureKind>(["format", "lint", "refactor", "integration"]);
const FIXTURE_ASSERTION_VALUES = new Set<FixtureAssertion>(["transform", "idempotent", "project-tree", "parse-error"]);
const FIXTURE_COMPARISON_VALUES = new Set<FixtureComparison>([
    "exact",
    "ignore-whitespace-and-line-endings",
    "trimmed-strip-doc-comment-annotations"
]);
const FIXTURE_SECTION_KEYS = new Set(["kind", "assertion", "comparison", "profile"]);
const FIXTURE_PROFILE_KEYS = new Set(["budgets", "deepCpuProfile"]);
const FIXTURE_PROFILE_BUDGET_KEYS = new Set(["durationMs", "heapUsedDeltaBytes", "cpuUserMicros", "cpuSystemMicros"]);

function assertPlainObject(value: unknown, context: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError(`${context} must be a plain object.`);
    }

    return value as Record<string, unknown>;
}

function validateStageBudgetMap(value: unknown, context: string): Partial<Record<FixtureStageName, number>> {
    const object = assertPlainObject(value, context);
    const budgets: Record<string, number> = {};

    for (const [stageName, rawBudget] of Object.entries(object)) {
        if (
            stageName !== "load" &&
            stageName !== "format" &&
            stageName !== "lint" &&
            stageName !== "refactor" &&
            stageName !== "compare" &&
            stageName !== "total"
        ) {
            throw new TypeError(`${context} contains unknown stage ${JSON.stringify(stageName)}.`);
        }
        if (typeof rawBudget !== "number" || !Number.isFinite(rawBudget) || rawBudget < 0) {
            throw new TypeError(`${context}.${stageName} must be a non-negative number.`);
        }
        budgets[stageName] = rawBudget;
    }

    return budgets;
}

function validateOptionalEnumValue<ValueType extends string>(
    value: unknown,
    validValues: Set<ValueType>,
    context: string,
    propertyName: string
): ValueType | undefined {
    if (value !== undefined) {
        if (typeof value !== "string" || !validValues.has(value as ValueType)) {
            throw new TypeError(`${context}.${propertyName} must be one of ${[...validValues].join(", ")}.`);
        }

        return value as ValueType;
    }
    return undefined;
}

function validateFixtureProfile(value: unknown, context: string): NonNullable<FixtureProjectConfigMetadata["profile"]> {
    const profileObject = assertPlainObject(value, `${context}.profile`);
    for (const key of Object.keys(profileObject)) {
        if (!FIXTURE_PROFILE_KEYS.has(key)) {
            throw new TypeError(`${context}.profile contains unknown property ${JSON.stringify(key)}.`);
        }
    }

    const profile: NonNullable<FixtureProjectConfigMetadata["profile"]> = {};
    if (profileObject.deepCpuProfile !== undefined) {
        if (typeof profileObject.deepCpuProfile !== "boolean") {
            throw new TypeError(`${context}.profile.deepCpuProfile must be a boolean.`);
        }
        profile.deepCpuProfile = profileObject.deepCpuProfile;
    }

    if (profileObject.budgets === undefined) {
        return profile;
    }

    const budgetsObject = assertPlainObject(profileObject.budgets, `${context}.profile.budgets`);
    const budgets: FixtureProfileBudgets = {};

    for (const [metricName, rawMetricBudgets] of Object.entries(budgetsObject)) {
        if (!FIXTURE_PROFILE_BUDGET_KEYS.has(metricName)) {
            throw new TypeError(`${context}.profile.budgets contains unknown metric ${JSON.stringify(metricName)}.`);
        }

        budgets[metricName as keyof FixtureProfileBudgets] = validateStageBudgetMap(
            rawMetricBudgets,
            `${context}.profile.budgets.${metricName}`
        );
    }

    profile.budgets = budgets;
    return profile;
}

function validateFixtureMetadata(value: unknown, context: string): FixtureProjectConfigMetadata {
    const object = assertPlainObject(value, context);

    for (const key of Object.keys(object)) {
        if (!FIXTURE_SECTION_KEYS.has(key)) {
            throw new TypeError(`${context} contains unknown property ${JSON.stringify(key)}.`);
        }
    }

    const kind = object.kind;
    if (typeof kind !== "string" || !FIXTURE_KIND_VALUES.has(kind as FixtureKind)) {
        throw new TypeError(`${context}.kind must be one of ${[...FIXTURE_KIND_VALUES].join(", ")}.`);
    }

    const metadata: FixtureProjectConfigMetadata = {
        kind: kind as FixtureKind
    };

    const assertion = validateOptionalEnumValue(object.assertion, FIXTURE_ASSERTION_VALUES, context, "assertion");
    if (assertion !== undefined) {
        metadata.assertion = assertion;
    }

    const comparison = validateOptionalEnumValue(object.comparison, FIXTURE_COMPARISON_VALUES, context, "comparison");
    if (comparison !== undefined) {
        metadata.comparison = comparison;
    }

    if (object.profile !== undefined) {
        metadata.profile = validateFixtureProfile(object.profile, context);
    }

    return metadata;
}

/**
 * Load a fixture case `gmloop.json` and validate the fixture-owned metadata.
 *
 * @param configPath Fixture config path.
 * @returns Parsed fixture config with validated `fixture` metadata.
 */
export async function loadFixtureProjectConfig(configPath: string): Promise<FixtureProjectConfig> {
    const baseConfig = await Core.loadGmloopProjectConfig(configPath);
    const fixture = validateFixtureMetadata(baseConfig.fixture, "gmloop.json fixture config");

    return Object.freeze({
        ...baseConfig,
        fixture
    }) as FixtureProjectConfig;
}
