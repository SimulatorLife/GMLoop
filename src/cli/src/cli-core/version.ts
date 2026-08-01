import path from "node:path";
import process from "node:process";

import { Core } from "@gmloop/core";

import { getPackageJsonStringField, parsePackageJsonContents } from "../shared/package-resolution.js";
import { CLI_PACKAGE_DIRECTORY, REPO_ROOT } from "../shared/workspace-paths.js";

const { getNonEmptyTrimmedString, readTextFileSync } = Core;

const FALLBACK_CLI_VERSION_LABEL = "development build";

const PACKAGE_VERSION_CANDIDATES = Object.freeze([
    path.resolve(CLI_PACKAGE_DIRECTORY, "package.json"),
    path.resolve(REPO_ROOT, "package.json"),
    path.resolve(REPO_ROOT, "src", "format", "package.json")
]);

function readPackageVersion(candidate: string): string | null {
    try {
        const contents = readTextFileSync(candidate);
        const packageJson = parsePackageJsonContents(contents, candidate);
        return getPackageJsonStringField(packageJson, "version");
    } catch {
        return null;
    }
}

export function resolveCliVersion(): string {
    const envCandidates: Array<string | undefined> = [
        process.env.PRETTIER_PLUGIN_GML_VERSION,
        process.env.npm_package_version
    ];

    for (const candidate of envCandidates) {
        const version = getNonEmptyTrimmedString(candidate);
        if (version) {
            return version;
        }
    }

    for (const packagePath of PACKAGE_VERSION_CANDIDATES) {
        const version = readPackageVersion(packagePath);
        if (version) {
            return version;
        }
    }

    return FALLBACK_CLI_VERSION_LABEL;
}

export { FALLBACK_CLI_VERSION_LABEL };
