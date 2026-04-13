import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runCliTestCommand } from "../src/cli.js";

const SAMPLE_IDENTIFIERS = {
    meta: {
        manualRoot: "vendor/GameMaker-Manual"
    },
    identifiers: {
        draw_text: {
            type: "function",
            deprecated: false,
            manualPath: "GameMaker_Language/GML_Reference/Drawing/Text/draw_text"
        },
        room_speed: {
            type: "variable",
            deprecated: false
        }
    }
};

async function withFixtureIdentifiers<T>(callback: (identifiersPath: string) => Promise<T>): Promise<T> {
    const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "gmloop-cli-lookup-identifiers-"));

    try {
        const identifiersPath = path.join(temporaryDirectory, "gml-identifiers.json");
        await writeFile(identifiersPath, JSON.stringify(SAMPLE_IDENTIFIERS, null, 2), "utf8");
        return callback(identifiersPath);
    } finally {
        await rm(temporaryDirectory, { recursive: true, force: true });
    }
}

void test("lookup-gml-identifier --help documents the command usage", async () => {
    const result = await runCliTestCommand({ argv: ["lookup-gml-identifier", "--help"] });

    assert.equal(result.exitCode, 0);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /lookup-gml-identifier/);
    assert.match(result.stdout, /--identifiers-path <path>/);
    assert.match(result.stdout, /--json/);
});

void test("lookup-gml-identifier returns metadata for known identifiers", async () => {
    await withFixtureIdentifiers(async (identifiersPath) => {
        const result = await runCliTestCommand({
            argv: ["lookup-gml-identifier", "DRAW_TEXT", "--identifiers-path", identifiersPath, "--json"]
        });

        assert.equal(result.exitCode, 0);
        assert.equal(result.stderr, "");

        const payload = JSON.parse(result.stdout) as {
            found: boolean;
            identifier: string;
            signature: string | null;
            manualUrl: string | null;
            info: {
                type?: string;
            };
        };

        assert.equal(payload.found, true);
        assert.equal(payload.identifier, "draw_text");
        assert.equal(payload.signature, null);
        assert.equal(payload.info.type, "function");
        assert.match(payload.manualUrl ?? "", /manual\.gamemaker\.io/);
    });
});

void test("lookup-gml-identifier returns exit code 2 for unknown identifiers", async () => {
    await withFixtureIdentifiers(async (identifiersPath) => {
        const result = await runCliTestCommand({
            argv: ["lookup-gml-identifier", "not_a_real_builtin", "--identifiers-path", identifiersPath, "--json"]
        });

        assert.equal(result.exitCode, 2);
        assert.equal(result.stderr, "");

        const payload = JSON.parse(result.stdout) as {
            found: boolean;
            identifier: string;
            info: unknown;
        };

        assert.equal(payload.found, false);
        assert.equal(payload.identifier, "not_a_real_builtin");
        assert.equal(payload.info, null);
    });
});
