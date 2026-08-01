import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { Lsp } from "@gmloop/lsp";

async function createProject(config: Readonly<Record<string, unknown>> | null) {
    const projectRoot = await fs.mkdtemp(path.join(os.tmpdir(), "gmloop-lsp-format-options-"));
    const documentPath = path.join(projectRoot, "scripts", "main", "main.gml");
    await fs.mkdir(path.dirname(documentPath), { recursive: true });
    await fs.writeFile(path.join(projectRoot, "Game.yyp"), "{}\n", "utf8");
    await fs.writeFile(documentPath, "if (ready) {\n    run();\n}\n", "utf8");
    if (config !== null) {
        await fs.writeFile(path.join(projectRoot, "gmloop.json"), `${JSON.stringify(config, null, 2)}\n`, "utf8");
    }

    return {
        documentPath,
        async cleanup() {
            await fs.rm(projectRoot, { force: true, recursive: true });
        }
    };
}

void test("gmloop.json useTabs overrides the LSP client's insertSpaces preference", async () => {
    const project = await createProject({ tabWidth: 4, useTabs: true });
    try {
        const options = await Lsp.resolveDocumentFormatOptions(project.documentPath, {
            insertSpaces: true,
            tabSize: 2
        });

        assert.deepEqual(options, { tabWidth: 4, useTabs: true });
    } finally {
        await project.cleanup();
    }
});

void test("LSP client indentation preferences apply when gmloop.json does not configure them", async () => {
    const project = await createProject({ semi: true });
    try {
        const options = await Lsp.resolveDocumentFormatOptions(project.documentPath, {
            insertSpaces: false,
            tabSize: 3
        });

        assert.deepEqual(options, { tabWidth: 3, useTabs: true, semi: true });
    } finally {
        await project.cleanup();
    }
});
