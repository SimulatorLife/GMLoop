import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { runCliTestCommand } from "../src/cli.js";

async function withTempProject(callback: (dir: string) => Promise<void>): Promise<void> {
    const dir = await mkdtemp(path.join(os.tmpdir(), "gmloop-symbol-inspect-"));
    try {
        await writeFile(
            path.join(dir, "Project.yyp"),
            JSON.stringify({ name: "Project", resourceType: "GMProject" }),
            "utf8"
        );
        await writeFile(
            path.join(dir, "gmloop.json"),
            JSON.stringify({ graph: { embeddings: { enabled: false } } }),
            "utf8"
        );
        await mkdir(path.join(dir, "scripts", "demo_script"), { recursive: true });
        await writeFile(
            path.join(dir, "scripts", "demo_script", "demo_script.yy"),
            JSON.stringify({ name: "demo_script", resourceType: "GMScript" }),
            "utf8"
        );
        await writeFile(
            path.join(dir, "scripts", "demo_script", "demo_script.gml"),
            "function inner_func() {\n  return 1;\n}\n",
            "utf8"
        );
        await callback(dir);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
}

void test("symbol inspect resolves direct graph node lookup and search query", async () => {
    await withTempProject(async (projectRoot) => {
        // First run to build index
        const searchResult = await runCliTestCommand({
            argv: ["symbol", "inspect", "demo_script", "--path", projectRoot, "--json"]
        });
        assert.equal(searchResult.exitCode, 0);
        const payload = JSON.parse(searchResult.stdout) as {
            ok: boolean;
            payload: { resolvedId: string; resolvedKind: string; node?: any };
        };
        assert.equal(payload.ok, true);
        assert.equal(payload.payload.resolvedKind, "script");
        assert.ok(payload.payload.node);
        assert.equal(payload.payload.node.name, "demo_script");

        // Now lookup by direct ID (the resolvedId from first search)
        const directResult = await runCliTestCommand({
            argv: ["symbol", "inspect", payload.payload.resolvedId, "--path", projectRoot, "--json"]
        });
        assert.equal(directResult.exitCode, 0);
        const directPayload = JSON.parse(directResult.stdout) as {
            ok: boolean;
            payload: { resolvedId: string; resolvedKind: string };
        };
        assert.equal(directPayload.ok, true);
        assert.equal(directPayload.payload.resolvedId, payload.payload.resolvedId);
    });
});

void test("symbol inspect handles unresolved queries", async () => {
    await withTempProject(async (projectRoot) => {
        const result = await runCliTestCommand({
            argv: ["symbol", "inspect", "nonexistent_symbol", "--path", projectRoot, "--json"]
        });
        assert.equal(result.exitCode, 1);
        const payload = JSON.parse(result.stdout) as {
            ok: boolean;
            code: string;
            error: string;
        };
        assert.equal(payload.ok, false);
        assert.equal(payload.code, "unresolved");
    });
});

void test("symbol inspect filters by --kind and handles ambiguous queries", async () => {
    await withTempProject(async (projectRoot) => {
        // Create another script with name starting with demo_
        await mkdir(path.join(projectRoot, "scripts", "demo_another"), { recursive: true });
        await writeFile(
            path.join(projectRoot, "scripts", "demo_another", "demo_another.yy"),
            JSON.stringify({ name: "demo_another", resourceType: "GMScript" }),
            "utf8"
        );
        await writeFile(
            path.join(projectRoot, "scripts", "demo_another", "demo_another.gml"),
            "function inner_another() { return 2; }",
            "utf8"
        );

        // Ambiguous search for prefix/substring "demo"
        const ambiguousResult = await runCliTestCommand({
            argv: ["symbol", "inspect", "demo", "--path", projectRoot, "--json"]
        });
        assert.equal(ambiguousResult.exitCode, 1);
        const ambiguousPayload = JSON.parse(ambiguousResult.stdout) as {
            ok: boolean;
            code: string;
            candidates: Array<{ name: string; kind: string }>;
        };
        assert.equal(ambiguousPayload.ok, false);
        assert.equal(ambiguousPayload.code, "ambiguous");
        assert.ok(ambiguousPayload.candidates.length >= 2);

        // Filter by kind "script" (should still be ambiguous for prefix demo)
        const kindScriptResult = await runCliTestCommand({
            argv: ["symbol", "inspect", "demo", "--kind", "script", "--path", projectRoot, "--json"]
        });
        assert.equal(kindScriptResult.exitCode, 1);

        // Filter by kind "room" (should be unresolved because no room matches demo)
        const kindRoomResult = await runCliTestCommand({
            argv: ["symbol", "inspect", "demo", "--kind", "room", "--path", projectRoot, "--json"]
        });
        assert.equal(kindRoomResult.exitCode, 1);
        const kindRoomPayload = JSON.parse(kindRoomResult.stdout) as { code: string };
        assert.equal(kindRoomPayload.code, "unresolved");
    });
});

void test("symbol inspect supports --include items (context, neighbors, usages, dependents)", async () => {
    await withTempProject(async (projectRoot) => {
        const includeResult = await runCliTestCommand({
            argv: [
                "symbol",
                "inspect",
                "demo_script",
                "--include",
                "node,context,neighbors,usages,dependents",
                "--path",
                projectRoot,
                "--json"
            ]
        });
        assert.equal(includeResult.exitCode, 0);
        const payload = JSON.parse(includeResult.stdout) as {
            ok: boolean;
            payload: {
                resolvedId: string;
                node: any;
                context: any;
                neighbors: any;
                usages: any;
                dependents: any;
            };
        };
        assert.equal(payload.ok, true);
        assert.ok(payload.payload.node);
        assert.ok(payload.payload.context);
        assert.ok(payload.payload.neighbors);
        assert.ok(payload.payload.usages);
        assert.ok(payload.payload.dependents);
    });
});
