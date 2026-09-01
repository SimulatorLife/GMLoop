import assert from "node:assert/strict";
import { test } from "node:test";

import { __gameMakerCliCatalogTest__ } from "../src/modules/game-maker-cli/catalog.js";

const {
    isValidCachedCompanionCatalogEntry,
    isValidCachedCompanionCatalogParameter,
    parseCachedCompanionCatalogCommands
} = __gameMakerCliCatalogTest__;

const EXPECTED_VERSION = "2024.14.15";
const CACHE_PATH = "/projects/example/.gmloop/gm-cli-commands-cache.json";

/**
 * Capture `console.warn` calls so the cache-validation regressions can
 * assert on the diagnostic text without spamming the test runner output.
 * The original `console.warn` is restored in `finally` so other tests are
 * unaffected even if this one fails partway through.
 */
function captureConsoleWarnings(): { messages: Array<string>; restore: () => void } {
    const originalWarn = console.warn;
    const messages: Array<string> = [];
    console.warn = (...args: Array<unknown>) => {
        messages.push(
            args
                .map((entry) => {
                    if (typeof entry === "string") {
                        return entry;
                    }
                    if (entry instanceof Error) {
                        return entry.message;
                    }
                    return JSON.stringify(entry);
                })
                .join(" ")
        );
    };
    return {
        messages,
        restore: () => {
            console.warn = originalWarn;
        }
    };
}

function createValidCachePayload(): string {
    return JSON.stringify({
        commands: [
            {
                commandPath: ["manual", "read"],
                description: "Query the GameMaker manual",
                displayName: "manual read",
                parameters: [
                    {
                        choices: [],
                        description: "Search query",
                        kind: "argument",
                        multiple: false,
                        name: "query",
                        required: true,
                        syntax: "<query>",
                        valueType: "string"
                    },
                    {
                        choices: ["stable", "beta"],
                        description: "GameMaker channel",
                        kind: "flag",
                        multiple: false,
                        name: "channel",
                        required: false,
                        syntax: "--channel <name>",
                        valueType: "string"
                    }
                ],
                usageLines: ["gm-cli manual read <query>"]
            }
        ],
        version: EXPECTED_VERSION
    });
}

void test("parseCachedCompanionCatalogCommands accepts a well-formed cache payload", () => {
    // Happy path: a cache produced by the current loader must round-trip
    // through the validator with every field intact, so the catalog loader
    // can skip the expensive gm-cli re-query on warm starts.
    const capture = captureConsoleWarnings();

    try {
        const parsed = parseCachedCompanionCatalogCommands(createValidCachePayload(), EXPECTED_VERSION, CACHE_PATH);

        assert.ok(parsed !== null, "well-formed cache must validate");
        assert.equal(parsed?.length, 1);
        assert.equal(parsed?.[0]?.displayName, "manual read");
        assert.equal(parsed?.[0]?.parameters.length, 2);
        assert.equal(parsed?.[0]?.parameters[0]?.kind, "argument");
        assert.equal(parsed?.[0]?.parameters[1]?.choices.length, 2);
        assert.ok(Object.isFrozen(parsed));
        assert.ok(Object.isFrozen(parsed?.[0]));
        assert.ok(Object.isFrozen(parsed?.[0]?.parameters[0]));
        assert.equal(capture.messages.length, 0, "valid cache must not emit warnings");
    } finally {
        capture.restore();
    }
});

void test("parseCachedCompanionCatalogCommands rejects truncated JSON", () => {
    // Regression: the previous loader silently caught every parse error and
    // re-queried gm-cli, masking the fact that the cache file was malformed.
    // The hardened helper must surface a structured warning that names the
    // cache path and return `null` so the caller falls back cleanly.
    const capture = captureConsoleWarnings();

    try {
        const parsed = parseCachedCompanionCatalogCommands(
            '{ "version": "2024.14.15", "commands": ',
            EXPECTED_VERSION,
            CACHE_PATH
        );

        assert.equal(parsed, null);
        assert.equal(capture.messages.length, 1);
        assert.match(capture.messages[0] ?? "", /not valid JSON/);
        assert.match(capture.messages[0] ?? "", /gm-cli companion catalog cache/);
    } finally {
        capture.restore();
    }
});

void test("parseCachedCompanionCatalogCommands rejects non-object top-level values", () => {
    // Regression: the previous loader accepted `null`, arrays, and
    // primitives whenever the truthiness check `cacheData && ...` was
    // satisfied. Each of those payloads must now be rejected with a
    // self-documenting warning so the diagnostic points at the cache file
    // rather than the gm-cli subprocess.
    const capture = captureConsoleWarnings();

    try {
        for (const invalidPayload of ['"a string"', "[1, 2, 3]", "null", "42"]) {
            capture.messages.length = 0;
            const parsed = parseCachedCompanionCatalogCommands(invalidPayload, EXPECTED_VERSION, CACHE_PATH);

            assert.equal(parsed, null, `top-level ${invalidPayload} must be rejected`);
            assert.equal(capture.messages.length, 1);
            assert.match(capture.messages[0] ?? "", /must be a JSON object/);
        }
    } finally {
        capture.restore();
    }
});

void test("parseCachedCompanionCatalogCommands rejects a missing or wrong-type version field", () => {
    // Regression: the previous loader treated `cacheData.version === version`
    // as the only version check, so a missing version produced
    // `undefined === string` (always false) and silently re-queried gm-cli
    // every startup. The hardened helper now classifies missing or
    // wrong-type versions as malformed cache payloads.
    const capture = captureConsoleWarnings();

    try {
        for (const [label, payload, expectedSubstring] of [
            ["missing version", { commands: [], version: undefined }, /missing a string "version"/],
            ["numeric version", { commands: [], version: 42 }, /missing a string "version"/],
            ["null version", { commands: [], version: null }, /missing a string "version"/],
            ["version mismatch", { commands: [], version: "9999.0.0" }, /but gm-cli reports/]
        ] as const) {
            capture.messages.length = 0;
            const parsed = parseCachedCompanionCatalogCommands(JSON.stringify(payload), EXPECTED_VERSION, CACHE_PATH);

            assert.equal(parsed, null, `${label} must be rejected`);
            assert.equal(capture.messages.length, 1);
            assert.match(
                capture.messages[0] ?? "",
                expectedSubstring,
                `${label} warning must mention ${expectedSubstring}`
            );
        }
    } finally {
        capture.restore();
    }
});

void test("parseCachedCompanionCatalogCommands rejects a missing or non-array commands field", () => {
    // Regression: the previous loader only checked `Array.isArray(...)` and
    // would crash on missing or non-array values that slipped past the
    // surrounding `try/catch`. The hardened helper must flag every shape
    // mismatch with a warning.
    const capture = captureConsoleWarnings();

    try {
        for (const [label, payload] of [
            ["missing commands", { version: EXPECTED_VERSION }],
            ["object commands", { commands: { length: 0 }, version: EXPECTED_VERSION }],
            ["string commands", { commands: "manual read", version: EXPECTED_VERSION }],
            ["null commands", { commands: null, version: EXPECTED_VERSION }]
        ] as const) {
            capture.messages.length = 0;
            const parsed = parseCachedCompanionCatalogCommands(JSON.stringify(payload), EXPECTED_VERSION, CACHE_PATH);

            assert.equal(parsed, null, `${label} must be rejected`);
            assert.equal(capture.messages.length, 1);
            assert.match(capture.messages[0] ?? "", /missing an array "commands"/);
        }
    } finally {
        capture.restore();
    }
});

void test("parseCachedCompanionCatalogCommands rejects a malformed command entry", () => {
    // Regression: the previous shallow validation let a single corrupt
    // entry pass through, and consumers crashed the first time they read
    // `entry.displayName` or `entry.parameters[0].kind`. The hardened
    // helper now walks every command and parameter entry and rejects the
    // whole cache on the first violation.
    const capture = captureConsoleWarnings();

    try {
        for (const [label, rawEntry, expectedWarningSubstring] of [
            ["null entry", null, /malformed entry at index 0/],
            ["non-object entry", "manual read", /malformed entry at index 0/],
            [
                "missing displayName",
                {
                    commandPath: ["x"],
                    description: "x",
                    displayName: "",
                    parameters: [],
                    usageLines: []
                },
                /malformed entry at index 0/
            ],
            [
                "wrong-type commandPath",
                {
                    commandPath: "manual read",
                    description: "x",
                    displayName: "x",
                    parameters: [],
                    usageLines: []
                },
                /malformed entry at index 0/
            ],
            [
                "non-string usage line",
                {
                    commandPath: ["x"],
                    description: "x",
                    displayName: "x",
                    parameters: [],
                    usageLines: ["ok", 42]
                },
                /malformed entry at index 0/
            ],
            [
                "non-array parameters",
                {
                    commandPath: ["x"],
                    description: "x",
                    displayName: "x",
                    parameters: "query",
                    usageLines: []
                },
                /malformed entry at index 0/
            ],
            [
                "malformed parameter",
                {
                    commandPath: ["x"],
                    description: "x",
                    displayName: "x",
                    parameters: [{ kind: "argument", valueType: "string" }],
                    usageLines: []
                },
                /malformed entry at index 0/
            ]
        ] as const) {
            capture.messages.length = 0;
            const parsed = parseCachedCompanionCatalogCommands(
                JSON.stringify({ commands: [rawEntry], version: EXPECTED_VERSION }),
                EXPECTED_VERSION,
                CACHE_PATH
            );

            assert.equal(parsed, null, `${label} must be rejected`);
            assert.equal(capture.messages.length, 1);
            assert.match(capture.messages[0] ?? "", expectedWarningSubstring);
        }
    } finally {
        capture.restore();
    }
});

void test("isValidCachedCompanionCatalogEntry accepts a well-formed entry and rejects every documented shape violation", () => {
    // Direct type-guard coverage: the per-entry predicate must reject
    // every documented shape violation independently of the surrounding
    // JSON parser so the cache loader's contract stays narrow.
    const validEntry = {
        commandPath: ["manual", "read"],
        description: "x",
        displayName: "manual read",
        parameters: [
            {
                choices: [],
                description: "x",
                kind: "argument",
                multiple: false,
                name: "query",
                required: true,
                syntax: "<query>",
                valueType: "string"
            }
        ],
        usageLines: []
    };

    assert.equal(isValidCachedCompanionCatalogEntry(validEntry), true);
    assert.equal(isValidCachedCompanionCatalogEntry(null), false);
    assert.equal(isValidCachedCompanionCatalogEntry(undefined), false);
    assert.equal(isValidCachedCompanionCatalogEntry("not an object"), false);
    assert.equal(isValidCachedCompanionCatalogEntry([]), false);

    assert.equal(
        isValidCachedCompanionCatalogEntry({ ...validEntry, displayName: "" }),
        false,
        "empty displayName must be rejected"
    );
    assert.equal(
        isValidCachedCompanionCatalogEntry({ ...validEntry, commandPath: ["ok", 42] }),
        false,
        "non-string commandPath segment must be rejected"
    );
    assert.equal(
        isValidCachedCompanionCatalogEntry({
            ...validEntry,
            parameters: [{ ...validEntry.parameters[0], kind: "wat" }]
        }),
        false,
        "unknown parameter kind must be rejected"
    );
});

void test("isValidCachedCompanionCatalogParameter rejects every documented parameter shape violation", () => {
    const validParameter = {
        choices: [],
        description: "x",
        kind: "argument" as const,
        multiple: false,
        name: "query",
        required: true,
        syntax: "<query>",
        valueType: "string" as const
    };

    assert.equal(isValidCachedCompanionCatalogParameter(validParameter), true);
    assert.equal(isValidCachedCompanionCatalogParameter(null), false);
    assert.equal(isValidCachedCompanionCatalogParameter({ ...validParameter, kind: "string" }), false);
    assert.equal(isValidCachedCompanionCatalogParameter({ ...validParameter, valueType: "number" }), false);
    assert.equal(isValidCachedCompanionCatalogParameter({ ...validParameter, multiple: "yes" }), false);
    assert.equal(isValidCachedCompanionCatalogParameter({ ...validParameter, required: 1 }), false);
    assert.equal(isValidCachedCompanionCatalogParameter({ ...validParameter, choices: ["ok", 42] }), false);
    assert.equal(isValidCachedCompanionCatalogParameter({ ...validParameter, name: 42 }), false);
    assert.equal(isValidCachedCompanionCatalogParameter({ ...validParameter, syntax: null }), false);
});
