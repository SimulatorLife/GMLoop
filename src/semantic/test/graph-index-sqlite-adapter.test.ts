import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
    isSqliteDuplicateColumnError,
    isSqliteMissingTableError,
    openGraphDatabase
} from "../src/graph-index/sqlite-adapter.js";

void describe("isSqliteMissingTableError", () => {
    void it("returns true when the driver throws a missing-table error for any table", () => {
        const database = openGraphDatabase(":memory:");

        try {
            let captured: unknown;
            try {
                database.prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'").get();
            } catch (error) {
                captured = error;
            }

            assert.ok(captured, "expected the driver to throw for a missing table");
            assert.equal(isSqliteMissingTableError(captured), true);
        } finally {
            database.close();
        }
    });

    void it("narrows the match to a specific table when one is provided", () => {
        const database = openGraphDatabase(":memory:");

        try {
            database.exec("CREATE TABLE schema_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL)");

            let captured: unknown;
            try {
                database.prepare("SELECT value FROM schema_meta WHERE key = 'schema_version'").get();
            } catch (error) {
                captured = error;
            }

            // The query against `schema_meta` succeeded because the table
            // exists; the helper therefore must not report the (absent)
            // "missing table" condition.
            assert.equal(captured, undefined);
            assert.equal(
                isSqliteMissingTableError(
                    Object.assign(new Error("no such table: schema_meta"), { code: "ERR_SQLITE_ERROR" }),
                    "schema_meta"
                ),
                true
            );
            assert.equal(
                isSqliteMissingTableError(
                    Object.assign(new Error("no such table: other_table"), { code: "ERR_SQLITE_ERROR" }),
                    "schema_meta"
                ),
                false
            );
        } finally {
            database.close();
        }
    });

    void it("returns false for non-SQLite errors and unrelated SQLite errors", () => {
        assert.equal(isSqliteMissingTableError(new Error("plain failure")), false);
        assert.equal(isSqliteMissingTableError("string was thrown"), false);
        assert.equal(isSqliteMissingTableError(null), false);
        assert.equal(isSqliteMissingTableError(undefined), false);

        const wrongCode = Object.assign(new Error("no such table: foo"), { code: "EOTHER" });
        assert.equal(isSqliteMissingTableError(wrongCode), false);

        const duplicateColumn = Object.assign(new Error("duplicate column name: foo"), {
            code: "ERR_SQLITE_ERROR"
        });
        assert.equal(isSqliteMissingTableError(duplicateColumn), false);
    });
});

void describe("isSqliteDuplicateColumnError", () => {
    void it("returns true for the duplicate-column failure raised by ALTER TABLE", () => {
        const tempRoot = mkdtempSync(path.join(os.tmpdir(), "gmloop-sqlite-error-guards-"));
        const databasePath = path.join(tempRoot, "graph.sqlite");
        const database = openGraphDatabase(databasePath);

        try {
            database.exec(
                "CREATE TABLE semantic_state(id INTEGER PRIMARY KEY, source_signature TEXT NOT NULL DEFAULT '')"
            );

            let captured: unknown;
            try {
                database.exec("ALTER TABLE semantic_state ADD COLUMN source_signature TEXT NOT NULL DEFAULT ''");
            } catch (error) {
                captured = error;
            }

            assert.ok(captured, "expected the driver to throw for a duplicate column");
            assert.equal(isSqliteDuplicateColumnError(captured), true);
        } finally {
            database.close();
            rmSync(tempRoot, { recursive: true, force: true });
        }
    });

    void it("narrows the match to a specific column when one is provided", () => {
        const duplicateSourceSignature = Object.assign(new Error("duplicate column name: source_signature"), {
            code: "ERR_SQLITE_ERROR"
        });
        const duplicateOther = Object.assign(new Error("duplicate column name: other_column"), {
            code: "ERR_SQLITE_ERROR"
        });

        assert.equal(isSqliteDuplicateColumnError(duplicateSourceSignature, "source_signature"), true);
        assert.equal(isSqliteDuplicateColumnError(duplicateOther, "source_signature"), false);
        assert.equal(isSqliteDuplicateColumnError(duplicateSourceSignature), true);
    });

    void it("returns false for non-SQLite errors and unrelated SQLite errors", () => {
        assert.equal(isSqliteDuplicateColumnError(new Error("plain failure")), false);
        assert.equal(isSqliteDuplicateColumnError("string was thrown"), false);
        assert.equal(isSqliteDuplicateColumnError(null), false);
        assert.equal(isSqliteDuplicateColumnError(undefined), false);

        const wrongCode = Object.assign(new Error("duplicate column name: foo"), { code: "EOTHER" });
        assert.equal(isSqliteDuplicateColumnError(wrongCode), false);

        const missingTable = Object.assign(new Error("no such table: foo"), { code: "ERR_SQLITE_ERROR" });
        assert.equal(isSqliteDuplicateColumnError(missingTable), false);
    });
});
