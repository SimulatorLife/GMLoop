import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RESOURCE_DIRECTORY_CONFIG_FILE_NAME = "resource-directory.json";
const PACKAGE_JSON_FILE_NAME = "package.json";
const CORE_PACKAGE_NAME = "@gmloop/core";

type ResourceDirectoryConfig = Readonly<{
    resourceDirectory: string;
}>;

function isResourceDirectoryConfig(value: unknown): value is ResourceDirectoryConfig {
    return (
        typeof value === "object" &&
        value !== null &&
        "resourceDirectory" in value &&
        typeof value.resourceDirectory === "string" &&
        value.resourceDirectory.trim().length > 0
    );
}

function tryReadConfiguredResourceDirectory(packageDirectoryPath: string): string | null {
    const configPath = path.resolve(packageDirectoryPath, RESOURCE_DIRECTORY_CONFIG_FILE_NAME);
    if (!existsSync(configPath)) {
        return null;
    }

    const configContents = readFileSync(configPath, "utf8");
    const configValue = JSON.parse(configContents) as unknown;
    if (!isResourceDirectoryConfig(configValue)) {
        throw new TypeError(
            `Resource directory config at ${configPath} must define a non-empty "resourceDirectory" string.`
        );
    }

    const resourceDirectoryPath = configValue.resourceDirectory.trim();
    if (!existsSync(resourceDirectoryPath)) {
        return null;
    }

    return resourceDirectoryPath;
}

function tryReadPackageName(directoryPath: string): string | null {
    const packageJsonPath = path.resolve(directoryPath, PACKAGE_JSON_FILE_NAME);
    if (!existsSync(packageJsonPath)) {
        return null;
    }

    const packageContents = readFileSync(packageJsonPath, "utf8");
    const packageValue = JSON.parse(packageContents) as unknown;
    if (typeof packageValue !== "object" || packageValue === null || !("name" in packageValue)) {
        return null;
    }

    return typeof packageValue.name === "string" ? packageValue.name : null;
}

function findCorePackageDirectory(moduleDirectoryPath: string): string {
    for (let currentDirectoryPath = moduleDirectoryPath; ; currentDirectoryPath = path.dirname(currentDirectoryPath)) {
        if (tryReadPackageName(currentDirectoryPath) === CORE_PACKAGE_NAME) {
            return currentDirectoryPath;
        }

        const parentDirectoryPath = path.dirname(currentDirectoryPath);
        if (parentDirectoryPath === currentDirectoryPath) {
            break;
        }
    }

    throw new Error(`Unable to locate the ${CORE_PACKAGE_NAME} package directory from ${moduleDirectoryPath}.`);
}

function resolveResourceBaseDirectory(moduleDirectoryPath: string): string {
    const packageDirectoryPath = findCorePackageDirectory(moduleDirectoryPath);
    const configuredResourceDirectory = tryReadConfiguredResourceDirectory(packageDirectoryPath);
    if (configuredResourceDirectory) {
        return configuredResourceDirectory;
    }

    return path.resolve(packageDirectoryPath, "../../resources");
}

function resolveResourceUrl(resourceName: string): URL {
    const moduleDirectoryPath = path.dirname(fileURLToPath(import.meta.url));
    const resourceBaseDirectory = resolveResourceBaseDirectory(moduleDirectoryPath);
    const normalizedResourcePath = path.posix.normalize(resourceName.replaceAll("\\", "/"));
    if (
        normalizedResourcePath.length === 0 ||
        normalizedResourcePath === "." ||
        normalizedResourcePath === ".." ||
        normalizedResourcePath.startsWith("../") ||
        normalizedResourcePath.startsWith("/")
    ) {
        throw new TypeError("Resource name must resolve to a safe relative path within the bundled resources.");
    }

    return new URL(normalizedResourcePath, new URL(`${resourceBaseDirectory}/`, "file:"));
}

/**
 * Resolve a URL pointing at a bundled resource artefact.
 *
 * Resource lookup now anchors itself at the `@gmloop/core` package directory.
 * When present, the build/install-time `resource-directory.json` manifest wins;
 * otherwise local development falls back to the repository `resources/` folder
 * relative to the package root instead of probing multiple hard-coded depths.
 *
 * @param {string} resourceName Name of the resource file to resolve.
 * @returns {URL} Absolute file URL referencing the bundled artefact.
 */
export function resolveBundledResourceUrl(resourceName: string): URL {
    if (typeof resourceName !== "string" || resourceName.length === 0) {
        throw new TypeError("Resource name must be a non-empty string.");
    }

    return resolveResourceUrl(resourceName);
}

/**
 * Resolve a filesystem path for a bundled resource artefact.
 *
 * @param {string} resourceName Name of the resource file to resolve.
 * @returns {string} Local filesystem path for the bundled artefact.
 */
export function resolveBundledResourcePath(resourceName: string): string {
    return fileURLToPath(resolveBundledResourceUrl(resourceName));
}

/**
 * Resolve the base resource directory for a caller-supplied module directory.
 *
 * This test-only seam validates the package-root lookup and generated manifest
 * handling without coupling unit tests to the real repository layout.
 *
 * @param {string} moduleDirectoryPath Directory containing the calling module.
 * @returns {string} Absolute resource directory for the package installation.
 */
export function __resolveBundledResourceBaseDirectoryForTests(moduleDirectoryPath: string): string {
    if (typeof moduleDirectoryPath !== "string" || moduleDirectoryPath.length === 0) {
        throw new TypeError("Module directory path must be a non-empty string.");
    }

    return resolveResourceBaseDirectory(moduleDirectoryPath);
}
