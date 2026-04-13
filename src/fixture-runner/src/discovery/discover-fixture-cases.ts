import { readdir } from "node:fs/promises";
import path from "node:path";

import { Core } from "@gmloop/core";

import { loadFixtureProjectConfig } from "../config/index.js";
import type { FixtureAssertion, FixtureCase, FixtureComparison, FixtureProjectConfig } from "../types.js";

const GMLOOP_CONFIG_FILE_NAME = "gmloop.json";
const INPUT_FILE_NAME = "input.gml";
const EXPECTED_FILE_NAME = "expected.gml";
const PROJECT_DIRECTORY_NAME = "project";
const EXPECTED_DIRECTORY_NAME = "expected";
const TEXT_FIXTURE_KINDS = new Set(["format", "lint", "integration"]);

type FixtureCaseLayoutValidation = {
    allowedFiles: ReadonlySet<string>;
    allowedDirectories: ReadonlySet<string>;
    requiredFiles: ReadonlyArray<string>;
    requiredDirectories: ReadonlyArray<string>;
    additionalErrors: ReadonlyArray<string>;
};

function normalizeCaseId(rootPath: string, fixturePath: string): string {
    return Core.toPosixPath(path.relative(rootPath, fixturePath));
}

function deriveDefaultAssertion(config: FixtureProjectConfig, fileNames: ReadonlySet<string>): FixtureAssertion {
    if (config.fixture.assertion) {
        return config.fixture.assertion;
    }

    if (config.fixture.kind === "refactor") {
        return "project-tree";
    }

    if (fileNames.has(EXPECTED_FILE_NAME)) {
        return "transform";
    }

    return "idempotent";
}

function deriveDefaultComparison(config: FixtureProjectConfig): FixtureComparison {
    if (config.fixture.comparison) {
        return config.fixture.comparison;
    }

    return "exact";
}

async function collectCaseDirectories(rootPath: string): Promise<Array<string>> {
    const configFilePaths = await Core.listRelativeFilePathsRecursively(rootPath, {
        includeFile: ({ entryName }) => entryName === GMLOOP_CONFIG_FILE_NAME
    });

    return configFilePaths
        .map((relativePath) => path.join(rootPath, path.dirname(relativePath)))
        .toSorted((left, right) => left.localeCompare(right));
}

function validateFixtureEntries(
    fileNames: ReadonlySet<string>,
    directoryNames: ReadonlySet<string>,
    validation: FixtureCaseLayoutValidation
): Array<string> {
    return [
        ...validation.additionalErrors,
        ...validation.requiredFiles
            .filter((fileName) => !fileNames.has(fileName))
            .map((fileName) => `missing ${fileName}`),
        ...validation.requiredDirectories
            .filter((directoryName) => !directoryNames.has(directoryName))
            .map((directoryName) => `missing ${directoryName}/ directory`),
        ...[...fileNames]
            .filter((fileName) => !validation.allowedFiles.has(fileName))
            .map((fileName) => `unexpected file ${JSON.stringify(fileName)}`),
        ...[...directoryNames]
            .filter((directoryName) => !validation.allowedDirectories.has(directoryName))
            .map((directoryName) => `unexpected directory ${JSON.stringify(directoryName)}`)
    ];
}

function validateTextFixtureCaseLayout(
    assertion: FixtureAssertion,
    fileNames: ReadonlySet<string>,
    directoryNames: ReadonlySet<string>
): Array<string> {
    const allowedFiles = new Set([GMLOOP_CONFIG_FILE_NAME, INPUT_FILE_NAME]);
    const additionalErrors: Array<string> = [];

    if (assertion === "transform" || assertion === "parse-error") {
        allowedFiles.add(EXPECTED_FILE_NAME);
    }

    if (assertion === "transform" && !fileNames.has(EXPECTED_FILE_NAME)) {
        additionalErrors.push(`missing ${EXPECTED_FILE_NAME}`);
    }

    if (assertion === "idempotent" && fileNames.has(EXPECTED_FILE_NAME)) {
        additionalErrors.push(`${EXPECTED_FILE_NAME} is not allowed for ${assertion} fixtures`);
    }

    if (assertion === "project-tree") {
        additionalErrors.push("project-tree assertion is only valid for refactor fixtures");
    }

    return validateFixtureEntries(fileNames, directoryNames, {
        allowedFiles,
        allowedDirectories: new Set(),
        requiredFiles: [INPUT_FILE_NAME],
        requiredDirectories: [],
        additionalErrors
    });
}

function validateRefactorFixtureCaseLayout(
    assertion: FixtureAssertion,
    fileNames: ReadonlySet<string>,
    directoryNames: ReadonlySet<string>
): Array<string> {
    return validateFixtureEntries(fileNames, directoryNames, {
        allowedFiles: new Set([GMLOOP_CONFIG_FILE_NAME]),
        allowedDirectories: new Set([PROJECT_DIRECTORY_NAME, EXPECTED_DIRECTORY_NAME]),
        requiredFiles: [],
        requiredDirectories: [PROJECT_DIRECTORY_NAME, EXPECTED_DIRECTORY_NAME],
        additionalErrors: assertion === "project-tree" ? [] : ["refactor fixtures must use the project-tree assertion"]
    });
}

function isSupportedFixtureKind(kind: string): kind is FixtureCase["kind"] {
    return kind === "refactor" || TEXT_FIXTURE_KINDS.has(kind);
}

function collectFixtureCaseValidationErrors(
    kind: FixtureProjectConfig["fixture"]["kind"],
    assertion: FixtureAssertion,
    fileNames: ReadonlySet<string>,
    directoryNames: ReadonlySet<string>
): Array<string> {
    if (!isSupportedFixtureKind(kind)) {
        return [`unsupported fixture kind ${JSON.stringify(kind)}`];
    }

    if (kind === "refactor") {
        return validateRefactorFixtureCaseLayout(assertion, fileNames, directoryNames);
    }

    return validateTextFixtureCaseLayout(assertion, fileNames, directoryNames);
}

function deriveFixtureCasePaths(
    fixturePath: string,
    kind: FixtureCase["kind"],
    fileNames: ReadonlySet<string>
): Pick<FixtureCase, "inputFilePath" | "expectedFilePath" | "projectDirectoryPath" | "expectedDirectoryPath"> {
    if (kind === "refactor") {
        return {
            inputFilePath: null,
            expectedFilePath: null,
            projectDirectoryPath: path.join(fixturePath, PROJECT_DIRECTORY_NAME),
            expectedDirectoryPath: path.join(fixturePath, EXPECTED_DIRECTORY_NAME)
        };
    }

    return {
        inputFilePath: path.join(fixturePath, INPUT_FILE_NAME),
        expectedFilePath: fileNames.has(EXPECTED_FILE_NAME) ? path.join(fixturePath, EXPECTED_FILE_NAME) : null,
        projectDirectoryPath: null,
        expectedDirectoryPath: null
    };
}

async function createFixtureCase(rootPath: string, fixturePath: string): Promise<FixtureCase> {
    const configPath = path.join(fixturePath, GMLOOP_CONFIG_FILE_NAME);
    const config = await loadFixtureProjectConfig(configPath);
    const entries = await readdir(fixturePath, { withFileTypes: true });
    const fileNames = new Set(entries.filter((entry) => entry.isFile()).map((entry) => entry.name));
    const directoryNames = new Set(entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name));
    const assertion = deriveDefaultAssertion(config, fileNames);
    const comparison = deriveDefaultComparison(config);
    const validationErrors = collectFixtureCaseValidationErrors(
        config.fixture.kind,
        assertion,
        fileNames,
        directoryNames
    );

    if (validationErrors.length > 0) {
        throw new Error(`${normalizeCaseId(rootPath, fixturePath)}: ${validationErrors.join(", ")}`);
    }

    const casePaths = deriveFixtureCasePaths(fixturePath, config.fixture.kind, fileNames);

    return Object.freeze({
        caseId: normalizeCaseId(rootPath, fixturePath),
        fixturePath,
        configPath,
        config,
        kind: config.fixture.kind,
        assertion,
        comparison,
        ...casePaths
    });
}

/**
 * Discover directory-per-case fixtures rooted at {@link fixtureRoot}.
 *
 * @param fixtureRoot Root directory containing fixture case subdirectories.
 * @returns Normalized fixture case definitions.
 */
export async function discoverFixtureCases(fixtureRoot: string): Promise<ReadonlyArray<FixtureCase>> {
    const caseDirectories = await collectCaseDirectories(fixtureRoot);
    const settledCases = await Promise.allSettled(
        caseDirectories.map((fixturePath) => createFixtureCase(fixtureRoot, fixturePath))
    );
    const validationErrors = settledCases
        .filter((result): result is PromiseRejectedResult => result.status === "rejected")
        .map((result) => {
            // Use a capability probe rather than `instanceof Error` so that
            // cross-realm errors and custom error-like objects are handled correctly.
            if (Core.isErrorLike(result.reason)) {
                return result.reason.message;
            }

            return String(result.reason);
        });
    if (validationErrors.length > 0) {
        throw new Error(`Invalid fixture cases under ${fixtureRoot}:\n- ${validationErrors.join("\n- ")}`);
    }

    const fixtureCases = settledCases
        .filter((result): result is PromiseFulfilledResult<FixtureCase> => result.status === "fulfilled")
        .map((result) => result.value);
    return Object.freeze(fixtureCases);
}
