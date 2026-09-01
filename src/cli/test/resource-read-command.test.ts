import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runCliTestCommand } from "../src/cli.js";

async function withTempDir<T>(callback: (dir: string) => Promise<T>): Promise<T> {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gmloop-resource-read-"));
    try {
        return await callback(dir);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

void test("resource command catalog includes list and find leaves", async () => {
    const { getCliCommandCatalog } = await import("../src/cli.js");
    const catalog = getCliCommandCatalog();
    assert.ok(catalog.some((entry) => entry.displayName === "resource list"));
    assert.ok(catalog.some((entry) => entry.displayName === "resource find"));
    assert.ok(catalog.some((entry) => entry.displayName === "resource create-image"));
    assert.equal(
        catalog.some((entry) => entry.displayName === "resource add"),
        false
    );
    assert.equal(
        catalog.some((entry) => entry.displayName === "resource remove"),
        false
    );
    assert.equal(
        catalog.some((entry) => entry.displayName === "resource rename"),
        false
    );
    assert.equal(
        catalog.some((entry) => entry.displayName === "resource duplicate"),
        false
    );
    assert.equal(
        catalog.some((entry) => entry.displayName === "resource move"),
        false
    );
});

void test("resource find returns graph search payload", async () => {
    await withTempDir(async (projectRoot) => {
        await writeFile(path.join(projectRoot, "Project.yyp"), JSON.stringify({ name: "Project" }), "utf8");
        await mkdir(path.join(projectRoot, "scripts", "demo"), { recursive: true });
        await writeFile(
            path.join(projectRoot, "scripts", "demo", "demo.yy"),
            JSON.stringify({ name: "demo", resourceType: "GMScript" }),
            "utf8"
        );
        await writeFile(
            path.join(projectRoot, "scripts", "demo", "demo.gml"),
            "function demo() { return 1; }\n",
            "utf8"
        );

        const result = await runCliTestCommand({
            argv: ["resource", "find", "demo", "--path", projectRoot, "--json"]
        });
        assert.equal(result.exitCode, 0);
        const payload = JSON.parse(result.stdout) as { ok: boolean; payload: { query: string } };
        assert.equal(payload.ok, true);
        assert.equal(payload.payload.query, "demo");
    });
});

void test("resource command help points edits at gm-cli resourcetool", async () => {
    await withTempDir(async (projectRoot) => {
        await writeFile(path.join(projectRoot, "Project.yyp"), JSON.stringify({ name: "Project" }), "utf8");

        const helpResult = await runCliTestCommand({
            argv: ["resource", "--help"],
            cwd: projectRoot
        });
        assert.equal(helpResult.exitCode, 0);
        assert.match(helpResult.stdout, /@gamemaker\/gm-cli@latest resourcetool eval/u);
    });
});

void test("resource create-image writes a valid PNG file", async () => {
    await withTempDir(async (tempDir) => {
        const outputPath = path.join(tempDir, "placeholder.png");
        const result = await runCliTestCommand({
            argv: [
                "resource",
                "create-image",
                outputPath,
                "--width",
                "16",
                "--height",
                "16",
                "--color",
                "blue",
                "--json"
            ]
        });

        assert.equal(result.exitCode, 0);

        // Verify printed JSON payload
        const payload = JSON.parse(result.stdout) as {
            ok: boolean;
            payload: {
                outputPath: string;
                width: number;
                height: number;
                color: string;
            };
        };
        assert.equal(payload.ok, true);
        assert.equal(payload.payload.width, 16);
        assert.equal(payload.payload.height, 16);
        assert.equal(payload.payload.color, "blue");

        // Verify the file was written and is indeed a PNG (contains PNG signature)
        const fs = await import("node:fs/promises");
        const fileBytes = await fs.readFile(outputPath);
        assert.equal(fileBytes[0], 0x89);
        assert.equal(fileBytes[1], 0x50);
        assert.equal(fileBytes[2], 0x4e);
        assert.equal(fileBytes[3], 0x47);
    });
});

void test("resource create-image with checkerboard pattern writes a valid PNG file", async () => {
    await withTempDir(async (tempDir) => {
        const outputPath = path.join(tempDir, "checker.png");
        const result = await runCliTestCommand({
            argv: [
                "resource",
                "create-image",
                outputPath,
                "--width",
                "32",
                "--height",
                "32",
                "--pattern",
                "checkerboard",
                "--color",
                "black",
                "--color2",
                "white",
                "--checker-size",
                "4",
                "--json"
            ]
        });

        assert.equal(result.exitCode, 0);

        const payload = JSON.parse(result.stdout) as {
            ok: boolean;
            payload: {
                outputPath: string;
                width: number;
                height: number;
                color: string;
                color2: string;
                pattern: string;
                checkerSize: number;
            };
        };
        assert.equal(payload.ok, true);
        assert.equal(payload.payload.width, 32);
        assert.equal(payload.payload.height, 32);
        assert.equal(payload.payload.pattern, "checkerboard");
        assert.equal(payload.payload.checkerSize, 4);

        const fs = await import("node:fs/promises");
        const fileBytes = await fs.readFile(outputPath);
        assert.equal(fileBytes[0], 0x89);
        assert.equal(fileBytes[1], 0x50);
        assert.equal(fileBytes[2], 0x4e);
        assert.equal(fileBytes[3], 0x47);
    });
});
