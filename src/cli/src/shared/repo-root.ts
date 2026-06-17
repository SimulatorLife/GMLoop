import path from "node:path";

import { Core } from "@gmloop/core";

import { pathExists, pathExistsSync } from "./path-exists.js";

const { walkAncestorDirectories } = Core;

/**
 * Walk upward from startDir until a repo sentinel or top-most package.json is found.
 * Prefer AGENTS.md or a .git directory. If none are present, return the top-most
 * package.json ancestor.
 */
export async function findRepoRoot(startDir: string): Promise<string> {
    let lastPackageJson: string | null = null;
    const directories = [...walkAncestorDirectories(startDir)];

    const root = await directories.reduce(
        (previousPromise, dir) =>
            previousPromise.then(async (found) => {
                if (found) {
                    return found;
                }

                if (await pathExists(path.join(dir, "AGENTS.md"), (stat) => stat.isFile())) {
                    return dir;
                }

                if (await pathExists(path.join(dir, ".git"), (stat) => stat.isDirectory() || stat.isFile())) {
                    return dir;
                }

                if (await pathExists(path.join(dir, "package.json"))) {
                    lastPackageJson = dir;
                }

                return null;
            }),
        Promise.resolve<string | null>(null)
    );

    if (root) {
        return root;
    }

    if (lastPackageJson) {
        return lastPackageJson;
    }

    throw new Error("Repository root not found while resolving test paths");
}

/**
 * Synchronous variant of findRepoRoot that mirrors the async helper in behavior
 * but uses blocking fs calls. The function searches parents starting from the
 * provided directory and prefers AGENTS.md or a .git directory sentinel. If
 * none are found, the top-most package.json ancestor is returned. If nothing
 * matches, an error is thrown.
 */
export function findRepoRootSync(startDir: string): string {
    let lastPackageJson: string | null = null;

    for (const dir of walkAncestorDirectories(startDir)) {
        if (pathExistsSync(path.join(dir, "AGENTS.md"), (stat) => stat.isFile())) {
            return dir;
        }

        if (pathExistsSync(path.join(dir, ".git"), (stat) => stat.isDirectory() || stat.isFile())) {
            return dir;
        }

        if (pathExistsSync(path.join(dir, "package.json"))) {
            lastPackageJson = dir;
        }
    }

    if (lastPackageJson) {
        return lastPackageJson;
    }

    throw new Error("Repository root not found while resolving test paths");
}
