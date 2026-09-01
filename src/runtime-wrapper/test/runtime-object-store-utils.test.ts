import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readCxcDxStore, readRuntimeObjectPool } from "../src/browser/support/runtime-value-utils.js";

void describe("runtime object-store readers", () => {
    void describe("readCxcDxStore", () => {
        void it("returns the _dx record when fully populated", () => {
            const dx = { key: "value" };
            assert.equal(readCxcDxStore({ _cx: { _dx: dx } }), dx);
        });

        void it("returns undefined when _cx is absent", () => {
            assert.equal(readCxcDxStore({}), undefined);
        });

        void it("returns undefined when _cx is null", () => {
            assert.equal(readCxcDxStore({ _cx: null }), undefined);
        });

        void it("returns undefined when _dx is absent", () => {
            assert.equal(readCxcDxStore({ _cx: {} }), undefined);
        });

        void it("returns undefined when _dx is null", () => {
            assert.equal(readCxcDxStore({ _cx: { _dx: null } }), undefined);
        });
    });

    void describe("readRuntimeObjectPool", () => {
        void it("returns the pool when the runtime chain is fully populated", () => {
            const pool = [{ id: 1 }, { id: 2 }];
            assert.equal(readRuntimeObjectPool({ g_RunRoom: { m_Active: { pool } } }), pool);
        });

        void it("returns an empty pool array unchanged", () => {
            const pool: Array<unknown> = [];
            assert.equal(readRuntimeObjectPool({ g_RunRoom: { m_Active: { pool } } }), pool);
        });

        void it("returns undefined when g_RunRoom is absent", () => {
            assert.equal(readRuntimeObjectPool({}), undefined);
        });

        void it("returns undefined when m_Active is absent", () => {
            assert.equal(readRuntimeObjectPool({ g_RunRoom: {} }), undefined);
        });

        void it("returns undefined when pool is not an array", () => {
            assert.equal(readRuntimeObjectPool({ g_RunRoom: { m_Active: { pool: "not-an-array" } } }), undefined);
        });
    });
});
