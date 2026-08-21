import assert from "node:assert/strict";
import test from "node:test";

import { parseCachedCliCommandsCache } from "../src/modules/game-maker-cli/index.js";

const EXPECTED_VERSION = "1.2.3";

function createValidEntry(overrides: Record<string, unknown> = {}) {
    return {
        commandPath: ["resource", "list"],
        description: "List resources.",
        displayName: "resource list",
        parameters: [
            {
                choices: [],
                description: "Filter flag",
                kind: "flag",
                multiple: false,
                name: "--filter",
                required: false,
                syntax: "--filter <value>",
                valueType: "string"
            }
        ],
        usageLines: ["gm-cli resource list"],
        ...overrides
    };
}

void test("parseCachedCliCommandsCache accepts a well-formed cache and freezes every entry", () => {
    const cache = {
        commands: [
            createValidEntry(),
            createValidEntry({ displayName: "resource add", commandPath: ["resource", "add"] })
        ],
        version: EXPECTED_VERSION
    };

    const parsed = parseCachedCliCommandsCache(JSON.stringify(cache), EXPECTED_VERSION);

    assert.ok(parsed !== null, "expected the validator to accept a well-formed cache");
    assert.equal(parsed.length, 2);
    assert.deepEqual(parsed[0].commandPath, ["resource", "list"]);
    assert.equal(parsed[0].displayName, "resource list");
    assert.equal(parsed[1].displayName, "resource add");
    assert.ok(Object.isFrozen(parsed));
    assert.ok(Object.isFrozen(parsed[0]));
    assert.ok(Object.isFrozen(parsed[0].commandPath));
    assert.ok(Object.isFrozen(parsed[0].usageLines));
    assert.ok(Object.isFrozen(parsed[0].parameters));
    assert.ok(Object.isFrozen(parsed[0].parameters[0]));
});

void test("parseCachedCliCommandsCache rejects malformed JSON", () => {
    const parsed = parseCachedCliCommandsCache("{not valid json", EXPECTED_VERSION);
    assert.equal(parsed, null);
});

void test("parseCachedCliCommandsCache rejects an empty payload", () => {
    const parsed = parseCachedCliCommandsCache("", EXPECTED_VERSION);
    assert.equal(parsed, null);
});

void test("parseCachedCliCommandsCache rejects a non-object top-level value", () => {
    assert.equal(parseCachedCliCommandsCache(JSON.stringify(null), EXPECTED_VERSION), null);
    assert.equal(parseCachedCliCommandsCache(JSON.stringify(42), EXPECTED_VERSION), null);
    assert.equal(parseCachedCliCommandsCache(JSON.stringify(["v1"]), EXPECTED_VERSION), null);
    assert.equal(parseCachedCliCommandsCache(JSON.stringify("v1"), EXPECTED_VERSION), null);
});

void test("parseCachedCliCommandsCache rejects a cache whose version does not match", () => {
    const cache = {
        commands: [createValidEntry()],
        version: "0.0.0"
    };

    const parsed = parseCachedCliCommandsCache(JSON.stringify(cache), EXPECTED_VERSION);
    assert.equal(parsed, null);
});

void test("parseCachedCliCommandsCache rejects a cache whose version field is missing or non-string", () => {
    assert.equal(
        parseCachedCliCommandsCache(JSON.stringify({ commands: [] }), EXPECTED_VERSION),
        null,
        "missing version must be rejected"
    );
    assert.equal(
        parseCachedCliCommandsCache(JSON.stringify({ commands: [], version: 42 }), EXPECTED_VERSION),
        null,
        "non-string version must be rejected"
    );
});

void test("parseCachedCliCommandsCache rejects a cache whose commands field is not an array", () => {
    const parsed = parseCachedCliCommandsCache(
        JSON.stringify({ commands: { not: "an array" }, version: EXPECTED_VERSION }),
        EXPECTED_VERSION
    );
    assert.equal(parsed, null);
});

void test("parseCachedCliCommandsCache rejects an entry whose commandPath is not a string array", () => {
    const cache = {
        commands: [createValidEntry({ commandPath: ["resource", 42] })],
        version: EXPECTED_VERSION
    };
    assert.equal(parseCachedCliCommandsCache(JSON.stringify(cache), EXPECTED_VERSION), null);
});

void test("parseCachedCliCommandsCache rejects an entry whose description is not a string", () => {
    const cache = {
        commands: [createValidEntry({ description: { text: "List resources." } })],
        version: EXPECTED_VERSION
    };
    assert.equal(parseCachedCliCommandsCache(JSON.stringify(cache), EXPECTED_VERSION), null);
});

void test("parseCachedCliCommandsCache rejects an entry whose parameters contain a malformed item", () => {
    const cache = {
        commands: [
            createValidEntry({
                parameters: [
                    {
                        choices: [],
                        description: "filter",
                        kind: "not-a-kind",
                        multiple: false,
                        name: "--filter",
                        required: false,
                        syntax: "--filter <value>",
                        valueType: "string"
                    }
                ]
            })
        ],
        version: EXPECTED_VERSION
    };
    assert.equal(parseCachedCliCommandsCache(JSON.stringify(cache), EXPECTED_VERSION), null);
});

void test("parseCachedCliCommandsCache rejects an entry whose usageLines contain a non-string", () => {
    const cache = {
        commands: [createValidEntry({ usageLines: ["gm-cli resource list", 99] })],
        version: EXPECTED_VERSION
    };
    assert.equal(parseCachedCliCommandsCache(JSON.stringify(cache), EXPECTED_VERSION), null);
});

void test("parseCachedCliCommandsCache rejects a non-object entry", () => {
    const cache = {
        commands: ["resource list"],
        version: EXPECTED_VERSION
    };
    assert.equal(parseCachedCliCommandsCache(JSON.stringify(cache), EXPECTED_VERSION), null);
});

void test("parseCachedCliCommandsCache accepts an empty commands array when version matches", () => {
    const parsed = parseCachedCliCommandsCache(
        JSON.stringify({ commands: [], version: EXPECTED_VERSION }),
        EXPECTED_VERSION
    );
    assert.ok(parsed !== null);
    assert.deepEqual(parsed, []);
});

void test("parseCachedCliCommandsCache produces entries whose nested arrays are independent copies", () => {
    const cache = {
        commands: [createValidEntry()],
        version: EXPECTED_VERSION
    };

    const parsed = parseCachedCliCommandsCache(JSON.stringify(cache), EXPECTED_VERSION);
    assert.ok(parsed !== null);
    assert.equal(parsed[0].commandPath[0], "resource");
    assert.equal(parsed[0].commandPath[1], "list");
    assert.equal(parsed[0].parameters.length, 1);
    assert.equal(parsed[0].parameters[0].name, "--filter");
});
