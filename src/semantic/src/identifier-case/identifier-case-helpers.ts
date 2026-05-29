/**
 * @gmloop/semantic
 *
 * Cohort of small single-responsibility helpers that are tightly scoped to
 * the identifier-case domain and are referenced only within the subsystem.
 *
 * This module exists to consolidate three genuinely tiny files that each
 * contain one cohesive concept:
 *   - `fs-facade.ts`        — filesystem abstraction thin-wrapping Core helpers
 *   - `identifier-case-context.ts` — dry-run registry backed by a module Map
 *   - `logger.ts`           — warning logger that excavates reasons from errors
 *
 * All members are re-exported from the identifier-case barrel so call sites
 * need not chase individual deep paths.
 */

import {
    accessSync as nodeAccessSync,
    constants as fsConstants,
    existsSync as nodeExistsSync,
    mkdirSync as nodeMkdirSync,
    type PathOrFileDescriptor,
    renameSync as nodeRenameSync,
    statSync as nodeStatSync
} from "node:fs";

import { Core } from "@gmloop/core";

const { readTextFileSync, writeTextFileSync } = Core;

// ---------------------------------------------------------------------------
// FS facade
// ---------------------------------------------------------------------------

export const DEFAULT_WRITE_ACCESS_MODE = typeof fsConstants?.W_OK === "number" ? fsConstants.W_OK : undefined;

export const defaultIdentifierCaseFsFacade = Object.freeze({
    readFileSync(targetPath: PathOrFileDescriptor) {
        if (typeof targetPath !== "string") {
            throw new TypeError("readFileSync only accepts string paths");
        }
        return readTextFileSync(targetPath);
    },
    writeFileSync(targetPath: PathOrFileDescriptor, contents: string) {
        if (typeof targetPath !== "string") {
            throw new TypeError("writeFileSync only accepts string paths");
        }
        writeTextFileSync(targetPath, contents);
    },
    renameSync(fromPath, toPath) {
        nodeRenameSync(fromPath, toPath);
    },
    accessSync(targetPath, mode = DEFAULT_WRITE_ACCESS_MODE) {
        if (mode === undefined) {
            nodeAccessSync(targetPath);
        } else {
            nodeAccessSync(targetPath, mode);
        }
    },
    statSync(targetPath) {
        return nodeStatSync(targetPath);
    },
    mkdirSync(targetPath) {
        nodeMkdirSync(targetPath, { recursive: true });
    },
    existsSync(targetPath) {
        return nodeExistsSync(targetPath);
    }
});

// ---------------------------------------------------------------------------
// Dry-run context registry
// ---------------------------------------------------------------------------

const DEFAULT_CONTEXT_KEY = "<default>";
const contextMap = new Map();

function normalizeContextKey(filepath: string | null | undefined): string {
    if (typeof filepath !== "string" || filepath.length === 0) {
        return DEFAULT_CONTEXT_KEY;
    }
    return filepath;
}

export function setIdentifierCaseDryRunContext({
    filepath = null,
    renamePlan = null,
    conflicts = [],
    dryRun = true,
    logFilePath = null,
    logger = null,
    diagnostics = null,
    fsFacade = null,
    now = null,
    projectIndex = null
}: {
    filepath?: string | null;
    renamePlan?: unknown;
    conflicts?: unknown;
    dryRun?: boolean;
    logFilePath?: string | null;
    logger?: unknown;
    diagnostics?: unknown;
    fsFacade?: unknown;
    now?: unknown;
    projectIndex?: unknown;
} = {}) {
    const key = normalizeContextKey(filepath);
    contextMap.set(key, {
        renamePlan,
        conflicts,
        dryRun,
        logFilePath,
        logger,
        diagnostics,
        fsFacade,
        now,
        projectIndex
    });
}

export function consumeIdentifierCaseDryRunContext(filepath?: string | null): Record<string, unknown> | null {
    const key = normalizeContextKey(filepath);
    const context = contextMap.get(key) ?? null;
    contextMap.delete(key);
    return context;
}

export function peekIdentifierCaseDryRunContext(filepath?: string | null): Record<string, unknown> | null {
    return contextMap.get(normalizeContextKey(filepath)) ?? null;
}

export function clearIdentifierCaseDryRunContexts() {
    contextMap.clear();
}

// ---------------------------------------------------------------------------
// Warning logger
// ---------------------------------------------------------------------------

const DEFAULT_WARNING_FALLBACK = "Unknown error";

type WarningLogger = Readonly<{
    warn?: (message: string) => void;
}>;

function resolveWarningReason(
    warningCandidates: ReadonlyArray<unknown>,
    fallbackMessage: string = DEFAULT_WARNING_FALLBACK
): string {
    const pendingCandidates: Array<unknown> = [];
    for (let index = warningCandidates.length - 1; index >= 0; index -= 1) {
        pendingCandidates.push(warningCandidates[index]);
    }

    while (pendingCandidates.length > 0) {
        const warningCandidate = pendingCandidates.pop();

        if (Array.isArray(warningCandidate)) {
            for (let index = warningCandidate.length - 1; index >= 0; index -= 1) {
                pendingCandidates.push(warningCandidate[index]);
            }
            continue;
        }

        const reason = Core.getErrorMessage(warningCandidate, { fallback: "" });
        if (reason.length > 0) {
            return reason;
        }
    }

    return fallbackMessage;
}

export function warnWithReason(
    logger: WarningLogger | null | undefined,
    namespace: string,
    message: string,
    ...warningCandidates: ReadonlyArray<unknown>
): void {
    if (typeof logger?.warn !== "function") {
        return;
    }

    const reason = resolveWarningReason(warningCandidates);
    const suffix = reason.length > 0 ? `: ${reason}` : "";

    logger.warn(`[${namespace}] ${message}${suffix}`);
}
