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
