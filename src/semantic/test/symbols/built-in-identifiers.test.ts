import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { __loadBuiltInIdentifiersForTests as loadBuiltInIdentifiers } from "../../src/symbols/built-in-identifiers.js";

function createMockFsFacade({ contents, mtimeMs }) {
    return {
        async readFile(filePath, encoding) {
            assert.equal(encoding, "utf8");
            return typeof contents === "function" ? contents(filePath) : contents;
        },
        async stat() {
            return { mtimeMs };
        }
    };
}

void describe("loadBuiltInIdentifiers", () => {
    void it("extracts identifier names when metadata is valid", { concurrency: false }, async () => {
        const facade = createMockFsFacade({
            contents: JSON.stringify(
                {
                    identifiers: {
                        demo: { type: "function" },
                        other: { type: "variable" }
                    }
                },
                null,
                4
            ),
            mtimeMs: 1
        });

        const result = await loadBuiltInIdentifiers(facade);

        const sortedNames = [...result.names].sort();
        assert.deepStrictEqual(sortedNames, ["demo", "other"]);
    });

    void it("ignores malformed identifier payloads", { concurrency: false }, async () => {
        const facade = createMockFsFacade({
            contents: JSON.stringify({ identifiers: "intruder" }),
            mtimeMs: 2
        });

        const result = await loadBuiltInIdentifiers(facade);

        assert.deepStrictEqual([...result.names], []);
    });

    void it("skips entries with invalid descriptor shapes", { concurrency: false }, async () => {
        const facade = createMockFsFacade({
            contents: JSON.stringify(
                {
                    identifiers: {
                        good: { type: "function" },
                        bad: null,
                        emptyType: { type: "" }
                    }
                },
                null,
                4
            ),
            mtimeMs: 3
        });

        const result = await loadBuiltInIdentifiers(facade);

        assert.deepStrictEqual([...result.names], ["good"]);
    });

    void it("treats mtimes within tolerance as cache hits", { concurrency: false }, async () => {
        const baseMtime = 1_700_000_000_000.5;
        const jitter = 0.0004;
        const statValues = [baseMtime, baseMtime + jitter];
        let readFileCalls = 0;

        const facade = {
            async readFile(filePath, encoding) {
                assert.equal(encoding, "utf8");
                readFileCalls += 1;
                return JSON.stringify(
                    {
                        identifiers: {
                            cached: { type: "function" }
                        }
                    },
                    null,
                    4
                );
            },
            async stat() {
                const next = statValues.shift() ?? baseMtime + jitter;
                return { mtimeMs: next };
            }
        };

        const firstLoad = await loadBuiltInIdentifiers(facade);
        const secondLoad = await loadBuiltInIdentifiers(facade);

        assert.equal(readFileCalls, 1);
        assert.strictEqual(secondLoad, firstLoad);
    });
});
