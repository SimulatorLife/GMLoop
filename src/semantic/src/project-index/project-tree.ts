import { promises as fs } from "node:fs";
import path from "node:path";

import { Core } from "@gmloop/core";

import { createProjectIndexAbortGuard } from "./abort-guard.js";
import { type ProjectIndexFsFacade } from "./fs-facade.js";
import {
    normalizeProjectFileCategory,
    ProjectFileCategory,
    resolveProjectFileCategory
} from "./project-file-categories.js";

function createProjectTreeRecord(absolutePath, relativePosix) {
    return {
        absolutePath,
        relativePath: relativePosix
    };
}

function createProjectTreeCollector(metrics = null) {
    const yyFiles = [];
    const gmlFiles = [];

    function recordFile(category, record) {
        const normalizedCategory = normalizeProjectFileCategory(category);

        if (normalizedCategory === ProjectFileCategory.RESOURCE_METADATA) {
            yyFiles.push(record);
            metrics?.counters?.increment("files.yyDiscovered");
            return;
        }

        if (normalizedCategory === ProjectFileCategory.SOURCE) {
            gmlFiles.push(record);
            metrics?.counters?.increment("files.gmlDiscovered");
        }
    }

    function register(relativePosix, absolutePath) {
        const category = resolveProjectFileCategory(relativePosix);
        if (!category) {
            return;
        }

        recordFile(category, createProjectTreeRecord(absolutePath, relativePosix));
    }

    function snapshot() {
        const sortedYyFiles = yyFiles.toSorted((a, b) => a.relativePath.localeCompare(b.relativePath));
        const sortedGmlFiles = gmlFiles.toSorted((a, b) => a.relativePath.localeCompare(b.relativePath));

        return { yyFiles: sortedYyFiles, gmlFiles: sortedGmlFiles };
    }

    return {
        register,
        snapshot
    };
}

function createDirectoryTraversal(projectRoot) {
    const pending = ["."];

    return {
        hasPending() {
            return pending.length > 0;
        },
        next() {
            if (pending.length === 0) {
                return null;
            }

            const relativePath = pending.pop();
            return {
                relativePath,
                absolutePath: path.join(projectRoot, relativePath)
            };
        },
        enqueue(relativePath) {
            pending.push(relativePath);
        }
    };
}

function createDirectoryEntryDescriptor(directoryContext, entry, projectRoot) {
    const relativePath = path.join(directoryContext.relativePath, entry);
    const absolutePath = path.join(projectRoot, relativePath);

    return {
        relativePath,
        absolutePath,
        relativePosix: Core.toPosixPath(relativePath)
    };
}

async function resolveDirectoryListing({ directoryContext, fsFacade, metrics, ensureNotAborted, signal }) {
    ensureNotAborted();
    const entries = await Core.listDirectory(fsFacade, directoryContext.absolutePath, {
        signal
    });
    ensureNotAborted();
    metrics?.counters?.increment("io.directoriesScanned");
    return entries;
}

function isDirectoryStat(stats) {
    return typeof stats?.isDirectory === "function" && stats.isDirectory();
}

async function resolveEntryStats({ absolutePath, fsFacade, ensureNotAborted, metrics }) {
    try {
        const stats = await fsFacade.stat(absolutePath);
        ensureNotAborted();
        return stats;
    } catch (error) {
        if (Core.isErrorWithCode(error, "ENOENT")) {
            metrics?.counters?.increment("io.skippedMissingEntries");
            return null;
        }
        throw error;
    }
}

async function processDirectoryEntries({
    entries,
    directoryContext,
    traversal,
    collector,
    projectRoot,
    fsFacade,
    ensureNotAborted,
    metrics
}) {
    await Core.runSequentially(entries, async (entry) => {
        ensureNotAborted();
        const descriptor = createDirectoryEntryDescriptor(directoryContext, entry, projectRoot);
        const stats = await resolveEntryStats({
            absolutePath: descriptor.absolutePath,
            fsFacade,
            ensureNotAborted,
            metrics
        });

        if (!stats) {
            return;
        }

        if (isDirectoryStat(stats)) {
            traversal.enqueue(descriptor.relativePath);
            return;
        }

        collector.register(descriptor.relativePosix, descriptor.absolutePath);
    });
}

export async function scanProjectTree(projectRoot, fsFacade: ProjectIndexFsFacade = fs, metrics = null, options = {}) {
    const { signal, ensureNotAborted } = createProjectIndexAbortGuard(options);
    const traversal = createDirectoryTraversal(projectRoot);
    const collector = createProjectTreeCollector(metrics);

    const processNextDirectory = async (): Promise<void> => {
        if (!traversal.hasPending()) {
            return;
        }

        const directoryContext = traversal.next();
        if (!directoryContext) {
            return processNextDirectory();
        }

        const entries = await resolveDirectoryListing({
            directoryContext,
            fsFacade,
            metrics,
            ensureNotAborted,
            signal
        });

        await processDirectoryEntries({
            entries,
            directoryContext,
            traversal,
            collector,
            projectRoot,
            fsFacade,
            ensureNotAborted,
            metrics
        });

        return processNextDirectory();
    };

    await processNextDirectory();

    return collector.snapshot();
}
