import assert from "node:assert/strict";
import { test } from "node:test";

import { Command } from "commander";

import { addResourceQuerySharedOptions, printResourceCommandPayload } from "../src/cli-core/resource-command-shared.js";
import { createConfigOption, createPathOption } from "../src/cli-core/shared-command-options.js";

void test("addResourceQuerySharedOptions registers the full query option set", () => {
    const command = new Command("fixture");
    addResourceQuerySharedOptions(command);

    const registeredFlags = command.options.map((option) => option.flags);

    assert.deepEqual(registeredFlags, [
        "--path <path>",
        "--config <path>",
        "--database-path <path>",
        "--toolset-root <path>",
        "--force",
        "--json"
    ]);
});

void test("addResourceQuerySharedOptions reuses the shared path and config factories", () => {
    const command = new Command("fixture");
    addResourceQuerySharedOptions(command);

    const pathOption = command.options.find((option) => option.flags === "--path <path>");
    const configOption = command.options.find((option) => option.flags === "--config <path>");

    assert.ok(pathOption, "Expected --path option to be registered");
    assert.ok(configOption, "Expected --config option to be registered");
    assert.equal(pathOption?.description, createPathOption().description);
    assert.equal(configOption?.description, createConfigOption().description);
});

void test("addResourceQuerySharedOptions returns the same command instance", () => {
    const command = new Command("fixture");
    assert.equal(addResourceQuerySharedOptions(command), command);
});

void test("printResourceCommandPayload writes pretty JSON to stdout", () => {
    const logged: Array<string> = [];
    const original = console.log;
    console.log = (...args: Array<unknown>) => {
        logged.push(args.map(String).join(" "));
    };

    try {
        printResourceCommandPayload({ hello: "world" });
    } finally {
        console.log = original;
    }

    assert.deepEqual(logged, ['{\n  "hello": "world"\n}']);
});
