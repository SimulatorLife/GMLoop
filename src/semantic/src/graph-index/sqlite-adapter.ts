import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { Core } from "@gmloop/core";

export type GraphDatabase = DatabaseSync;

const SQLITE_BUSY_TIMEOUT_MS = 5000;

/**
 * Single error code emitted by Node's `node:sqlite` driver for every
 * SQL-level error. The driver does not expose finer-grained codes, so callers
 * that need to distinguish between "no such table", "duplicate column", etc.
 * must inspect the message text. Centralising the constant here keeps every
 * detector consistent.
 */
const SQLITE_ERROR_CODE = "ERR_SQLITE_ERROR" as const;

const NO_SUCH_TABLE_PREFIX = "no such table: " as const;
const DUPLICATE_COLUMN_PREFIX = "duplicate column name: " as const;

export type GraphDatabaseRuntimeInfo = Readonly<{
    busyTimeoutMs: number;
    driver: "node:sqlite";
    foreignKeysEnabled: boolean;
    journalMode: string;
    runtimeStability: "stable";
    synchronousMode: string;
}>;

export type GraphDatabaseIntegrityReport = Readonly<{
    foreignKeyViolationCount: number;
    ok: boolean;
    quickCheckResult: string;
}>;

function configureGraphDatabase(database: GraphDatabase): void {
    database.exec("PRAGMA journal_mode = WAL;");
    database.exec("PRAGMA synchronous = NORMAL;");
    database.exec(`PRAGMA busy_timeout = ${String(SQLITE_BUSY_TIMEOUT_MS)};`);
    database.exec("PRAGMA foreign_keys = ON;");
    // A no-op on a database that already has tables until the next VACUUM, but
    // takes effect immediately on a freshly created one. Without this, freed
    // pages (from incremental rebuilds, deleted files, etc.) accumulate in the
    // freelist forever instead of shrinking the file, since the default mode
    // (NONE) never reclaims space on its own.
    database.exec("PRAGMA auto_vacuum = INCREMENTAL;");
}

/**
 * Open a graph database path and apply the standard runtime pragmas.
 */
export function openGraphDatabase(databasePath: string): GraphDatabase {
    mkdirSync(path.dirname(databasePath), { recursive: true });
    const database = new DatabaseSync(databasePath);
    configureGraphDatabase(database);
    return database;
}

/**
 * Open an existing graph database path and apply the standard runtime pragmas.
 */
export function openExistingGraphDatabase(databasePath: string): GraphDatabase {
    if (!existsSync(databasePath)) {
        throw new Error(`Graph database not found at ${databasePath}. Run 'gmloop graph index' first.`);
    }

    return openGraphDatabase(databasePath);
}

/**
 * Run a write transaction against the graph database.
 */
export function runGraphDatabaseTransaction(database: GraphDatabase, operation: () => void): void {
    database.exec("BEGIN");
    try {
        operation();
        database.exec("COMMIT");
    } catch (error) {
        database.exec("ROLLBACK");
        throw error;
    }
}

/**
 * Run an exclusive write-intent transaction against the graph database.
 *
 * `BEGIN IMMEDIATE` obtains the writer reservation before callers inspect a
 * compare-and-swap value. This prevents separate processes from reading the
 * same project head and both attempting to publish a semantic generation.
 */
export function runGraphDatabaseImmediateTransaction(database: GraphDatabase, operation: () => void): void {
    database.exec("BEGIN IMMEDIATE");
    try {
        operation();
        database.exec("COMMIT");
    } catch (error) {
        database.exec("ROLLBACK");
        throw error;
    }
}

// Bounds how many freelist pages a single maintenance pass reclaims (a page is
// 4KB by default, so this caps a pass at a few MB) so it stays fast enough to
// run after every write batch rather than needing a separate slow VACUUM.
const INCREMENTAL_VACUUM_PAGE_LIMIT = 1024;

/**
 * Run lightweight maintenance passes after graph writes.
 */
export function optimizeGraphDatabase(database: GraphDatabase): void {
    database.exec("ANALYZE;");
    database.exec("PRAGMA optimize;");
    // Only reclaims space when auto_vacuum is already INCREMENTAL (see
    // configureGraphDatabase); a no-op otherwise, so this is always safe to call.
    database.exec(`PRAGMA incremental_vacuum(${String(INCREMENTAL_VACUUM_PAGE_LIMIT)});`);
}

/**
 * Percentage of the database file made up of reclaimable (freelist) pages, or
 * `null` when the database is empty. Databases created before auto_vacuum was
 * enabled (see {@link configureGraphDatabase}) can only shed this bloat via a
 * full {@link vacuumGraphDatabase} pass.
 */
export function readGraphDatabaseBloatPercent(database: GraphDatabase): number | null {
    const pageCountRow = database.prepare("PRAGMA page_count").get() as { page_count?: number } | undefined;
    const freelistRow = database.prepare("PRAGMA freelist_count").get() as { freelist_count?: number } | undefined;
    const pageCount = pageCountRow?.page_count ?? 0;
    const freelistCount = freelistRow?.freelist_count ?? 0;
    if (pageCount === 0) {
        return null;
    }

    return Math.round((freelistCount / pageCount) * 100);
}

/**
 * Rewrite the database file to reclaim all freelist pages and switch it onto
 * incremental auto-vacuum going forward. This is a full-file rewrite (needs
 * roughly as much free disk space as the database itself and an exclusive
 * lock), so it must only run when a caller explicitly requests it, never as
 * part of routine indexing.
 */
export function vacuumGraphDatabase(database: GraphDatabase): void {
    database.exec("VACUUM;");
}

/**
 * Read the configured runtime state for the current graph database connection.
 */
export function getGraphDatabaseRuntimeInfo(database: GraphDatabase): GraphDatabaseRuntimeInfo {
    const journalModeRow = database.prepare("PRAGMA journal_mode").get() as { journal_mode?: string } | undefined;
    const synchronousRow = database.prepare("PRAGMA synchronous").get() as { synchronous?: number } | undefined;
    const foreignKeysRow = database.prepare("PRAGMA foreign_keys").get() as { foreign_keys?: number } | undefined;

    return Object.freeze({
        busyTimeoutMs: SQLITE_BUSY_TIMEOUT_MS,
        driver: "node:sqlite",
        foreignKeysEnabled: foreignKeysRow?.foreign_keys === 1,
        journalMode: journalModeRow?.journal_mode ?? "unknown",
        runtimeStability: "stable",
        synchronousMode:
            synchronousRow?.synchronous === 0
                ? "OFF"
                : synchronousRow?.synchronous === 1
                  ? "NORMAL"
                  : synchronousRow?.synchronous === 2
                    ? "FULL"
                    : synchronousRow?.synchronous === 3
                      ? "EXTRA"
                      : "unknown"
    });
}

/**
 * Run integrity checks against the graph database.
 */
export function inspectGraphDatabaseIntegrity(database: GraphDatabase): GraphDatabaseIntegrityReport {
    const quickCheckRows = database.prepare("PRAGMA quick_check").all() as Array<{ quick_check?: string }>;
    const foreignKeyRows = database.prepare("PRAGMA foreign_key_check").all() as Array<unknown>;
    const quickCheckResult =
        quickCheckRows.length === 1 && typeof quickCheckRows[0]?.quick_check === "string"
            ? quickCheckRows[0].quick_check
            : quickCheckRows.length === 0
              ? "unknown"
              : "multiple-results";

    return Object.freeze({
        foreignKeyViolationCount: foreignKeyRows.length,
        ok: quickCheckResult === "ok" && foreignKeyRows.length === 0,
        quickCheckResult
    });
}

/**
 * Determine whether {@link error} indicates that a SQLite query referenced a
 * table that does not exist in the current schema.
 *
 * Node's `node:sqlite` driver collapses every SQL-level error into the single
 * {@link SQLITE_ERROR_CODE}, so callers that want to treat "missing table" as
 * a benign condition (e.g. reading an optional cache table that has not been
 * created yet) must inspect the message text. The optional {@link tableName}
 * argument narrows the match to a specific table; when omitted, any
 * "no such table" message is accepted.
 *
 * @param {unknown} error Candidate error-like value thrown by the driver.
 * @param {string} [tableName] When provided, only return `true` if the error
 *   message specifically names this table.
 * @returns {boolean} `true` when {@link error} is a SQLite "no such table"
 *   error, optionally narrowed by {@link tableName}.
 */
export function isSqliteMissingTableError(error: unknown, tableName?: string): boolean {
    if (!Core.isErrorWithCode(error, SQLITE_ERROR_CODE)) {
        return false;
    }

    const message = Core.getErrorMessage(error);
    if (!message.startsWith(NO_SUCH_TABLE_PREFIX)) {
        return false;
    }

    if (tableName === undefined) {
        return true;
    }

    return message === `${NO_SUCH_TABLE_PREFIX}${tableName}`;
}

/**
 * Determine whether {@link error} indicates that an `ALTER TABLE ... ADD COLUMN`
 * statement attempted to add a column that already exists on the target table.
 *
 * Mirrors {@link isSqliteMissingTableError} for the duplicate-column case so
 * idempotent schema migrations can swallow the expected failure without
 * hiding unrelated database problems (corruption, I/O faults, locked database,
 * etc.). The optional {@link columnName} argument narrows the match to a
 * specific column; when omitted, any "duplicate column name" message is
 * accepted.
 *
 * @param {unknown} error Candidate error-like value thrown by the driver.
 * @param {string} [columnName] When provided, only return `true` if the error
 *   message specifically names this column.
 * @returns {boolean} `true` when {@link error} is a SQLite "duplicate column
 *   name" error, optionally narrowed by {@link columnName}.
 */
export function isSqliteDuplicateColumnError(error: unknown, columnName?: string): boolean {
    if (!Core.isErrorWithCode(error, SQLITE_ERROR_CODE)) {
        return false;
    }

    const message = Core.getErrorMessage(error);
    if (!message.startsWith(DUPLICATE_COLUMN_PREFIX)) {
        return false;
    }

    if (columnName === undefined) {
        return true;
    }

    return message === `${DUPLICATE_COLUMN_PREFIX}${columnName}`;
}
