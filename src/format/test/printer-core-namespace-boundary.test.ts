import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const THIS_DIRECTORY = path.dirname(fileURLToPath(import.meta.url));
const PRINT_DISPATCHER_PATH = path.resolve(THIS_DIRECTORY, "../../src/printer/print.ts");

void test("printer dispatcher references Core node constants through the namespace", async () => {
    const printDispatcherSource = await readFile(PRINT_DISPATCHER_PATH, "utf8");

    assert.ok(
        !printDispatcherSource.includes("} = Core;"),
        "print dispatcher must not destructure Core constants across package boundaries"
    );

    assert.ok(
        printDispatcherSource.includes("Core.FUNCTION_DECLARATION"),
        "print dispatcher should use namespaced Core constants directly"
    );
});
