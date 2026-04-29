import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

export type GraphDatabase = DatabaseSync;

const SQLITE_BUSY_TIMEOUT_MS = 5000;

export type GraphDatabaseRuntimeInfo = Readonly<{
    busyTimeoutMs: number;
    driver: "node:sqlite";
    experimental: true;
    foreignKeysEnabled: boolean;
    journalMode: string;
    synchronousMode: string;
    warningPolicy: "documented-and-reported";
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
 * Run lightweight maintenance passes after graph writes.
 */
export function optimizeGraphDatabase(database: GraphDatabase): void {
    database.exec("ANALYZE;");
    database.exec("PRAGMA optimize;");
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
        experimental: true,
        foreignKeysEnabled: foreignKeysRow?.foreign_keys === 1,
        journalMode: journalModeRow?.journal_mode ?? "unknown",
        synchronousMode:
            synchronousRow?.synchronous === 0
                ? "OFF"
                : synchronousRow?.synchronous === 1
                  ? "NORMAL"
                  : synchronousRow?.synchronous === 2
                    ? "FULL"
                    : synchronousRow?.synchronous === 3
                      ? "EXTRA"
                      : "unknown",
        warningPolicy: "documented-and-reported"
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
