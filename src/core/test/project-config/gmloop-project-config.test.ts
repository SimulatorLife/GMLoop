import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { Core } from "../../index.js";

async function writeConfigFile(contents: string): Promise<string> {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "gmloop-core-config-"));
    const configPath = path.join(tempRoot, "gmloop.json");
    await writeFile(configPath, contents, "utf8");
    return configPath;
}

void test("parseGmloopProjectConfig accepts top-level tool sections", () => {
    const config = Core.parseGmloopProjectConfig(
        JSON.stringify({
            printWidth: 95,
            lintRules: {
                "gml/no-globalvar": "error"
            },
            refactor: {
                codemods: {
                    namingConvention: {}
                }
            }
        }),
        "/tmp/gmloop.json"
    );

    assert.equal(config.printWidth, 95);
    assert.deepEqual(config.lintRules, {
        "gml/no-globalvar": "error"
    });
    assert.deepEqual(config.refactor, {
        codemods: {
            namingConvention: {}
        }
    });
});

void test("assertGmloopProjectConfigObject rejects non-object payloads", () => {
    assert.throws(() => Core.assertGmloopProjectConfigObject([], "gmloop.json"), {
        name: "TypeError",
        message: "gmloop.json must be a JSON object."
    });
    assert.throws(() => Core.assertGmloopProjectConfigObject(null, "gmloop.json"), {
        name: "TypeError",
        message: "gmloop.json must be a JSON object."
    });
});

void test("loadGmloopProjectConfig surfaces source-aware parse errors", async () => {
    const configPath = await writeConfigFile('{\n  "printWidth": 100,\n');

    try {
        await assert.rejects(() => Core.loadGmloopProjectConfig(configPath), {
            name: "JsonParseError",
            message: new RegExp(configPath.replaceAll(/[.*+?^${}()|[\]\\]/gu, String.raw`\$&`))
        });
    } finally {
        await rm(path.dirname(configPath), { recursive: true, force: true });
    }
});

void test("parseGmloopProjectConfig tolerates unknown top-level properties", () => {
    const config = Core.parseGmloopProjectConfig(
        JSON.stringify({
            // Known sections
            printWidth: 120,
            lintRules: { "gml/no-globalvar": "warn" },
            // Unknown properties — generic loader must ignore/tolerate, not strip
            unknownToolSection: { nested: true },
            totallyUnknownProperty: 42,
            anotherUnknown: "preserve-me"
        }),
        "/tmp/gmloop.json"
    );

    // Known sections must be present
    assert.equal(config.printWidth, 120);
    assert.deepEqual(config.lintRules, { "gml/no-globalvar": "warn" });

    // Unknown top-level properties must be preserved, not dropped
    assert.deepEqual(config.unknownToolSection, { nested: true });
    assert.equal(config.totallyUnknownProperty, 42);
    assert.equal(config.anotherUnknown, "preserve-me");

    // Verify all 5 keys are present (no stripping occurred)
    assert.deepEqual(Object.keys(config).sort(), [
        "anotherUnknown",
        "lintRules",
        "printWidth",
        "totallyUnknownProperty",
        "unknownToolSection"
    ]);
});
